import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { BoardTaskError } from "../../board/tasks.js";
import type { BoardServices } from "../../board/services.js";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import type { BoardTaskStartInput, BoardTaskStartResult } from "../../board/start.js";

type BoardRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "board.task.list.request"
      | "board.task.create.request"
      | "board.task.update.request"
      | "board.task.delete.request"
      | "board.task.start.request"
      | "board.goal.create.request"
      | "board.goal.update.request"
      | "board.goal.delete.request"
      | "board.decision.resolve.request"
      | "board.snooze.set.request"
      | "board.settings.set.request";
  }
>;

type Request<T extends BoardRequest["type"]> = Extract<BoardRequest, { type: T }>;

export interface BoardSessionOptions {
  emit(message: SessionOutboundMessage): void;
  delivery: Pick<SessionDelivery, "begin">;
  // Absent when the daemon runs without Board storage.
  board: BoardServices | null;
  start: ((input: BoardTaskStartInput) => Promise<BoardTaskStartResult>) | null;
}

export class BoardSession {
  constructor(private readonly options: BoardSessionOptions) {}

  // Handles the board.* requests; returns undefined for any other message.
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "board.task.list.request":
        return this.handleList(msg);
      case "board.task.create.request":
        return this.handleCreate(msg);
      case "board.task.update.request":
        return this.handleUpdate(msg);
      case "board.task.delete.request":
        return this.handleDelete(msg);
      case "board.task.start.request":
        return this.handleStart(msg);
      case "board.goal.create.request":
        return this.handleGoalCreate(msg);
      case "board.goal.update.request":
        return this.handleGoalUpdate(msg);
      case "board.goal.delete.request":
        return this.handleGoalDelete(msg);
      case "board.decision.resolve.request":
        return this.handleDecisionResolve(msg);
      case "board.snooze.set.request":
        return this.handleSnoozeSet(msg);
      case "board.settings.set.request":
        return this.handleSettingsSet(msg);
      default:
        return undefined;
    }
  }

  private async handleList(msg: Request<"board.task.list.request">): Promise<void> {
    const board = this.options.board;
    if (!board) {
      this.emitError(msg, new BoardUnavailableError());
      return;
    }
    const snapshot = () => ({
      tasks: board.tasks.list(),
      goals: board.goals.list(),
      decisions: board.decisions.list(),
      snoozes: board.desk.listSnoozes(),
      settings: board.desk.getSettings(),
    });
    if (!msg.subscribe) {
      this.options.emit({
        type: "board.task.list.response",
        payload: { requestId: msg.requestId, ...snapshot() },
      });
      return;
    }
    const unsubscribes: (() => void)[] = [];
    const owner = this.options.delivery.begin("board", msg.subscribe.subscriptionId, () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    });
    // Registering and reading the snapshot in one tick leaves no gap for a missed change.
    unsubscribes.push(
      board.tasks.subscribe((change) => {
        if (owner.signal.aborted) return;
        owner.emit({ type: "board.task.update", payload: change });
      }),
      board.goals.subscribe((change) => {
        if (owner.signal.aborted) return;
        owner.emit({ type: "board.task.update", payload: change });
      }),
      board.decisions.subscribe(({ kind, decision }) => {
        if (owner.signal.aborted) return;
        owner.emit({ type: "board.task.update", payload: { kind, decision } });
      }),
      board.desk.subscribe((change) => {
        if (owner.signal.aborted) return;
        owner.emit({ type: "board.task.update", payload: change });
      }),
    );
    this.options.emit({
      type: "board.task.list.response",
      payload: { requestId: msg.requestId, subscriptionId: owner.responseId, ...snapshot() },
    });
  }

  private async handleCreate(msg: Request<"board.task.create.request">): Promise<void> {
    try {
      const task = await this.requireBoard().tasks.create(msg);
      this.options.emit({
        type: "board.task.create.response",
        payload: { requestId: msg.requestId, task },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleUpdate(msg: Request<"board.task.update.request">): Promise<void> {
    try {
      const task = await this.requireBoard().tasks.update(msg);
      this.options.emit({
        type: "board.task.update.response",
        payload: { requestId: msg.requestId, task },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleDelete(msg: Request<"board.task.delete.request">): Promise<void> {
    try {
      await this.requireBoard().tasks.delete(msg.taskId);
      this.options.emit({
        type: "board.task.delete.response",
        payload: { requestId: msg.requestId, taskId: msg.taskId },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleStart(msg: Request<"board.task.start.request">): Promise<void> {
    try {
      if (!this.options.board || !this.options.start) throw new BoardUnavailableError();
      const started = await this.options.start({
        ...msg,
        idempotencyKey: msg.idempotencyKey ?? msg.requestId,
      });
      this.options.emit({
        type: "board.task.start.response",
        payload: { requestId: msg.requestId, ...started },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleGoalCreate(msg: Request<"board.goal.create.request">): Promise<void> {
    try {
      const goal = await this.requireBoard().goals.create(msg);
      this.options.emit({
        type: "board.goal.create.response",
        payload: { requestId: msg.requestId, goal },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleGoalUpdate(msg: Request<"board.goal.update.request">): Promise<void> {
    try {
      const goal = await this.requireBoard().goals.update(msg);
      this.options.emit({
        type: "board.goal.update.response",
        payload: { requestId: msg.requestId, goal },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleGoalDelete(msg: Request<"board.goal.delete.request">): Promise<void> {
    try {
      await this.requireBoard().goals.delete(msg.goalId);
      this.options.emit({
        type: "board.goal.delete.response",
        payload: { requestId: msg.requestId, goalId: msg.goalId },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleDecisionResolve(
    msg: Request<"board.decision.resolve.request">,
  ): Promise<void> {
    try {
      const decision = await this.requireBoard().decisions.resolve(msg);
      this.options.emit({
        type: "board.decision.resolve.response",
        payload: { requestId: msg.requestId, decision },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleSnoozeSet(msg: Request<"board.snooze.set.request">): Promise<void> {
    try {
      const until = msg.until === null ? null : new Date(msg.until);
      const snoozes = await this.requireBoard().desk.setSnooze(msg.key, until);
      this.options.emit({
        type: "board.snooze.set.response",
        payload: { requestId: msg.requestId, snoozes },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleSettingsSet(msg: Request<"board.settings.set.request">): Promise<void> {
    try {
      const settings = await this.requireBoard().desk.setSettings(msg.settings);
      this.options.emit({
        type: "board.settings.set.response",
        payload: { requestId: msg.requestId, settings },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private requireBoard(): BoardServices {
    if (!this.options.board) throw new BoardUnavailableError();
    return this.options.board;
  }

  private emitError(request: BoardRequest, error: unknown): void {
    let code = "board_request_failed";
    if (error instanceof BoardTaskError) code = error.code;
    else if (error instanceof BoardUnavailableError) code = error.code;
    this.options.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        code,
        error: error instanceof Error ? error.message : "Board request failed",
      },
    });
  }
}

class BoardUnavailableError extends Error {
  readonly code = "board_unavailable";

  constructor() {
    super("Board is unavailable on this host");
    this.name = "BoardUnavailableError";
  }
}
