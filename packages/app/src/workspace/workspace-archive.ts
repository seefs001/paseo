import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { getDesktopHost } from "@/desktop/host";
import { removeResidentBrowserWebview } from "@/desktop/browser/resident-webviews";
import { useBrowserStore } from "@/desktop/browser/store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { i18n } from "@/i18n/i18next";

export interface WorkspaceArchiveTarget {
  serverId: string;
  workspaceId: string;
}

interface WorkspaceArchiveClient {
  archiveWorkspace: (workspaceId: string) => Promise<{ error: string | null }>;
}

interface OptimisticWorkspaceArchiveSnapshot {
  workspace: WorkspaceDescriptor | null;
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function isWorkspaceArchiveFailure(error: unknown): error is WorkspaceArchiveFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "serverId" in error &&
    typeof error.serverId === "string" &&
    "workspaceId" in error &&
    typeof error.workspaceId === "string" &&
    "error" in error
  );
}

function hideWorkspaceOptimistically(
  workspace: WorkspaceArchiveTarget,
): OptimisticWorkspaceArchiveSnapshot {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
  markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  getHostRuntimeStore().removeWorkspaceSnapshot(workspace.serverId, workspace.workspaceId);
  return { workspace: snapshot };
}

function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  workspaceId: string;
  snapshot: OptimisticWorkspaceArchiveSnapshot;
}): void {
  clearWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (input.snapshot.workspace) {
    getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [input.snapshot.workspace]);
  }
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<void> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.error) {
    throw new Error(payload.error);
  }
}

function purgeArchivedWorkspaceState(workspace: WorkspaceArchiveTarget): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(workspace);
  if (!workspaceKey) return;

  const layout = useWorkspaceLayoutStore.getState();
  const tabs = [
    ...layout.getWorkspaceTabs(workspaceKey),
    ...(layout.sheetsByWorkspace[workspaceKey] ?? []).map((sheet) => sheet.tab),
  ];
  const browserIds = new Set(
    tabs.flatMap((tab) => (tab.target.kind === "browser" ? [tab.target.browserId] : [])),
  );
  for (const browserId of browserIds) {
    useBrowserStore.getState().removeBrowser(browserId);
    removeResidentBrowserWebview(browserId);
    void getDesktopHost()
      ?.browser?.unregisterWorkspaceBrowser?.(browserId)
      .catch((error) => {
        console.error("[workspace-archive] browser unregister failed", error);
      });
  }
  layout.purgeWorkspace(workspaceKey);
}

export async function archiveWorkspaceOptimistically(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): Promise<void> {
  const snapshot = hideWorkspaceOptimistically(input.workspace);

  try {
    await archiveWorkspaceOrThrow({
      client: input.client,
      workspaceId: input.workspace.workspaceId,
    });
  } catch (error) {
    restoreOptimisticallyHiddenWorkspace({
      serverId: input.workspace.serverId,
      workspaceId: input.workspace.workspaceId,
      snapshot,
    });
    throw error;
  }
  purgeArchivedWorkspaceState(input.workspace);
}

export async function archiveWorkspacesOptimistically(input: {
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspaces: WorkspaceArchiveTarget[];
}): Promise<WorkspaceArchiveFailure[]> {
  const results = await Promise.allSettled(
    input.workspaces.map(async (workspace) => {
      const client = input.getClient(workspace.serverId);
      if (!client) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error: new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected")),
        } satisfies WorkspaceArchiveFailure;
      }

      try {
        await archiveWorkspaceOptimistically({
          client,
          workspace,
        });
      } catch (error) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error,
        } satisfies WorkspaceArchiveFailure;
      }
    }),
  );

  return results.flatMap((result) =>
    result.status === "rejected" && isWorkspaceArchiveFailure(result.reason) ? [result.reason] : [],
  );
}
