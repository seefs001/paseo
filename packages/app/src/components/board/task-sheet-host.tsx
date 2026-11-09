import { useCallback, useMemo, type ReactElement } from "react";
import { closeBoardTaskSheet, dismissBoardTaskSheet, useBoardTaskSheet } from "@/board/sheet";
import { BoardTaskSheet, type BoardTaskSheetHost } from "@/components/board/task-sheet";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import type { ProjectDescriptor } from "@/stores/session-store";
import { useHostDirectories } from "@/stores/session-store-hooks";

function sortProjects(projects: ReadonlyMap<string, ProjectDescriptor>): ProjectDescriptor[] {
  return [...projects.values()].sort((a, b) =>
    (a.projectCustomName ?? a.projectDisplayName).localeCompare(
      b.projectCustomName ?? b.projectDisplayName,
    ),
  );
}

/** Mounted once in the app shell; renders the task sheet wherever it was opened from. */
export function BoardTaskSheetHostView(): ReactElement | null {
  const sheet = useBoardTaskSheet();
  if (sheet.status !== "open") return null;
  return (
    <OpenBoardTaskSheet
      key={sheet.openCount}
      openCount={sheet.openCount}
      target={sheet.target}
      visible={sheet.visible}
    />
  );
}

function OpenBoardTaskSheet({
  openCount,
  target,
  visible,
}: {
  openCount: number;
  target: Parameters<typeof BoardTaskSheet>[0]["target"];
  visible: boolean;
}): ReactElement {
  const close = useCallback(() => closeBoardTaskSheet(openCount), [openCount]);
  const dismiss = useCallback(() => dismissBoardTaskSheet(openCount), [openCount]);
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const supportsBoard = useHostFeatureMap(serverIds, "boardTasks");
  const eligibleIds = useMemo(
    () =>
      serverIds.filter(
        (serverId) =>
          connectionStatuses.get(serverId) === "online" && supportsBoard.get(serverId) === true,
      ),
    [connectionStatuses, serverIds, supportsBoard],
  );
  const directories = useHostDirectories(eligibleIds);
  const sheetHosts = useMemo<BoardTaskSheetHost[]>(
    () =>
      directories.map((directory) => ({
        serverId: directory.serverId,
        label:
          hosts.find((host) => host.serverId === directory.serverId)?.label ?? directory.serverId,
        projects: sortProjects(directory.projects),
      })),
    [directories, hosts],
  );
  return (
    <BoardTaskSheet
      target={target}
      visible={visible}
      hosts={sheetHosts}
      onClose={close}
      onDismiss={dismiss}
    />
  );
}
