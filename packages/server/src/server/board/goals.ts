import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  BoardGoalSchema,
  type BoardGoal,
  type BoardGoalAutopilot,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { BoardTaskError, type BoardTaskService } from "./tasks.js";

const TITLE_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 20_000;

const StoredBoardGoalSchema = BoardGoalSchema.extend({
  /** Daemon-local date (YYYY-MM-DD) that `startsToday` counts. */
  startsDate: z.string().nullable().default(null),
});
type StoredBoardGoal = z.infer<typeof StoredBoardGoalSchema>;

const BoardGoalFileSchema = z.object({
  version: z.literal(1),
  goals: z.array(StoredBoardGoalSchema),
});

export type BoardGoalChange =
  | { kind: "goal"; goal: BoardGoal }
  | { kind: "goal_remove"; goalId: string };

export interface BoardGoalCreateInput {
  title: string;
  notes?: string;
  ownerAgentId?: string | null;
}

export interface BoardGoalUpdateInput {
  goalId: string;
  title?: string;
  notes?: string;
  ownerAgentId?: string | null;
  /** `null` turns Autopilot off and forgets its settings. */
  autopilot?: BoardGoalAutopilot | null;
  rank?: number;
  landed?: boolean;
}

interface BoardGoalServiceDeps {
  filePath: string;
  tasks: Pick<BoardTaskService, "clearGoal">;
  now?: () => Date;
}

export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Host-local Desk goals with their Autopilot settings and today's start count. Mutations are
 * serialized and written atomically to one JSON file, then announced to subscribers.
 */
export class BoardGoalService {
  private goals = new Map<string, StoredBoardGoal>();
  private readonly listeners = new Set<(change: BoardGoalChange) => void>();
  private operations: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: BoardGoalServiceDeps) {
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
    const file = BoardGoalFileSchema.parse(JSON.parse(raw));
    for (const goal of file.goals) this.goals.set(goal.id, goal);
  }

  list(): BoardGoal[] {
    return [...this.goals.values()].map((stored) => this.toWire(stored));
  }

  get(goalId: string): BoardGoal | null {
    const stored = this.goals.get(goalId);
    return stored ? this.toWire(stored) : null;
  }

  /** Finds a goal by id or by its `G-<number>` reference. */
  find(ref: string): BoardGoal | null {
    const byId = this.get(ref);
    if (byId) return byId;
    const match = /^(?:G-)?(\d+)$/i.exec(ref.trim());
    if (!match) return null;
    const number = Number(match[1]);
    for (const goal of this.goals.values()) if (goal.number === number) return this.toWire(goal);
    return null;
  }

  /** Registers synchronously, so a caller that reads `list()` in the same tick misses nothing. */
  subscribe(listener: (change: BoardGoalChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** New goals go to the end of the goal order. */
  create(input: BoardGoalCreateInput): Promise<BoardGoal> {
    return this.mutate(async () => {
      const timestamp = this.now().toISOString();
      let number = 0;
      let rank: number | null = null;
      for (const goal of this.goals.values()) {
        number = Math.max(number, goal.number);
        if (rank === null || goal.rank > rank) rank = goal.rank;
      }
      const goal: StoredBoardGoal = {
        id: `gol_${randomBytes(8).toString("hex")}`,
        number: number + 1,
        title: normalizeTitle(input.title),
        notes: normalizeNotes(input.notes ?? ""),
        ownerAgentId: input.ownerAgentId ?? null,
        autopilot: null,
        startsToday: 0,
        startsDate: null,
        lastAutopilotError: null,
        rank: rank === null ? 0 : rank + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        landedAt: null,
      };
      return goal;
    });
  }

  update(input: BoardGoalUpdateInput): Promise<BoardGoal> {
    return this.mutate(async () => {
      const current = this.requireGoal(input.goalId);
      const timestamp = this.now().toISOString();
      const goal: StoredBoardGoal = { ...current, updatedAt: timestamp };
      if (input.title !== undefined) goal.title = normalizeTitle(input.title);
      if (input.notes !== undefined) goal.notes = normalizeNotes(input.notes);
      if (input.ownerAgentId !== undefined) goal.ownerAgentId = input.ownerAgentId;
      if (input.autopilot !== undefined) {
        goal.autopilot = input.autopilot;
        goal.lastAutopilotError = null;
      }
      if (input.rank !== undefined) goal.rank = input.rank;
      if (input.landed !== undefined) {
        goal.landedAt = input.landed ? (current.landedAt ?? timestamp) : null;
      }
      return goal;
    });
  }

  /** Deleting a goal keeps its tasks as loose work. */
  async delete(goalId: string): Promise<void> {
    await this.mutate(async () => {
      this.requireGoal(goalId);
      return { removed: goalId };
    });
    await this.deps.tasks.clearGoal(goalId);
  }

  /** Counts one Autopilot start against today's limit, or records why it failed. */
  recordAutopilotStart(goalId: string, error: string | null): Promise<BoardGoal> {
    return this.mutate(async () => {
      const current = this.requireGoal(goalId);
      const now = this.now();
      const today = localDate(now);
      const startsToday = current.startsDate === today ? current.startsToday : 0;
      return {
        ...current,
        startsToday: error === null ? startsToday + 1 : startsToday,
        startsDate: today,
        lastAutopilotError: error,
        updatedAt: now.toISOString(),
      };
    });
  }

  private requireGoal(goalId: string): StoredBoardGoal {
    const goal = this.goals.get(goalId);
    if (!goal) throw new BoardTaskError("goal_not_found", "Goal not found");
    return goal;
  }

  private toWire(stored: StoredBoardGoal): BoardGoal {
    const { startsDate, ...goal } = stored;
    return startsDate === localDate(this.now()) ? goal : { ...goal, startsToday: 0 };
  }

  private mutate(stage: () => Promise<StoredBoardGoal>): Promise<BoardGoal>;
  private mutate(stage: () => Promise<{ removed: string }>): Promise<void>;
  private mutate(
    stage: () => Promise<StoredBoardGoal | { removed: string }>,
  ): Promise<BoardGoal | void> {
    const run = this.operations.then(async () => {
      const outcome = await stage();
      const goals = new Map(this.goals);
      if ("removed" in outcome) goals.delete(outcome.removed);
      else goals.set(outcome.id, outcome);
      await writeJsonFileAtomic(this.deps.filePath, { version: 1, goals: [...goals.values()] });
      this.goals = goals;
      const change: BoardGoalChange =
        "removed" in outcome
          ? { kind: "goal_remove", goalId: outcome.removed }
          : { kind: "goal", goal: this.toWire(outcome) };
      for (const listener of this.listeners) listener(change);
      return change.kind === "goal" ? change.goal : undefined;
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
  if (!normalized) throw new BoardTaskError("goal_title_empty", "Goal title is required");
  if (normalized.length > TITLE_MAX_LENGTH) {
    throw new BoardTaskError("goal_title_too_long", "Goal title is too long");
  }
  return normalized;
}

function normalizeNotes(notes: string): string {
  const normalized = notes.trim();
  if (normalized.length > NOTES_MAX_LENGTH) {
    throw new BoardTaskError("goal_notes_too_long", "Goal notes are too long");
  }
  return normalized;
}

export function createBoardGoalService(input: {
  paseoHome: string;
  tasks: Pick<BoardTaskService, "clearGoal">;
}): BoardGoalService {
  return new BoardGoalService({
    filePath: join(input.paseoHome, "board", "goals.json"),
    tasks: input.tasks,
  });
}
