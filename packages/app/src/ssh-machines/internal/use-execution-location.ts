import type { WorkspaceExecutionLocation } from "@getpaseo/protocol/ssh-workspaces";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import { useSessionStore } from "@/stores/session-store";

export function useWorkspaceExecutionLocation(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceExecutionLocation | null {
  return useSessionStore(
    (state) => selectWorkspace(state, serverId, workspaceId)?.executionLocation ?? null,
  );
}

// Whether this connection holds a daemon permission. Daemons that predate session
// permissions report none; the daemon still checks every request.
export function useHostPermission(serverId: string, permission: string): boolean {
  return useSessionStore((state) => {
    const permissions = state.sessions[serverId]?.serverInfo?.permissions;
    return permissions === undefined || (permissions as readonly string[]).includes(permission);
  });
}
