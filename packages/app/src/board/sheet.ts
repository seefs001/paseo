import type { BoardTask, BoardTaskAttachment } from "@getpaseo/protocol/messages";
import { create } from "zustand";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";

/** What the task sheet opens on. Create targets may arrive prefilled from quick capture. */
export type BoardTaskSheetTarget =
  | {
      mode: "create";
      /** Preferred host; the sheet falls back to the first host that can store tasks. */
      serverId?: string;
      projectId?: string | null;
      title?: string;
      notes?: string;
      attachments?: BoardTaskAttachment[];
      /** Planning stage; quick capture leaves it unset so the task lands in Fog. */
      stage?: BoardTask["stage"];
      /** The goal the task serves, on `serverId`. */
      goalId?: string | null;
      /** Creates a subtask of this task. */
      parentId?: string;
    }
  | { mode: "edit"; serverId: string; task: BoardTask };

type BoardTaskSheetState =
  | { status: "closed"; openCount: number }
  | { status: "open"; openCount: number; visible: boolean; target: BoardTaskSheetTarget };

/** One app-wide task sheet, so the Board, Command Center and composer open the same form. */
export const useBoardTaskSheet = create<BoardTaskSheetState>(() => ({
  status: "closed",
  openCount: 0,
}));

export function openBoardTaskSheet(target: BoardTaskSheetTarget): void {
  useBoardTaskSheet.setState((previous) => ({
    status: "open",
    openCount: previous.openCount + 1,
    visible: true,
    target,
  }));
}

/** Starts the close animation; the sheet unmounts on dismiss. */
export function closeBoardTaskSheet(openCount: number): void {
  useBoardTaskSheet.setState((previous) => {
    if (previous.status !== "open" || previous.openCount !== openCount) return previous;
    return { ...previous, visible: false };
  });
}

export function dismissBoardTaskSheet(openCount: number): void {
  useBoardTaskSheet.setState((previous) => {
    if (previous.status !== "open" || previous.openCount !== openCount) return previous;
    return { status: "closed", openCount };
  });
}

/** Quick capture files tasks under the project of the workspace the user is in. */
export function getWorkspaceProjectId(
  serverId: string,
  workspaceId: string | null | undefined,
): string | null {
  return (
    selectWorkspace(useSessionStore.getState(), serverId, workspaceId ?? null)?.projectId ?? null
  );
}
