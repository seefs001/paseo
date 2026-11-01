import { useCallback, useMemo, useState } from "react";
import type { BoardCard } from "@/board/columns";
import type { BoardItem } from "@/board/items";
import type { DeskLanes, DeskNavEntry, DeskZoneId } from "@/components/board/board-desk";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/** Phones open on Decide while anything waits there, else on the first zone with work. */
function defaultCompactZone(zones: readonly DeskZoneId[], lanes: DeskLanes): DeskZoneId {
  if (zones.includes("decide") && lanes.decide.length > 0) return "decide";
  return zones.find((zone) => lanes[zone].length > 0) ?? zones[0] ?? "decide";
}

/** The nearest entry with an item, walking from `index` in `direction`. */
function neighbourWithItem(
  lane: readonly DeskNavEntry[],
  index: number,
  direction: 1 | -1,
): DeskNavEntry | undefined {
  for (let next = index + direction; next >= 0 && next < lane.length; next += direction) {
    if (lane[next]?.item) return lane[next];
  }
  return undefined;
}

export interface BoardSelection {
  selectedKey: string | null;
  /** The selected item while the detail is open. */
  detailItem: BoardItem | null;
  showPrevious: (() => void) | undefined;
  showNext: (() => void) | undefined;
  /** Moves the selection; the detail, when open, follows it. */
  selectEntry: (entry: DeskNavEntry) => void;
  /** A card press: selects and opens the detail. */
  openDetail: (item: BoardItem) => void;
  closeDetail: () => void;
  toggleDetail: () => void;
  /** Esc: closes the detail first, then clears the selection. */
  escape: () => void;
  /** Enter: the agent's tab, or the task's edit sheet. Decisions answer in their brief. */
  openEntry: (entry: DeskNavEntry) => void;
  compactZone: DeskZoneId;
  setCompactZone: (zone: DeskZoneId) => void;
}

/**
 * The selected row is looked up by key in the visible zones on every render, so it follows its
 * item from zone to zone and drops away when filters or focus hide it.
 */
export function useBoardSelection(input: {
  lanes: DeskLanes;
  zones: readonly DeskZoneId[];
  isCompact: boolean;
  onEditTask: (card: BoardCard) => void;
}): BoardSelection {
  const { lanes, zones, isCompact, onEditTask } = input;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pickedZone, setPickedZone] = useState<DeskZoneId | null>(null);

  const found = useMemo(() => {
    if (selectedKey === null) return null;
    for (const zone of zones) {
      const lane = lanes[zone];
      const index = lane.findIndex((entry) => entry.key === selectedKey);
      if (index >= 0) return { lane, index };
    }
    return null;
  }, [lanes, selectedKey, zones]);
  const previous = found ? neighbourWithItem(found.lane, found.index, -1) : undefined;
  const next = found ? neighbourWithItem(found.lane, found.index, 1) : undefined;

  const selectEntry = useCallback(
    (entry: DeskNavEntry) => {
      setSelectedKey(entry.key);
      if (isCompact) setPickedZone(entry.zone);
    },
    [isCompact],
  );
  const openDetail = useCallback((item: BoardItem) => {
    setSelectedKey(item.key);
    setDetailOpen(true);
  }, []);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const toggleDetail = useCallback(() => setDetailOpen((open) => !open), []);
  const escape = useCallback(() => {
    if (detailOpen && found?.lane[found.index]?.item) setDetailOpen(false);
    else setSelectedKey(null);
  }, [detailOpen, found]);
  const openEntry = useCallback(
    (entry: DeskNavEntry) => {
      const { item } = entry;
      if (item?.kind === "agent") {
        navigateToAgent({ serverId: item.serverId, agentId: item.agent.id });
      } else if (item?.kind === "task") {
        onEditTask(item.card);
      }
    },
    [onEditTask],
  );
  const showPrevious = useCallback(() => {
    if (previous) selectEntry(previous);
  }, [previous, selectEntry]);
  const showNext = useCallback(() => {
    if (next) selectEntry(next);
  }, [next, selectEntry]);

  const selected = found ? found.lane[found.index] : null;
  return {
    selectedKey: selected?.key ?? null,
    detailItem: detailOpen ? (selected?.item ?? null) : null,
    showPrevious: previous ? showPrevious : undefined,
    showNext: next ? showNext : undefined,
    selectEntry,
    openDetail,
    closeDetail,
    toggleDetail,
    escape,
    openEntry,
    compactZone:
      pickedZone && zones.includes(pickedZone) ? pickedZone : defaultCompactZone(zones, lanes),
    setCompactZone: setPickedZone,
  };
}
