import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

// Everything the pin toggle actually needs. Kept narrower than SidebarWorkspaceEntry so the
// global keyboard handler can build one from the active route selection without a sidebar row.
export type PinnableWorkspace = Pick<
  SidebarWorkspaceEntry,
  "serverId" | "workspaceId" | "workspaceKey" | "pinnedAt"
>;

export type WorkspacePinTarget = Omit<PinnableWorkspace, "pinnedAt">;

export type ToggleSidebarWorkspacePin = (workspace: PinnableWorkspace) => void;

// Module scope, not a per-hook ref: the sidebar row menus and the global keyboard shortcut each
// hold their own controller instance, and a per-instance guard would let a keypress and a menu
// click fire two concurrent, opposite setWorkspacePinned calls for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

export function useUnpinSidebarWorkspaces() {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (workspaces: readonly WorkspacePinTarget[]) => {
      if (workspaces.some((workspace) => pendingWorkspaceKeys.has(workspace.workspaceKey))) {
        throw new Error(t("sidebar.pinned.unpinAllFailed"));
      }
      for (const workspace of workspaces) {
        pendingWorkspaceKeys.add(workspace.workspaceKey);
      }
      try {
        const results = await Promise.allSettled(
          workspaces.map(async (workspace) => {
            const client = getHostRuntimeStore().getClient(workspace.serverId);
            if (!client) {
              throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
            }
            await client.setWorkspacePinned(workspace.workspaceId, false);
          }),
        );
        const failures = results.filter((result) => result.status === "rejected");
        if (failures.length > 0) {
          throw new AggregateError(
            failures.map((failure) => failure.reason),
            t("sidebar.pinned.unpinAllFailed"),
          );
        }
      } finally {
        for (const workspace of workspaces) {
          pendingWorkspaceKeys.delete(workspace.workspaceKey);
        }
      }
    },
  });
}

export function useSidebarWorkspacePinController(): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
    }: {
      workspace: PinnableWorkspace;
      pinned: boolean;
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeys.delete(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: PinnableWorkspace) => {
      if (pendingWorkspaceKeys.has(workspace.workspaceKey)) {
        return;
      }
      pendingWorkspaceKeys.add(workspace.workspaceKey);
      mutate({ workspace, pinned: workspace.pinnedAt == null });
    },
    [mutate],
  );
}
