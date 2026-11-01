import type {
  BoardGoalCreateOptions,
  BoardGoalUpdateOptions,
  BoardTaskCreateOptions,
  BoardTaskStartOptions,
  BoardTaskUpdateOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type {
  BoardDecision,
  BoardDeskSettings,
  BoardGoal,
  BoardTask,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { create } from "zustand";
import { i18n } from "@/i18n/i18next";
import { toErrorMessage } from "@/utils/error-messages";

export type BoardHostTasks =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      tasks: ReadonlyMap<string, BoardTask>;
      goals: ReadonlyMap<string, BoardGoal>;
      decisions: ReadonlyMap<string, BoardDecision>;
      /** Snoozed checkpoint keys and when they wake, as epoch ms. */
      snoozes: ReadonlyMap<string, number>;
      settings: BoardDeskSettings;
    };

interface BoardTasksState {
  hosts: Readonly<Record<string, BoardHostTasks>>;
}

/** Live tasks per host. The host runtime keeps every connected host subscribed. */
export const useBoardTasks = create<BoardTasksState>(() => ({ hosts: {} }));

function setHost(serverId: string, value: BoardHostTasks): void {
  useBoardTasks.setState((state) => ({ hosts: { ...state.hosts, [serverId]: value } }));
}

function editReadyHost(serverId: string, edit: (tasks: Map<string, BoardTask>) => void): void {
  const current = useBoardTasks.getState().hosts[serverId];
  if (current?.status !== "ready") return;
  const tasks = new Map(current.tasks);
  edit(tasks);
  setHost(serverId, { ...current, tasks });
}

type ReadyHost = Extract<BoardHostTasks, { status: "ready" }>;

function editHost(serverId: string, edit: (host: ReadyHost) => ReadyHost): void {
  const current = useBoardTasks.getState().hosts[serverId];
  if (current?.status !== "ready") return;
  setHost(serverId, edit(current));
}

function upsertGoal(serverId: string, goal: BoardGoal): void {
  editHost(serverId, (host) => ({ ...host, goals: new Map(host.goals).set(goal.id, goal) }));
}

function removeGoal(serverId: string, goalId: string): void {
  editHost(serverId, (host) => {
    const goals = new Map(host.goals);
    goals.delete(goalId);
    return { ...host, goals };
  });
}

function upsertDecision(serverId: string, decision: BoardDecision): void {
  editHost(serverId, (host) => ({
    ...host,
    decisions: new Map(host.decisions).set(decision.id, decision),
  }));
}

function toSnoozeMap(snoozes: readonly { key: string; until: string }[]): Map<string, number> {
  return new Map(snoozes.map((snooze) => [snooze.key, Date.parse(snooze.until)]));
}

function upsertTask(serverId: string, task: BoardTask): void {
  editReadyHost(serverId, (tasks) => tasks.set(task.id, task));
}

function removeTask(serverId: string, taskId: string): void {
  editReadyHost(serverId, (tasks) => tasks.delete(taskId));
}

type BoardChange = Extract<SessionOutboundMessage, { type: "board.task.update" }>["payload"];

function applyChange(serverId: string, change: BoardChange): void {
  switch (change.kind) {
    case "upsert":
      upsertTask(serverId, change.task);
      return;
    case "remove":
      removeTask(serverId, change.taskId);
      return;
    case "goal":
      upsertGoal(serverId, change.goal);
      return;
    case "goal_remove":
      removeGoal(serverId, change.goalId);
      return;
    case "decision":
      upsertDecision(serverId, change.decision);
      return;
    case "snoozes":
      editHost(serverId, (host) => ({ ...host, snoozes: toSnoozeMap(change.snoozes) }));
      return;
    case "settings":
      editHost(serverId, (host) => ({ ...host, settings: change.settings }));
      return;
  }
}

interface HostConnection {
  client: DaemonClient;
  unsubscribe: () => void;
}

/** Owns one task subscription per connected host, attached by the host's directory sync. */
class BoardTasksController {
  private readonly connections = new Map<string, HostConnection>();

  async connect(input: {
    serverId: string;
    client: DaemonClient;
    supportsBoardTasks: boolean;
  }): Promise<void> {
    const { serverId, client } = input;
    const live = useBoardTasks.getState().hosts[serverId]?.status !== "error";
    if (this.connections.get(serverId)?.client === client && input.supportsBoardTasks && live) {
      return;
    }
    this.disconnect(serverId);
    if (!input.supportsBoardTasks) {
      setHost(serverId, { status: "unsupported" });
      return;
    }

    setHost(serverId, { status: "loading" });
    const subscription = client.observeBoardTasks();
    this.connections.set(serverId, {
      client,
      unsubscribe: () => {
        void subscription.release().catch(() => undefined);
      },
    });
    subscription.subscribe({
      snapshot: (payload) => {
        setHost(serverId, {
          status: "ready",
          tasks: new Map(payload.tasks.map((task) => [task.id, task])),
          goals: new Map(payload.goals.map((goal) => [goal.id, goal])),
          decisions: new Map(payload.decisions.map((decision) => [decision.id, decision])),
          snoozes: toSnoozeMap(payload.snoozes),
          settings: payload.settings,
        });
      },
      update: (message) => {
        if (message.type !== "board.task.update") return;
        applyChange(serverId, message.payload);
      },
      error: (error) => {
        setHost(serverId, { status: "error", message: toErrorMessage(error) });
      },
    });
    await subscription.ready;
  }

  disconnect(serverId: string): void {
    this.connections.get(serverId)?.unsubscribe();
    this.connections.delete(serverId);
    if (useBoardTasks.getState().hosts[serverId]) setHost(serverId, { status: "offline" });
  }

  requireClient(serverId: string): DaemonClient {
    const client = this.connections.get(serverId)?.client;
    if (!client?.isConnected) throw new Error(i18n.t("board.errors.offline"));
    return client;
  }
}

export const boardTasks = new BoardTasksController();

export async function createBoardTask(
  serverId: string,
  options: BoardTaskCreateOptions,
): Promise<BoardTask> {
  const task = await boardTasks.requireClient(serverId).createBoardTask(options);
  upsertTask(serverId, task);
  return task;
}

export async function updateBoardTask(
  serverId: string,
  update: BoardTaskUpdateOptions,
): Promise<BoardTask> {
  const task = await boardTasks.requireClient(serverId).updateBoardTask(update);
  upsertTask(serverId, task);
  return task;
}

export async function deleteBoardTask(serverId: string, taskId: string): Promise<void> {
  await boardTasks.requireClient(serverId).deleteBoardTask({ taskId });
  removeTask(serverId, taskId);
}

export async function createBoardGoal(
  serverId: string,
  options: BoardGoalCreateOptions,
): Promise<BoardGoal> {
  const goal = await boardTasks.requireClient(serverId).createBoardGoal(options);
  upsertGoal(serverId, goal);
  return goal;
}

export async function updateBoardGoal(
  serverId: string,
  options: BoardGoalUpdateOptions,
): Promise<BoardGoal> {
  const goal = await boardTasks.requireClient(serverId).updateBoardGoal(options);
  upsertGoal(serverId, goal);
  return goal;
}

/** The goal's tasks stay and lose the goal; the daemon pushes those task updates. */
export async function deleteBoardGoal(serverId: string, goalId: string): Promise<void> {
  await boardTasks.requireClient(serverId).deleteBoardGoal({ goalId });
  removeGoal(serverId, goalId);
}

export async function resolveBoardDecision(
  serverId: string,
  input: { decisionId: string; choiceId: string; note?: string },
): Promise<BoardDecision> {
  const decision = await boardTasks.requireClient(serverId).resolveBoardDecision(input);
  upsertDecision(serverId, decision);
  return decision;
}

/** `until: null` wakes the checkpoint now. */
export async function setBoardSnooze(
  serverId: string,
  input: { key: string; until: Date | null },
): Promise<void> {
  const snoozes = await boardTasks.requireClient(serverId).setBoardSnooze({
    key: input.key,
    until: input.until?.toISOString() ?? null,
  });
  editHost(serverId, (host) => ({ ...host, snoozes: toSnoozeMap(snoozes) }));
}

export async function setBoardDeskSettings(
  serverId: string,
  settings: BoardDeskSettings,
): Promise<BoardDeskSettings> {
  const saved = await boardTasks.requireClient(serverId).setBoardDeskSettings({ settings });
  editHost(serverId, (host) => ({ ...host, settings: saved }));
  return saved;
}

/** Starts the task on the daemon: it creates the workspace and agent, then links the task. */
export async function startBoardTaskOnHost(
  serverId: string,
  options: BoardTaskStartOptions,
): Promise<BoardTask> {
  const { task } = await boardTasks.requireClient(serverId).startBoardTask(options);
  upsertTask(serverId, task);
  return task;
}
