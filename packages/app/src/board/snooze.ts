import type { DeskCheckpoint } from "./desk";
import { setBoardSnooze } from "./tasks";

export interface SnoozePreset {
  id: string;
  labelKey: string;
  until: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const EVENING_HOUR = 19;
const MORNING_HOUR = 9;

function atHour(day: Date, hour: number, offsetDays = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, hour);
}

/** Three hours out, on the next quarter hour, so wake times read as round clock times. */
function laterToday(now: Date): Date {
  const quarter = 15 * 60 * 1000;
  return new Date(Math.ceil((now.getTime() + 3 * HOUR_MS) / quarter) * quarter);
}

/**
 * Where a checkpoint can be put off to, soonest first. "Later today" and "Tonight" drop out once
 * they would land after the evening; next week is the coming Monday morning.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [];
  const later = laterToday(now);
  const evening = atHour(now, EVENING_HOUR);
  if (later < evening) {
    presets.push({ id: "later_today", labelKey: "board.brief.snooze.laterToday", until: later });
  }
  if (now.getTime() < evening.getTime() - HOUR_MS) {
    presets.push({ id: "tonight", labelKey: "board.brief.snooze.tonight", until: evening });
  }
  presets.push({
    id: "tomorrow",
    labelKey: "board.brief.snooze.tomorrow",
    until: atHour(now, MORNING_HOUR, 1),
  });
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  presets.push({
    id: "next_week",
    labelKey: "board.brief.snooze.nextWeek",
    until: atHour(now, MORNING_HOUR, daysToMonday),
  });
  return presets;
}

/** Puts the checkpoint off until `until`; `null` wakes it now. */
export function snoozeCheckpoint(checkpoint: DeskCheckpoint, until: Date | null): Promise<void> {
  return setBoardSnooze(checkpoint.serverId, { key: checkpoint.key, until });
}
