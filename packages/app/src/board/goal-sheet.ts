import type { BoardGoal } from "@getpaseo/protocol/messages";
import { create } from "zustand";

/** What the goal sheet opens on. */
export type DeskGoalSheetTarget =
  | { mode: "create"; serverId: string }
  | { mode: "edit"; serverId: string; goal: BoardGoal };

type DeskGoalSheetState =
  | { status: "closed"; openCount: number }
  | { status: "open"; openCount: number; visible: boolean; target: DeskGoalSheetTarget };

/** One app-wide goal sheet, so the Desk, its menus and Command Center open the same form. */
export const useDeskGoalSheet = create<DeskGoalSheetState>(() => ({
  status: "closed",
  openCount: 0,
}));

export function openDeskGoalSheet(target: DeskGoalSheetTarget): void {
  useDeskGoalSheet.setState((previous) => ({
    status: "open",
    openCount: previous.openCount + 1,
    visible: true,
    target,
  }));
}

/** Starts the close animation; the sheet unmounts on dismiss. */
export function closeDeskGoalSheet(openCount: number): void {
  useDeskGoalSheet.setState((previous) => {
    if (previous.status !== "open" || previous.openCount !== openCount) return previous;
    return { ...previous, visible: false };
  });
}

export function dismissDeskGoalSheet(openCount: number): void {
  useDeskGoalSheet.setState((previous) => {
    if (previous.status !== "open" || previous.openCount !== openCount) return previous;
    return { status: "closed", openCount };
  });
}
