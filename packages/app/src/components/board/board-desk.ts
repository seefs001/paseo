import type { BoardDeskSettings } from "@getpaseo/protocol/messages";
import type { BoardCard } from "@/board/columns";
import type { DeskCheckpoint, DeskGroup, DeskModel } from "@/board/desk";
import type { BoardItem, BoardTaskItem } from "@/board/items";

export type DeskZoneId = BoardDeskSettings["zones"][number]["id"];

/**
 * One selectable row on the Desk. Keyboard navigation and the detail walk these in screen order;
 * a decision has no item, so it can be selected but has no detail.
 */
export interface DeskNavEntry {
  key: string;
  zone: DeskZoneId;
  item: BoardItem | null;
}

export type DeskLanes = Record<DeskZoneId, DeskNavEntry[]>;

export function cardItem(card: BoardCard): BoardTaskItem {
  return {
    kind: "task",
    key: card.key,
    serverId: card.serverId,
    serverName: card.serverName,
    column: card.column,
    sortTime: card.sortTime,
    card,
  };
}

export function checkpointNavKey(checkpoint: DeskCheckpoint): string {
  return checkpoint.item?.key ?? checkpoint.key;
}

function groupEntries(zone: DeskZoneId, groups: readonly DeskGroup<BoardItem[]>[]): DeskNavEntry[] {
  return groups.flatMap((group) => group.entries.map((item) => ({ key: item.key, zone, item })));
}

/** Every zone's rows in the order the zone draws them. */
export function buildDeskLanes(model: DeskModel): DeskLanes {
  return {
    decide: model.decide.map((checkpoint) => ({
      key: checkpointNavKey(checkpoint),
      zone: "decide",
      item: checkpoint.item,
    })),
    flight: groupEntries("flight", model.flight),
    ahead: model.ahead.flatMap((group) =>
      [...group.entries.ready, ...group.entries.fog].map((card) => ({
        key: card.key,
        zone: "ahead" as const,
        item: cardItem(card),
      })),
    ),
    landed: groupEntries("landed", model.landed),
  };
}

export function countDeskZone(model: DeskModel, zone: DeskZoneId): number {
  switch (zone) {
    case "decide":
      return model.decide.length;
    case "flight":
      return model.flight.reduce((count, group) => count + group.entries.length, 0);
    case "ahead":
      return model.ahead.reduce(
        (count, group) => count + group.entries.ready.length + group.entries.fog.length,
        0,
      );
    case "landed":
      return model.landed.reduce((count, group) => count + group.entries.length, 0);
  }
}

export interface DeskGroupCounts {
  decide: number;
  flight: number;
  ahead: number;
}

const NO_COUNTS: DeskGroupCounts = { decide: 0, flight: 0, ahead: 0 };

/** The key `buildDeskModel` gives a checkpoint's group when the Desk groups by goal. */
function checkpointGroupKey(checkpoint: DeskCheckpoint): string {
  return checkpoint.goal
    ? `${checkpoint.serverId}:goal:${checkpoint.goal.id}`
    : `${checkpoint.serverId}:loose`;
}

/** Decide, Flight and Ahead counts per group key, from a model grouped by goal. */
export function countDeskGroups(model: DeskModel): ReadonlyMap<string, DeskGroupCounts> {
  const counts = new Map<string, DeskGroupCounts>();
  const bump = (key: string, field: keyof DeskGroupCounts, by: number) => {
    const current = counts.get(key) ?? NO_COUNTS;
    counts.set(key, { ...current, [field]: current[field] + by });
  };
  for (const checkpoint of model.decide) bump(checkpointGroupKey(checkpoint), "decide", 1);
  for (const group of model.flight) bump(group.key, "flight", group.entries.length);
  for (const group of model.ahead) {
    bump(group.key, "ahead", group.entries.ready.length + group.entries.fog.length);
  }
  return counts;
}

export function groupCounts(
  counts: ReadonlyMap<string, DeskGroupCounts>,
  key: string,
): DeskGroupCounts {
  return counts.get(key) ?? NO_COUNTS;
}

/** DOM id of a row's wrapper, so web keyboard navigation can scroll it into view. */
export function deskEntryDomId(key: string): string {
  return `board-item-${key}`;
}

/** testID of the zones area; keys pressed on controls outside it belong to those controls. */
export const DESK_ZONES_TEST_ID = "board-zones";
