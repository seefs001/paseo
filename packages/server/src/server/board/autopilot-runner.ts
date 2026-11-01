import type { Logger } from "pino";
import type { BoardGoal, BoardGoalAutopilot, BoardTask } from "@getpaseo/protocol/messages";
import { AUTOPILOT_START_OPTIONS, type BoardDecisionService } from "./decisions.js";
import { localDate, type BoardGoalService } from "./goals.js";
import type { BoardTaskStartInput, BoardTaskStartResult } from "./start.js";
import type { BoardTaskService } from "./tasks.js";

const TICK_MS = 60_000;
const BRIEF_NOTES_MAX_LENGTH = 2_000;

interface BoardAutopilotRunnerDeps {
  tasks: BoardTaskService;
  goals: BoardGoalService;
  decisions: BoardDecisionService;
  startBoardTask(input: BoardTaskStartInput): Promise<BoardTaskStartResult>;
  logger: Logger;
}

/** The failed start that pauses a goal until the task, the settings or the day changes. */
interface StartFailure {
  taskId: string;
  taskUpdatedAt: string;
  settings: string;
  date: string;
}

function settingsKey(autopilot: BoardGoalAutopilot): string {
  const { enabled, agent, isolation, maxActive, dailyStartLimit, confirmStarts } = autopilot;
  return JSON.stringify([enabled, agent, isolation, maxActive, dailyStartLimit, confirmStarts]);
}

function isAsking(goal: BoardGoal | null): goal is BoardGoal & { autopilot: BoardGoalAutopilot } {
  return Boolean(
    goal && goal.landedAt === null && goal.autopilot?.enabled && goal.autopilot.confirmStarts,
  );
}

/**
 * Starts ready tasks of goals with Autopilot enabled, or asks first through a decision when the
 * goal confirms starts. Passes run one at a time, so a goal never has two starts in flight. Task,
 * goal and decision changes trigger a pass; a one-minute tick picks up the daily rollover.
 */
export class BoardAutopilotRunner {
  private readonly logger: Logger;
  private readonly failures = new Map<string, StartFailure>();
  private unsubscribers: Array<() => void> = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private stopped = false;

  constructor(private readonly deps: BoardAutopilotRunnerDeps) {
    this.logger = deps.logger.child({ module: "board-autopilot" });
  }

  start(): void {
    this.unsubscribers = [
      this.deps.tasks.subscribe(() => this.requestPass()),
      this.deps.goals.subscribe(() => this.requestPass()),
      this.deps.decisions.subscribe(() => this.requestPass()),
    ];
    this.tick = setInterval(() => this.requestPass(), TICK_MS);
    this.tick.unref?.();
    this.requestPass();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    await this.running;
  }

  private requestPass(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.running) return;
    this.running = this.drain()
      .catch((err: unknown) => {
        this.logger.error({ err }, "Autopilot pass failed");
      })
      .finally(() => {
        this.running = null;
      });
  }

  private async drain(): Promise<void> {
    while (this.dirty && !this.stopped) {
      this.dirty = false;
      await this.closeStaleQuestions();
      for (const goal of this.deps.goals.list()) {
        if (this.stopped) return;
        if (goal.autopilot?.enabled && goal.landedAt === null) await this.fillGoal(goal.id);
      }
    }
  }

  /** Closes Autopilot questions whose task moved on or whose goal stopped asking. */
  private async closeStaleQuestions(): Promise<void> {
    for (const { decision, taskUpdatedAt } of this.deps.decisions.listOpenAutopilotStarts()) {
      const goal = decision.goalId === null ? null : this.deps.goals.get(decision.goalId);
      const task = decision.taskId === null ? null : this.deps.tasks.find(decision.taskId);
      const current =
        isAsking(goal) &&
        task !== null &&
        task.goalId === goal.id &&
        task.updatedAt === taskUpdatedAt &&
        this.deps.tasks.isOnFrontier(task);
      if (current) continue;
      await this.deps.decisions.cancel(decision.id).catch((err: unknown) => {
        this.logger.error({ err, decisionId: decision.id }, "Failed to close Autopilot question");
      });
    }
  }

  /** Starts or proposes tasks one by one until the goal reaches a limit or has nothing ready. */
  private async fillGoal(goalId: string): Promise<void> {
    while (!this.stopped) {
      const goal = this.deps.goals.get(goalId);
      const autopilot = goal?.autopilot;
      if (!goal || goal.landedAt !== null || !autopilot?.enabled) return;
      const tasks = this.deps.tasks.list().filter((task) => task.goalId === goalId);
      const active = tasks.filter((task) => task.workspaceId !== null && task.completedAt === null);
      const asking = new Set(
        this.deps.decisions
          .listOpenAutopilotStarts()
          .filter(({ decision }) => decision.goalId === goalId)
          .map(({ decision }) => decision.taskId),
      );
      if (active.length + asking.size >= autopilot.maxActive) return;
      if (goal.startsToday + asking.size >= autopilot.dailyStartLimit) return;
      if (autopilot.confirmStarts) {
        const next = this.nextTask(
          tasks.filter(
            (task) =>
              !asking.has(task.id) && !this.deps.decisions.isSkipped(task.id, task.updatedAt),
          ),
        );
        if (!next) return;
        if (!(await this.ask(goal, autopilot, next))) return;
        continue;
      }
      if (this.isPaused(goalId, autopilot, tasks)) return;
      const next = this.nextTask(tasks);
      if (!next) return;
      if (!(await this.startTask(goalId, autopilot, next))) return;
    }
  }

  private nextTask(tasks: BoardTask[]): BoardTask | undefined {
    return tasks
      .filter((task) => this.deps.tasks.isOnFrontier(task))
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))[0];
  }

  private isPaused(goalId: string, autopilot: BoardGoalAutopilot, tasks: BoardTask[]): boolean {
    const failure = this.failures.get(goalId);
    if (!failure) return false;
    const task = tasks.find((candidate) => candidate.id === failure.taskId);
    const paused =
      task?.updatedAt === failure.taskUpdatedAt &&
      failure.settings === settingsKey(autopilot) &&
      failure.date === localDate(new Date());
    if (!paused) this.failures.delete(goalId);
    return paused;
  }

  private async ask(
    goal: BoardGoal,
    autopilot: BoardGoalAutopilot,
    task: BoardTask,
  ): Promise<boolean> {
    try {
      await this.deps.decisions.create({
        kind: "autopilot_start",
        goalId: goal.id,
        taskId: task.id,
        agentId: null,
        title: `Start T-${task.number}: ${task.title}`,
        brief: buildStartBrief(goal, autopilot, task),
        options: AUTOPILOT_START_OPTIONS,
        taskUpdatedAt: task.updatedAt,
      });
      return true;
    } catch (err) {
      this.logger.error({ err, goalId: goal.id, taskId: task.id }, "Failed to ask to start task");
      return false;
    }
  }

  private async startTask(
    goalId: string,
    autopilot: BoardGoalAutopilot,
    task: BoardTask,
  ): Promise<boolean> {
    try {
      const started = await this.deps.startBoardTask({
        taskId: task.id,
        isolation: autopilot.isolation,
        agent: autopilot.agent,
        // The task's update time keeps a retry after a crash on the same start, and gives a
        // task that went back to Ahead a fresh one.
        idempotencyKey: `board-autopilot:${task.id}:${task.updatedAt}`,
      });
      this.failures.delete(goalId);
      this.logger.info(
        { goalId, taskId: task.id, workspaceId: started.workspaceId, agentId: started.agentId },
        "Autopilot started Board task",
      );
      await this.record(goalId, null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failures.set(goalId, {
        taskId: task.id,
        taskUpdatedAt: task.updatedAt,
        settings: settingsKey(autopilot),
        date: localDate(new Date()),
      });
      this.logger.warn({ err: error, goalId, taskId: task.id }, "Autopilot could not start task");
      await this.record(goalId, message);
      return false;
    }
  }

  private async record(goalId: string, error: string | null): Promise<void> {
    await this.deps.goals.recordAutopilotStart(goalId, error).catch((err: unknown) => {
      this.logger.error({ err, goalId }, "Failed to record Autopilot start");
    });
  }
}

function buildStartBrief(goal: BoardGoal, autopilot: BoardGoalAutopilot, task: BoardTask): string {
  const agent =
    autopilot.agent.kind === "profile"
      ? `Agent profile \`${autopilot.agent.profileId}\``
      : [autopilot.agent.provider, autopilot.agent.model].filter(Boolean).join(" ");
  const place = autopilot.isolation === "worktree" ? "a new worktree" : "the project checkout";
  const sections = [
    `Autopilot for **G-${goal.number} ${goal.title}** is ready to start **T-${task.number} ${task.title}** with ${agent} in ${place}.`,
  ];
  if (task.notes) {
    const notes =
      task.notes.length > BRIEF_NOTES_MAX_LENGTH
        ? `${task.notes.slice(0, BRIEF_NOTES_MAX_LENGTH)}...`
        : task.notes;
    sections.push(notes);
  }
  if (task.acceptanceCriteria.length > 0) {
    const checklist = task.acceptanceCriteria
      .map((criterion) => `- [${criterion.met ? "x" : " "}] ${criterion.text}`)
      .join("\n");
    sections.push(`Acceptance criteria:\n\n${checklist}`);
  }
  sections.push("Start runs it now. Skip leaves it in Ahead until the task changes.");
  return sections.join("\n\n");
}
