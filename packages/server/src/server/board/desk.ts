import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  BOARD_CHECKPOINT_KINDS,
  BOARD_DESK_ZONE_IDS,
  BoardDeskSettingsSchema,
  BoardSnoozeSchema,
  type BoardDeskSettings,
  type BoardSnooze,
} from "@getpaseo/protocol/messages";
import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";
import { writeJsonFileAtomic } from "../atomic-file.js";

const SNOOZE_KEY_MAX_LENGTH = 500;
const ZONE_NAME_MAX_LENGTH = 40;

export type BoardCheckpointKind = (typeof BOARD_CHECKPOINT_KINDS)[number];

export const DEFAULT_BOARD_DESK_SETTINGS: BoardDeskSettings = {
  zones: BOARD_DESK_ZONE_IDS.map((id) => ({ id, visible: true, name: null })),
  decideKinds: [...BOARD_CHECKPOINT_KINDS],
  grouping: "goal",
  landedRetentionDays: 7,
  notifyKinds: ["permission", "question", "failed", "decision"],
};

const BoardDeskFileSchema = z.object({
  version: z.literal(1),
  settings: BoardDeskSettingsSchema.default(DEFAULT_BOARD_DESK_SETTINGS),
  snoozes: z.array(BoardSnoozeSchema).default([]),
});

export type BoardDeskChange =
  | { kind: "snoozes"; snoozes: BoardSnooze[] }
  | { kind: "settings"; settings: BoardDeskSettings };

/** The checkpoint kind an agent attention event shows as on the Desk. */
export function attentionCheckpointKind(
  reason: AgentAttentionReason,
  permissionKind: string | null,
): BoardCheckpointKind {
  if (reason === "permission") return permissionKind === "question" ? "question" : "permission";
  return reason === "error" ? "failed" : "review";
}

interface BoardDeskStoreDeps {
  filePath: string;
  now?: () => Date;
}

/** How the Desk works on this host, and the checkpoints the user put off. */
export class BoardDeskStore {
  private settings: BoardDeskSettings = DEFAULT_BOARD_DESK_SETTINGS;
  private snoozes = new Map<string, string>();
  private readonly listeners = new Set<(change: BoardDeskChange) => void>();
  private operations: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: BoardDeskStoreDeps) {
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
    const file = BoardDeskFileSchema.parse(JSON.parse(raw));
    this.settings = normalizeSettings(file.settings);
    for (const snooze of file.snoozes) this.snoozes.set(snooze.key, snooze.until);
  }

  getSettings(): BoardDeskSettings {
    return this.settings;
  }

  /** Snoozes that have not woken yet. */
  listSnoozes(): BoardSnooze[] {
    const now = this.now().getTime();
    return [...this.snoozes]
      .filter(([, until]) => Date.parse(until) > now)
      .map(([key, until]) => ({ key, until }));
  }

  subscribe(listener: (change: BoardDeskChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSettings(settings: BoardDeskSettings): Promise<BoardDeskSettings> {
    return this.mutate(() => {
      this.settings = normalizeSettings(settings);
      return { kind: "settings", settings: this.settings };
    }).then(() => this.settings);
  }

  /** `until: null`, or a time already past, wakes the checkpoint now. */
  setSnooze(key: string, until: Date | null): Promise<BoardSnooze[]> {
    return this.mutate(() => {
      if (!key || key.length > SNOOZE_KEY_MAX_LENGTH) {
        throw new Error("Snooze key must be 1 to 500 characters");
      }
      if (until !== null && Number.isNaN(until.getTime())) throw new Error("Invalid snooze time");
      const now = this.now();
      const snoozes = new Map(this.snoozes);
      if (until === null || until <= now) snoozes.delete(key);
      else snoozes.set(key, until.toISOString());
      // Woken snoozes are dropped whenever the file is written.
      for (const [snoozed, wake] of snoozes) {
        if (Date.parse(wake) <= now.getTime()) snoozes.delete(snoozed);
      }
      this.snoozes = snoozes;
      return { kind: "snoozes", snoozes: this.listSnoozes() };
    }).then(() => this.listSnoozes());
  }

  private mutate(apply: () => BoardDeskChange): Promise<BoardDeskChange> {
    const run = this.operations.then(async () => {
      const previous = { settings: this.settings, snoozes: this.snoozes };
      const change = apply();
      try {
        await writeJsonFileAtomic(this.deps.filePath, {
          version: 1,
          settings: this.settings,
          snoozes: [...this.snoozes].map(([key, until]) => ({ key, until })),
        });
      } catch (error) {
        this.settings = previous.settings;
        this.snoozes = previous.snoozes;
        throw error;
      }
      for (const listener of this.listeners) listener(change);
      return change;
    });
    this.operations = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** Every zone appears exactly once; zones missing from the input keep their default place at the end. */
function normalizeSettings(settings: BoardDeskSettings): BoardDeskSettings {
  const seen = new Set<string>();
  const zones: BoardDeskSettings["zones"] = [];
  for (const zone of settings.zones) {
    if (seen.has(zone.id)) continue;
    seen.add(zone.id);
    const name = zone.name?.replace(/\s+/g, " ").trim().slice(0, ZONE_NAME_MAX_LENGTH) || null;
    zones.push({ id: zone.id, visible: zone.visible, name });
  }
  for (const id of BOARD_DESK_ZONE_IDS) {
    if (!seen.has(id)) zones.push({ id, visible: true, name: null });
  }
  return {
    ...settings,
    zones,
    decideKinds: [...new Set(settings.decideKinds)],
    notifyKinds: [...new Set(settings.notifyKinds)],
  };
}

export function createBoardDeskStore(input: { paseoHome: string }): BoardDeskStore {
  return new BoardDeskStore({ filePath: join(input.paseoHome, "board", "desk.json") });
}
