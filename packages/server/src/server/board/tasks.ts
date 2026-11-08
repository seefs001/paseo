import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  BoardTaskAttachmentSchema,
  BoardTaskCriterionSchema,
  BoardTaskSchema,
  type BoardTask,
  type BoardTaskCriterion,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";

const TITLE_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 20_000;
const SUMMARY_MAX_LENGTH = 20_000;
const CRITERION_MAX_LENGTH = 2_000;
const CRITERIA_MAX_COUNT = 50;

// Fields added after the first Board build default here so older task files still load.
const StoredBoardTaskSchema = BoardTaskSchema.extend({
  attachments: z.array(BoardTaskAttachmentSchema).default([]),
  rank: z.number().default(0),
  summary: z.string().nullable().default(null),
  acceptanceCriteria: z.array(BoardTaskCriterionSchema).default([]),
  parentId: z.string().nullable().default(null),
  blockedBy: z.array(z.string()).default([]),
  readyFor: z.enum(["agent", "human"]).default("agent"),
  // Tasks written before stages existed were already committed work. `backlog` and `todo` are the
  // stage names before the Desk; `initialize()` maps them to `fog` and `ready`.
  stage: z.enum(["fog", "ready", "backlog", "todo"]).default("ready"),
  goalId: z.string().nullable().default(null),
  claimedBy: z.string().nullable().default(null),
  number: z.number().int().positive().optional(),
});

const BoardTaskFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(StoredBoardTaskSchema),
});

export type BoardTaskChange =
  | { kind: "upsert"; task: BoardTask }
  | { kind: "remove"; taskId: string };

export type BoardTaskErrorCode =
  | "task_not_found"
  | "task_title_empty"
  | "task_title_too_long"
  | "task_notes_too_long"
  | "task_summary_too_long"
  | "task_criteria_too_long"
  | "task_dependency_invalid"
  | "task_blocked"
  | "task_claimed"
  | "task_not_ready"
  | "goal_not_found"
  | "goal_title_empty"
  | "goal_title_too_long"
  | "goal_notes_too_long"
  | "decision_not_found"
  | "decision_invalid"
  | "decision_resolved"
  | "autopilot_off"
  | "project_not_found"
  | "workspace_not_found"
  | "task_has_no_project"
  | "task_already_started"
  | "task_completed"
  | "profile_not_found"
  | "task_start_failed";

export class BoardTaskError extends Error {
  constructor(
    readonly code: BoardTaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BoardTaskError";
  }
}

export interface BoardTaskCreateInput {
  title: string;
  notes?: string;
  projectId?: string | null;
  attachments?: BoardTask["attachments"];
  acceptanceCriteria?: BoardTaskCriterion[];
  parentId?: string | null;
  blockedBy?: string[];
  readyFor?: BoardTask["readyFor"];
  stage?: BoardTask["stage"];
  goalId?: string | null;
}

/**
 * One task of a planned batch. `key` names it inside the batch so `parentKey` and `blockedBy`
 * can point at batch siblings before they have ids; `blockedBy` also accepts existing task ids.
 */
export interface BoardTaskPlanInput extends Omit<BoardTaskCreateInput, "parentId" | "blockedBy"> {
  key: string;
  parentKey?: string;
  parentId?: string | null;
  blockedBy?: string[];
}

export interface BoardTaskUpdateInput {
  taskId: string;
  title?: string;
  notes?: string;
  projectId?: string | null;
  workspaceId?: string | null;
  attachments?: BoardTask["attachments"];
  rank?: number;
  summary?: string | null;
  acceptanceCriteria?: BoardTaskCriterion[];
  parentId?: string | null;
  blockedBy?: string[];
  readyFor?: BoardTask["readyFor"];
  stage?: BoardTask["stage"];
  goalId?: string | null;
  /** A person releasing a claim. */
  claimedBy?: null;
  completed?: boolean;
}

interface BoardTaskServiceDeps {
  filePath: string;
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  /** Whether a goal exists on this host; tasks may only serve existing goals. */
  goalExists: (goalId: string) => boolean;
  now?: () => Date;
}

/**
 * Host-local Board tasks. Tasks stay in memory after `initialize()`; every mutation is
 * serialized, written atomically to one JSON file, then announced to subscribers.
 */
export class BoardTaskService {
  private tasks = new Map<string, BoardTask>();
  private readonly listeners = new Set<(change: BoardTaskChange) => void>();
  private operations: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: BoardTaskServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.deps.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const file = BoardTaskFileSchema.parse(JSON.parse(raw));
    // Older files have no task numbers; number them in creation order, after any that exist.
    let next = Math.max(0, ...file.tasks.map((task) => task.number ?? 0)) + 1;
    const ordered = [...file.tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const task of ordered) {
      this.tasks.set(task.id, {
        ...task,
        number: task.number ?? next++,
        stage: task.stage === "backlog" || task.stage === "fog" ? "fog" : "ready",
      });
    }
  }

  /** Finds a task by id or by its `T-<number>` reference. */
  find(ref: string): BoardTask | null {
    const byId = this.tasks.get(ref);
    if (byId) return byId;
    const match = /^(?:T-)?(\d+)$/i.exec(ref.trim());
    if (!match) return null;
    const number = Number(match[1]);
    for (const task of this.tasks.values()) if (task.number === number) return task;
    return null;
  }

  list(): BoardTask[] {
    return [...this.tasks.values()];
  }

  /** Blockers that are not done yet. A task with none may start. */
  unfinishedBlockers(task: BoardTask): string[] {
    return task.blockedBy.filter((id) => {
      const blocker = this.tasks.get(id);
      return blocker !== undefined && blocker.completedAt === null;
    });
  }

  /** Ready tasks an agent may take now: ready for agent, unclaimed, no unfinished blockers. */
  isOnFrontier(task: BoardTask): boolean {
    return (
      task.stage === "ready" &&
      task.workspaceId === null &&
      task.completedAt === null &&
      task.claimedBy === null &&
      task.readyFor === "agent" &&
      this.unfinishedBlockers(task).length === 0
    );
  }

  /** Registers synchronously, so a caller that reads `list()` in the same tick misses nothing. */
  subscribe(listener: (change: BoardTaskChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(input: BoardTaskCreateInput): Promise<BoardTask> {
    return this.mutate(async () => {
      const task = await this.buildTask({
        input,
        tasks: this.tasks,
        number: this.nextNumber(this.tasks),
        rank: this.nextBacklogRank(),
        timestamp: this.now().toISOString(),
      });
      return { result: task, changes: [{ kind: "upsert", task }] };
    });
  }

  /**
   * Creates a whole plan in one write, keeping the given order as Ahead order and wiring
   * parents and blockers between batch siblings. Any invalid task rejects the whole batch.
   */
  createMany(inputs: readonly BoardTaskPlanInput[]): Promise<BoardTask[]> {
    return this.mutate(async () => {
      const timestamp = this.now().toISOString();
      const working = new Map(this.tasks);
      const idsByKey = new Map<string, string>();
      for (const input of inputs) {
        if (idsByKey.has(input.key)) {
          throw new BoardTaskError("task_dependency_invalid", `Duplicate plan key: ${input.key}`);
        }
        idsByKey.set(input.key, `tsk_${randomBytes(8).toString("hex")}`);
      }
      const resolveRef = (ref: string): string => idsByKey.get(ref) ?? ref;
      const firstRank = this.nextBacklogRank() - inputs.length + 1;
      const created: BoardTask[] = [];
      for (const [index, input] of inputs.entries()) {
        const { key, parentKey, ...fields } = input;
        const task = await this.buildTask({
          id: idsByKey.get(key),
          input: {
            ...fields,
            parentId: parentKey === undefined ? (fields.parentId ?? null) : resolveRef(parentKey),
            blockedBy: (fields.blockedBy ?? []).map(resolveRef),
          },
          tasks: working,
          number: this.nextNumber(working),
          rank: firstRank + index,
          timestamp,
        });
        working.set(task.id, task);
        created.push(task);
      }
      return {
        result: created,
        changes: created.map((task) => ({ kind: "upsert" as const, task })),
      };
    });
  }

  /**
   * Claims a frontier task for an agent working it in its own session. Claiming again by the
   * same agent is a no-op; every other non-frontier state rejects with its own code.
   */
  claim(taskId: string, agentId: string): Promise<BoardTask> {
    return this.mutate(async () => {
      const current = this.requireTask(taskId);
      if (current.claimedBy === agentId && current.workspaceId === null) {
        return { result: current, changes: [] };
      }
      this.assertStartable(current, agentId);
      if (current.stage !== "ready") {
        throw new BoardTaskError(
          "task_not_ready",
          "Move the task to Ready before an agent claims it",
        );
      }
      const task = { ...current, claimedBy: agentId, updatedAt: this.now().toISOString() };
      return { result: task, changes: [{ kind: "upsert", task }] };
    });
  }

  /** Gives a claim back. Only the claiming agent can; people release through `update`. */
  release(taskId: string, agentId: string): Promise<BoardTask> {
    return this.mutate(async () => {
      const current = this.requireTask(taskId);
      if (current.claimedBy !== agentId) {
        throw new BoardTaskError("task_claimed", "Task is not claimed by this agent");
      }
      const task = { ...current, claimedBy: null, updatedAt: this.now().toISOString() };
      return { result: task, changes: [{ kind: "upsert", task }] };
    });
  }

  update(input: BoardTaskUpdateInput): Promise<BoardTask> {
    return this.mutate(async () => {
      const current = this.requireTask(input.taskId);
      const timestamp = this.now().toISOString();
      const task: BoardTask = { ...current, updatedAt: timestamp };
      if (input.title !== undefined) task.title = normalizeTitle(input.title);
      if (input.notes !== undefined) task.notes = normalizeNotes(input.notes);
      if (input.projectId !== undefined) {
        task.projectId = await this.resolveProjectId(input.projectId);
      }
      if (input.workspaceId !== undefined) {
        task.workspaceId = input.workspaceId;
        task.claimedBy = null;
        // A task follows its workspace's project, so the two never disagree.
        if (input.workspaceId !== null) {
          task.projectId = await this.resolveLinkableWorkspaceProjectId(input.workspaceId);
        }
      }
      if (input.attachments !== undefined) task.attachments = input.attachments;
      if (input.rank !== undefined) task.rank = input.rank;
      if (input.summary !== undefined) task.summary = normalizeSummary(input.summary);
      if (input.acceptanceCriteria !== undefined) {
        task.acceptanceCriteria = normalizeCriteria(input.acceptanceCriteria);
      }
      if (input.parentId !== undefined) {
        task.parentId = this.resolveParentId(task.id, input.parentId, this.tasks);
      }
      if (input.blockedBy !== undefined) {
        task.blockedBy = this.resolveBlockers(task.id, input.blockedBy, this.tasks);
      }
      if (input.readyFor !== undefined) task.readyFor = input.readyFor;
      if (input.stage !== undefined) task.stage = input.stage;
      if (input.goalId !== undefined) task.goalId = this.resolveGoalId(input.goalId);
      if (input.claimedBy === null) task.claimedBy = null;
      if (input.completed !== undefined) {
        task.completedAt = input.completed ? (current.completedAt ?? timestamp) : null;
        if (input.completed) task.claimedBy = null;
      }
      return { result: task, changes: [{ kind: "upsert", task }] };
    });
  }

  /**
   * Links the workspace `launch` created. `claimant` is the agent asking, so it may start the
   * task it claimed; anyone else is refused while the claim stands.
   */
  start<T extends { workspaceId: string }>(
    taskId: string,
    launch: (task: BoardTask) => Promise<T>,
    claimant?: string,
  ): Promise<T & { task: BoardTask }> {
    return this.mutate(async () => {
      const current = this.requireTask(taskId);
      if (this.unfinishedBlockers(current).length > 0) {
        throw new BoardTaskError("task_blocked", "Task is waiting on unfinished tasks");
      }
      if (current.claimedBy !== null && current.claimedBy !== claimant) {
        throw new BoardTaskError("task_claimed", "Another agent claimed this task");
      }
      const started = await launch(current);
      const projectId = await this.resolveLinkableWorkspaceProjectId(started.workspaceId);
      const task = {
        ...current,
        projectId,
        workspaceId: started.workspaceId,
        claimedBy: null,
        updatedAt: this.now().toISOString(),
      };
      return { result: { ...started, task }, changes: [{ kind: "upsert", task }] };
    });
  }

  /** Deleting a task also drops it from its dependents' blockers and its children's parent. */
  delete(taskId: string): Promise<void> {
    return this.mutate(async () => {
      this.requireTask(taskId);
      const timestamp = this.now().toISOString();
      const changes: BoardTaskChange[] = [{ kind: "remove", taskId }];
      for (const task of this.tasks.values()) {
        const blocked = task.blockedBy.includes(taskId);
        const child = task.parentId === taskId;
        if (!blocked && !child) continue;
        changes.push({
          kind: "upsert",
          task: {
            ...task,
            blockedBy: task.blockedBy.filter((id) => id !== taskId),
            parentId: child ? null : task.parentId,
            updatedAt: timestamp,
          },
        });
      }
      return { result: undefined, changes };
    });
  }

  /** Tasks of a deleted goal become loose work. */
  clearGoal(goalId: string): Promise<void> {
    return this.mutate(async () => {
      const timestamp = this.now().toISOString();
      const changes: BoardTaskChange[] = [];
      for (const task of this.tasks.values()) {
        if (task.goalId !== goalId) continue;
        changes.push({ kind: "upsert", task: { ...task, goalId: null, updatedAt: timestamp } });
      }
      return { result: undefined, changes };
    });
  }

  /** Archiving a workspace finishes the work its tasks tracked. */
  completeForWorkspace(workspaceId: string): Promise<void> {
    return this.mutate(async () => {
      const timestamp = this.now().toISOString();
      const changes: BoardTaskChange[] = [];
      for (const task of this.tasks.values()) {
        if (task.workspaceId !== workspaceId || task.completedAt !== null) continue;
        changes.push({
          kind: "upsert",
          task: { ...task, completedAt: timestamp, claimedBy: null, updatedAt: timestamp },
        });
      }
      return { result: undefined, changes };
    });
  }

  private assertStartable(task: BoardTask, agentId: string): void {
    if (task.completedAt !== null) {
      throw new BoardTaskError("task_completed", "Task is already done");
    }
    if (task.workspaceId !== null) {
      throw new BoardTaskError("task_already_started", "Task already has a workspace");
    }
    if (task.claimedBy !== null && task.claimedBy !== agentId) {
      throw new BoardTaskError("task_claimed", "Another agent claimed this task");
    }
    if (this.unfinishedBlockers(task).length > 0) {
      throw new BoardTaskError("task_blocked", "Task is waiting on unfinished tasks");
    }
  }

  private nextNumber(tasks: ReadonlyMap<string, BoardTask>): number {
    let highest = 0;
    for (const task of tasks.values()) highest = Math.max(highest, task.number);
    return highest + 1;
  }

  private async buildTask(input: {
    id?: string;
    input: BoardTaskCreateInput;
    tasks: ReadonlyMap<string, BoardTask>;
    number: number;
    rank: number;
    timestamp: string;
  }): Promise<BoardTask> {
    const id = input.id ?? `tsk_${randomBytes(8).toString("hex")}`;
    const fields = input.input;
    return {
      id,
      number: input.number,
      title: normalizeTitle(fields.title),
      notes: normalizeNotes(fields.notes ?? ""),
      projectId: await this.resolveProjectId(fields.projectId ?? null),
      workspaceId: null,
      goalId: this.resolveGoalId(fields.goalId ?? null),
      attachments: fields.attachments ?? [],
      rank: input.rank,
      summary: null,
      acceptanceCriteria: normalizeCriteria(fields.acceptanceCriteria ?? []),
      parentId: this.resolveParentId(id, fields.parentId ?? null, input.tasks),
      blockedBy: this.resolveBlockers(id, fields.blockedBy ?? [], input.tasks),
      readyFor: fields.readyFor ?? "agent",
      stage: fields.stage ?? "fog",
      claimedBy: null,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      completedAt: null,
    };
  }

  private requireTask(taskId: string): BoardTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new BoardTaskError("task_not_found", "Task not found");
    return task;
  }

  private resolveGoalId(goalId: string | null): string | null {
    if (goalId !== null && !this.deps.goalExists(goalId)) {
      throw new BoardTaskError("goal_not_found", "Goal not found");
    }
    return goalId;
  }

  private resolveParentId(
    taskId: string,
    parentId: string | null,
    tasks: ReadonlyMap<string, BoardTask>,
  ): string | null {
    if (parentId === null) return null;
    let cursor: string | null = parentId;
    while (cursor !== null) {
      if (cursor === taskId) {
        throw new BoardTaskError("task_dependency_invalid", "A task cannot be its own ancestor");
      }
      const ancestor = tasks.get(cursor);
      if (!ancestor) throw new BoardTaskError("task_dependency_invalid", "Parent task not found");
      cursor = ancestor.parentId;
    }
    return parentId;
  }

  private resolveBlockers(
    taskId: string,
    blockedBy: readonly string[],
    tasks: ReadonlyMap<string, BoardTask>,
  ): string[] {
    const unique = [...new Set(blockedBy)];
    for (const id of unique) {
      if (!tasks.has(id)) {
        throw new BoardTaskError("task_dependency_invalid", "Blocking task not found");
      }
    }
    // Walk what the new blockers wait on; reaching this task would close a cycle.
    const pending = [...unique];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop();
      if (id === undefined || seen.has(id)) continue;
      if (id === taskId) {
        throw new BoardTaskError("task_dependency_invalid", "Dependencies cannot form a cycle");
      }
      seen.add(id);
      pending.push(...(tasks.get(id)?.blockedBy ?? []));
    }
    return unique;
  }

  /** New tasks go to the top of Ahead. */
  private nextBacklogRank(): number {
    let lowest: number | null = null;
    for (const task of this.tasks.values()) {
      if (task.workspaceId !== null || task.completedAt !== null) continue;
      if (lowest === null || task.rank < lowest) lowest = task.rank;
    }
    return lowest === null ? 0 : lowest - 1;
  }

  private async resolveProjectId(projectId: string | null): Promise<string | null> {
    if (projectId === null) return null;
    const project = await this.deps.projectRegistry.get(projectId);
    if (!project || project.archivedAt) {
      throw new BoardTaskError("project_not_found", "Project not found");
    }
    return project.projectId;
  }

  private async resolveLinkableWorkspaceProjectId(workspaceId: string): Promise<string | null> {
    const workspace = await this.deps.workspaceRegistry.get(workspaceId);
    if (!workspace || workspace.archivedAt) {
      throw new BoardTaskError("workspace_not_found", "Workspace not found");
    }
    return workspace.projectId;
  }

  private mutate<T>(stage: () => Promise<{ result: T; changes: BoardTaskChange[] }>): Promise<T> {
    const run = this.operations.then(async () => {
      const { result, changes } = await stage();
      if (changes.length === 0) return result;
      const next = new Map(this.tasks);
      for (const change of changes) {
        if (change.kind === "upsert") next.set(change.task.id, change.task);
        else next.delete(change.taskId);
      }
      await writeJsonFileAtomic(this.deps.filePath, { version: 1, tasks: [...next.values()] });
      this.tasks = next;
      for (const change of changes) {
        for (const listener of this.listeners) listener(change);
      }
      return result;
    });
    this.operations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) throw new BoardTaskError("task_title_empty", "Task title is required");
  if (normalized.length > TITLE_MAX_LENGTH) {
    throw new BoardTaskError("task_title_too_long", "Task title is too long");
  }
  return normalized;
}

function normalizeNotes(notes: string): string {
  const normalized = notes.trim();
  if (normalized.length > NOTES_MAX_LENGTH) {
    throw new BoardTaskError("task_notes_too_long", "Task notes are too long");
  }
  return normalized;
}

function normalizeCriteria(criteria: readonly BoardTaskCriterion[]): BoardTaskCriterion[] {
  const normalized = criteria
    .map((criterion) => ({ text: criterion.text.replace(/\s+/g, " ").trim(), met: criterion.met }))
    .filter((criterion) => criterion.text.length > 0);
  const tooLong = normalized.some((criterion) => criterion.text.length > CRITERION_MAX_LENGTH);
  if (tooLong || normalized.length > CRITERIA_MAX_COUNT) {
    throw new BoardTaskError("task_criteria_too_long", "Acceptance criteria are too long");
  }
  return normalized;
}

function normalizeSummary(summary: string | null): string | null {
  const normalized = summary?.trim() ?? "";
  if (normalized.length > SUMMARY_MAX_LENGTH) {
    throw new BoardTaskError("task_summary_too_long", "Task summary is too long");
  }
  return normalized || null;
}

export function createBoardTaskService(input: {
  paseoHome: string;
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  goalExists: (goalId: string) => boolean;
}): BoardTaskService {
  return new BoardTaskService({
    filePath: join(input.paseoHome, "board", "tasks.json"),
    projectRegistry: input.projectRegistry,
    workspaceRegistry: input.workspaceRegistry,
    goalExists: input.goalExists,
  });
}
