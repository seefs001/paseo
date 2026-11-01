import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  BoardDecisionOptionSchema,
  BoardDecisionSchema,
  type BoardDecision,
} from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { BoardGoalService } from "./goals.js";
import type { BoardTaskStartInput, BoardTaskStartResult } from "./start.js";
import { BoardTaskError, type BoardTaskService } from "./tasks.js";

const TITLE_MAX_LENGTH = 200;
const BRIEF_MAX_LENGTH = 20_000;
const NOTE_MAX_LENGTH = 5_000;
const OPTION_LABEL_MAX_LENGTH = 100;
const OPTIONS_MAX_COUNT = 8;
/** Resolved decisions stay listed this long, then the file drops them. */
const RESOLVED_RETENTION_MS = 24 * 60 * 60 * 1000;

export type BoardDecisionOption = z.infer<typeof BoardDecisionOptionSchema>;

export const AUTOPILOT_START_OPTIONS: BoardDecisionOption[] = [
  { id: "start", label: "Start" },
  { id: "skip", label: "Skip" },
];

const StoredBoardDecisionSchema = BoardDecisionSchema.extend({
  /** For `autopilot_start`: the task version the question is about. */
  taskUpdatedAt: z.string().nullable().default(null),
});
type StoredBoardDecision = z.infer<typeof StoredBoardDecisionSchema>;

/** A task version the user told Autopilot not to start. */
const AutopilotSkipSchema = z.object({ taskId: z.string(), taskUpdatedAt: z.string() });
type AutopilotSkip = z.infer<typeof AutopilotSkipSchema>;

const BoardDecisionFileSchema = z.object({
  version: z.literal(1),
  decisions: z.array(StoredBoardDecisionSchema),
  skips: z.array(AutopilotSkipSchema).default([]),
});

/** `created` is daemon-side only: it tells a new question from a resolution. */
export interface BoardDecisionChange {
  kind: "decision";
  decision: BoardDecision;
  created: boolean;
}

export interface BoardDecisionCreateInput {
  kind: BoardDecision["kind"];
  goalId: string | null;
  taskId: string | null;
  agentId: string | null;
  title: string;
  brief: string;
  options: BoardDecisionOption[];
  taskUpdatedAt?: string;
}

export interface BoardDecisionResolveInput {
  decisionId: string;
  choiceId: string;
  note?: string | null;
}

/** What answering a decision does. A failure keeps the decision open. */
export type BoardDecisionEffect = (
  decision: BoardDecision,
  choice: BoardDecisionOption,
  note: string | null,
) => Promise<void>;

interface BoardDecisionServiceDeps {
  filePath: string;
  effect: BoardDecisionEffect;
  now?: () => Date;
}

/**
 * Questions waiting on the user, from agents and from goal Autopilot. Mutations are serialized
 * and written atomically to one JSON file, then announced to subscribers.
 */
export class BoardDecisionService {
  private decisions = new Map<string, StoredBoardDecision>();
  private skips = new Map<string, string>();
  private readonly listeners = new Set<(change: BoardDecisionChange) => void>();
  private operations: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: BoardDecisionServiceDeps) {
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
    const file = BoardDecisionFileSchema.parse(JSON.parse(raw));
    for (const decision of file.decisions) this.decisions.set(decision.id, decision);
    for (const skip of file.skips) this.skips.set(skip.taskId, skip.taskUpdatedAt);
  }

  /** Unresolved decisions, plus those resolved in the last day. */
  list(): BoardDecision[] {
    const cutoff = this.now().getTime() - RESOLVED_RETENTION_MS;
    return [...this.decisions.values()]
      .filter(
        (decision) => decision.resolvedAt === null || Date.parse(decision.resolvedAt) > cutoff,
      )
      .map(toWire);
  }

  get(decisionId: string): BoardDecision | null {
    const stored = this.decisions.get(decisionId);
    return stored ? toWire(stored) : null;
  }

  /** Open `autopilot_start` questions with the task version each asks about. */
  listOpenAutopilotStarts(): { decision: BoardDecision; taskUpdatedAt: string | null }[] {
    return [...this.decisions.values()]
      .filter((decision) => decision.kind === "autopilot_start" && decision.resolvedAt === null)
      .map((decision) => ({ decision: toWire(decision), taskUpdatedAt: decision.taskUpdatedAt }));
  }

  /** Whether the user skipped this version of the task; any change to the task asks again. */
  isSkipped(taskId: string, taskUpdatedAt: string): boolean {
    return this.skips.get(taskId) === taskUpdatedAt;
  }

  /** Registers synchronously, so a caller that reads `list()` in the same tick misses nothing. */
  subscribe(listener: (change: BoardDecisionChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(input: BoardDecisionCreateInput): Promise<BoardDecision> {
    return this.mutate(async () => {
      const decision: StoredBoardDecision = {
        id: `dec_${randomBytes(8).toString("hex")}`,
        kind: input.kind,
        goalId: input.goalId,
        taskId: input.taskId,
        agentId: input.agentId,
        title: normalizeTitle(input.title),
        brief: normalizeBrief(input.brief),
        options: normalizeOptions(input.options),
        createdAt: this.now().toISOString(),
        resolvedAt: null,
        choiceId: null,
        note: null,
        taskUpdatedAt: input.taskUpdatedAt ?? null,
      };
      return { decision, created: true };
    });
  }

  /** Runs the answer's effect first; the decision is resolved only when the effect succeeds. */
  resolve(input: BoardDecisionResolveInput): Promise<BoardDecision> {
    return this.mutate(async () => {
      const current = this.decisions.get(input.decisionId);
      if (!current) throw new BoardTaskError("decision_not_found", "Decision not found");
      if (current.resolvedAt !== null) {
        throw new BoardTaskError("decision_resolved", "Decision is already answered");
      }
      const choice = current.options.find((option) => option.id === input.choiceId);
      if (!choice) throw new BoardTaskError("decision_invalid", "Choice is not an option");
      const note = normalizeNote(input.note ?? null);
      await this.deps.effect(toWire(current), choice, note);
      const decision: StoredBoardDecision = {
        ...current,
        resolvedAt: this.now().toISOString(),
        choiceId: choice.id,
        note,
      };
      const skip =
        decision.kind === "autopilot_start" &&
        choice.id === "skip" &&
        decision.taskId !== null &&
        decision.taskUpdatedAt !== null
          ? { taskId: decision.taskId, taskUpdatedAt: decision.taskUpdatedAt }
          : undefined;
      return { decision, created: false, skip };
    });
  }

  /** Closes a question that no longer applies, without a choice. Closed ones stay closed. */
  cancel(decisionId: string): Promise<BoardDecision | null> {
    return this.mutate(async () => {
      const current = this.decisions.get(decisionId);
      if (!current || current.resolvedAt !== null) return null;
      return {
        decision: { ...current, resolvedAt: this.now().toISOString() },
        created: false,
      };
    });
  }

  private mutate(stage: () => Promise<Outcome>): Promise<BoardDecision>;
  private mutate(stage: () => Promise<Outcome | null>): Promise<BoardDecision | null>;
  private mutate(stage: () => Promise<Outcome | null>): Promise<BoardDecision | null> {
    const run = this.operations.then(async () => {
      const outcome = await stage();
      if (!outcome) return null;
      const cutoff = this.now().getTime() - RESOLVED_RETENTION_MS;
      const decisions = new Map(this.decisions);
      decisions.set(outcome.decision.id, outcome.decision);
      for (const [id, decision] of decisions) {
        if (decision.resolvedAt !== null && Date.parse(decision.resolvedAt) <= cutoff) {
          decisions.delete(id);
        }
      }
      const skips = new Map(this.skips);
      if (outcome.skip) skips.set(outcome.skip.taskId, outcome.skip.taskUpdatedAt);
      await writeJsonFileAtomic(this.deps.filePath, {
        version: 1,
        decisions: [...decisions.values()],
        skips: [...skips].map(([taskId, taskUpdatedAt]) => ({ taskId, taskUpdatedAt })),
      });
      this.decisions = decisions;
      this.skips = skips;
      const change: BoardDecisionChange = {
        kind: "decision",
        decision: toWire(outcome.decision),
        created: outcome.created,
      };
      for (const listener of this.listeners) listener(change);
      return change.decision;
    });
    this.operations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

interface Outcome {
  decision: StoredBoardDecision;
  created: boolean;
  skip?: AutopilotSkip;
}

function toWire(stored: StoredBoardDecision): BoardDecision {
  const { taskUpdatedAt: _taskUpdatedAt, ...decision } = stored;
  return decision;
}

function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > TITLE_MAX_LENGTH) {
    throw new BoardTaskError("decision_invalid", "Decision title must be 1 to 200 characters");
  }
  return normalized;
}

function normalizeBrief(brief: string): string {
  const normalized = brief.trim();
  if (normalized.length > BRIEF_MAX_LENGTH) {
    throw new BoardTaskError("decision_invalid", "Decision brief is too long");
  }
  return normalized;
}

function normalizeNote(note: string | null): string | null {
  const normalized = note?.trim() ?? "";
  if (normalized.length > NOTE_MAX_LENGTH) {
    throw new BoardTaskError("decision_invalid", "Decision note is too long");
  }
  return normalized || null;
}

function normalizeOptions(options: readonly BoardDecisionOption[]): BoardDecisionOption[] {
  const normalized = options.map((option) => ({
    id: option.id.trim(),
    label: option.label.replace(/\s+/g, " ").trim(),
  }));
  const ids = new Set(normalized.map((option) => option.id));
  const invalid =
    normalized.length === 0 ||
    normalized.length > OPTIONS_MAX_COUNT ||
    ids.size !== normalized.length ||
    normalized.some(
      (option) => !option.id || !option.label || option.label.length > OPTION_LABEL_MAX_LENGTH,
    );
  if (invalid) {
    throw new BoardTaskError(
      "decision_invalid",
      "A decision needs 1 to 8 options with unique ids and labels",
    );
  }
  return normalized;
}

export interface BoardDecisionEffectDeps {
  tasks: Pick<BoardTaskService, "find">;
  goals: Pick<BoardGoalService, "get" | "recordAutopilotStart">;
  startBoardTask(input: BoardTaskStartInput): Promise<BoardTaskStartResult>;
  /** Sends the user's answer to the agent that asked. */
  sendAgentPrompt(agentId: string, prompt: string): Promise<void>;
}

/**
 * Answers go back to the asking agent as a prompt. `start` on an Autopilot question starts the
 * task with the goal's Autopilot settings and counts against today's limit; `skip` only records.
 */
export function createBoardDecisionEffect(deps: BoardDecisionEffectDeps): BoardDecisionEffect {
  return async (decision, choice, note) => {
    if (decision.kind === "agent") {
      if (decision.agentId === null) return;
      const lines = [
        `The user answered your Desk decision "${decision.title}" (${decision.id}): ${choice.label}`,
      ];
      if (note) lines.push(`Note: ${note}`);
      await deps.sendAgentPrompt(decision.agentId, lines.join("\n\n"));
      return;
    }
    if (choice.id !== "start") return;
    const task = decision.taskId === null ? null : deps.tasks.find(decision.taskId);
    if (!task) throw new BoardTaskError("task_not_found", "Task not found");
    const goal = decision.goalId === null ? null : deps.goals.get(decision.goalId);
    if (!goal) throw new BoardTaskError("goal_not_found", "Goal not found");
    if (!goal.autopilot?.enabled) {
      throw new BoardTaskError("autopilot_off", "Autopilot is off for this goal");
    }
    await deps.startBoardTask({
      taskId: task.id,
      isolation: goal.autopilot.isolation,
      agent: goal.autopilot.agent,
      idempotencyKey: `board-decision:${decision.id}`,
    });
    await deps.goals.recordAutopilotStart(goal.id, null);
  };
}

export function createBoardDecisionService(input: {
  paseoHome: string;
  effect: BoardDecisionEffect;
}): BoardDecisionService {
  return new BoardDecisionService({
    filePath: join(input.paseoHome, "board", "decisions.json"),
    effect: input.effect,
  });
}
