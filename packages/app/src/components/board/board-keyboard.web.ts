import { useEffect, useRef } from "react";
import {
  DESK_ZONES_TEST_ID,
  deskEntryDomId,
  type DeskNavEntry,
} from "@/components/board/board-desk";
import { BOARD_SEARCH_TEST_ID } from "@/components/board/board-toolbar";
import { resolveKeyboardFocusScope } from "@/keyboard/focus-scope";
import { hasActiveOverlay } from "@/keyboard";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import type { BoardKeyboardInput } from "./board-keyboard";

export type { BoardKeyboardInput } from "./board-keyboard";

type Move = "up" | "down" | "left" | "right";

const MOVE_BY_KEY: Record<string, Move> = {
  j: "down",
  k: "up",
  h: "left",
  l: "right",
};

function locate(
  lanes: readonly (readonly DeskNavEntry[])[],
  key: string | null,
): { lane: number; row: number } | null {
  if (key === null) return null;
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const row = lanes[lane]?.findIndex((item) => item.key === key) ?? -1;
    if (row >= 0) return { lane, row };
  }
  return null;
}

function step(
  lanes: readonly (readonly DeskNavEntry[])[],
  selectedKey: string | null,
  move: Move,
): DeskNavEntry | null {
  const at = locate(lanes, selectedKey);
  if (!at) return lanes.find((lane) => lane.length > 0)?.[0] ?? null;
  const lane = lanes[at.lane] ?? [];
  if (move === "down") return lane[Math.min(at.row + 1, lane.length - 1)] ?? null;
  if (move === "up") return lane[Math.max(at.row - 1, 0)] ?? null;
  // Across zones, skip empty ones and keep the row as close as the next lane allows.
  const direction = move === "right" ? 1 : -1;
  for (let next = at.lane + direction; next >= 0 && next < lanes.length; next += direction) {
    const target = lanes[next] ?? [];
    if (target.length > 0) return target[Math.min(at.row, target.length - 1)] ?? null;
  }
  return null;
}

function revealItem(key: string): void {
  requestAnimationFrame(() => {
    document
      .getElementById(deskEntryDomId(key))
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function focusSearch(): void {
  const field = document.querySelector<HTMLElement>(`[data-testid="${BOARD_SEARCH_TEST_ID}"]`);
  field?.focus();
}

/** Enter and Space on a focused toolbar or panel control press that control, not the Desk. */
function pressesFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body) return false;
  return target.closest(`[data-testid='${DESK_ZONES_TEST_ID}']`) === null;
}

/**
 * J/K move down and up a zone, through its groups; H/L move across zones. Enter opens, Space
 * toggles the detail, / searches, Esc backs out. Keys typed into a field, or while a menu or
 * dialog is up, are left alone.
 */
export function useBoardKeyboard(input: BoardKeyboardInput): void {
  const latest = useRef(input);
  latest.current = input;
  const { enabled } = input;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isImeComposingKeyboardEvent(event) || hasActiveOverlay()) return;
      const scope = resolveKeyboardFocusScope({
        target: event.target,
        commandCenterOpen: useKeyboardShortcutsStore.getState().commandCenterOpen,
      });
      if (scope !== "other") return;
      const { lanes, selectedKey, onSelect, onOpen, onToggleDetail, onEscape } = latest.current;
      const key = event.key;
      const move = MOVE_BY_KEY[key.toLowerCase()];
      if (move && !event.shiftKey) {
        event.preventDefault();
        const next = step(lanes, selectedKey, move);
        if (next) {
          onSelect(next);
          revealItem(next.key);
        }
        return;
      }
      if (key === "/") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (key === "Escape") {
        onEscape();
        return;
      }
      const at = locate(lanes, selectedKey);
      const selected = at ? lanes[at.lane]?.[at.row] : undefined;
      if (!selected || pressesFocusedControl(event.target)) return;
      if (key === "Enter") {
        event.preventDefault();
        onOpen(selected);
      } else if (key === " ") {
        event.preventDefault();
        onToggleDetail();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
