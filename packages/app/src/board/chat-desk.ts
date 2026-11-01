import type { BoardTask } from "@getpaseo/protocol/messages";
import { useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useHostDirectories } from "@/stores/session-store-hooks";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { buildBoardCard, type BoardCard } from "./columns";
import { useBoardTasks } from "./tasks";

/**
 * The unfinished Board task linked to a workspace, as a card: the same task the Desk puts on the
 * workspace's root agent. Null while the host's tasks or directory are loading, or with no link.
 */
export function useWorkspaceBoardCard(
  serverId: string,
  workspaceId: string | null,
): BoardCard | null {
  const serverIds = useMemo(() => [serverId], [serverId]);
  const directory = useHostDirectories(serverIds)[0];
  const host = useBoardTasks((state) => state.hosts[serverId]);
  const serverName = useHosts().find((entry) => entry.serverId === serverId)?.label ?? "";
  return useMemo(() => {
    const target = normalizeWorkspaceOpaqueId(workspaceId);
    if (!target || host?.status !== "ready" || !directory?.hydrated) return null;
    let linked: BoardTask | null = null;
    for (const task of host.tasks.values()) {
      if (task.completedAt !== null) continue;
      if (normalizeWorkspaceOpaqueId(task.workspaceId) !== target) continue;
      if (!linked || task.updatedAt > linked.updatedAt) linked = task;
    }
    if (!linked) return null;
    return buildBoardCard({ serverId, serverName, tasks: host.tasks, directory }, linked);
  }, [directory, host, serverId, serverName, workspaceId]);
}

/** An agent with a permission request or question waiting on the user. */
export interface AwaitingAgent {
  serverId: string;
  agentId: string;
}

const NO_AWAITING: AwaitingAgent[] = [];

/**
 * Every other agent, on any connected host, that waits on the user for a permission or an
 * answer, oldest request first. The agent in view is left out: its own request is already on
 * screen.
 */
export function useAgentsAwaitingInput(serverId: string, agentId: string): AwaitingAgent[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const awaiting: AwaitingAgent[] = [];
      const seen = new Set<string>();
      for (const [hostId, session] of Object.entries(state.sessions)) {
        if (!session || session.pendingPermissions.size === 0) continue;
        for (const permission of session.pendingPermissions.values()) {
          if (hostId === serverId && permission.agentId === agentId) continue;
          const key = `${hostId}:${permission.agentId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          awaiting.push({ serverId: hostId, agentId: permission.agentId });
        }
      }
      return awaiting.length > 0 ? awaiting : NO_AWAITING;
    },
    awaitingEqual,
  );
}

function awaitingEqual(a: AwaitingAgent[], b: AwaitingAgent[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((entry, index) => shallow(entry, b[index]));
}
