import { useCallback, type ReactElement } from "react";
import { closeDeskGoalSheet, dismissDeskGoalSheet, useDeskGoalSheet } from "@/board/goal-sheet";
import { DeskGoalSheet } from "@/components/board/goal-sheet";

/** Mounted once in the app shell; renders the goal sheet wherever it was opened from. */
export function DeskGoalSheetHost(): ReactElement | null {
  const sheet = useDeskGoalSheet();
  const { openCount } = sheet;
  const close = useCallback(() => closeDeskGoalSheet(openCount), [openCount]);
  const dismiss = useCallback(() => dismissDeskGoalSheet(openCount), [openCount]);
  if (sheet.status !== "open") return null;
  return (
    <DeskGoalSheet
      key={sheet.openCount}
      target={sheet.target}
      visible={sheet.visible}
      onClose={close}
      onDismiss={dismiss}
    />
  );
}
