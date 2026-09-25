import { useMemo } from "react";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

type RecencyAgent = Pick<
  Agent,
  "id" | "workspaceId" | "updatedAt" | "lastActivityAt" | "archivedAt"
>;
type RecencyWorkspace = Pick<
  SidebarWorkspaceEntry,
  "workspaceKey" | "serverId" | "statusEnteredAt"
>;
type WorkspaceRecency = ReadonlyMap<string, number>;

interface RecencySession {
  agents: ReadonlyMap<string, RecencyAgent>;
  agentDetails: ReadonlyMap<string, RecencyAgent>;
}

interface RecencyState {
  sessions: Record<string, RecencySession | undefined>;
  agentLastActivity: ReadonlyMap<string, Date>;
}

const EMPTY_RECENCY: WorkspaceRecency = new Map();
function emptyRecency(): WorkspaceRecency {
  return EMPTY_RECENCY;
}

function addAgentUpdates(input: {
  timestamps: Map<string, number>;
  serverId: string;
  agents: ReadonlyMap<string, RecencyAgent>;
  streamActivity: ReadonlyMap<string, Date>;
}) {
  for (const agent of input.agents.values()) {
    if (agent.archivedAt || !agent.workspaceId) continue;
    const key = `${input.serverId}:${agent.workspaceId}`;
    const current = input.timestamps.get(key);
    if (current === undefined) continue;
    input.timestamps.set(
      key,
      Math.max(
        current,
        agent.updatedAt.getTime(),
        agent.lastActivityAt.getTime(),
        input.streamActivity.get(agent.id)?.getTime() ?? 0,
      ),
    );
  }
}

export function createSidebarRecencySelector(workspaces: ReadonlyMap<string, RecencyWorkspace>) {
  const serverIds = [...new Set([...workspaces.values()].map((workspace) => workspace.serverId))];
  let lastActivity: RecencyState["agentLastActivity"] | null = null;
  let lastSessions: RecencyState["sessions"] = {};
  let previous: WorkspaceRecency = EMPTY_RECENCY;
  return (state: RecencyState): WorkspaceRecency => {
    const sameSources = serverIds.every(
      (id) =>
        lastSessions[id]?.agents === state.sessions[id]?.agents &&
        lastSessions[id]?.agentDetails === state.sessions[id]?.agentDetails,
    );
    if (lastActivity === state.agentLastActivity && sameSources) return previous;
    lastActivity = state.agentLastActivity;
    // Keep source-map identities without retaining old session timelines.
    lastSessions = {};
    const timestamps = new Map(
      [...workspaces].map(([key, workspace]) => [key, workspace.statusEnteredAt?.getTime() ?? 0]),
    );
    for (const serverId of serverIds) {
      const session = state.sessions[serverId];
      if (!session) continue;
      lastSessions[serverId] = { agents: session.agents, agentDetails: session.agentDetails };
      addAgentUpdates({
        timestamps,
        serverId,
        agents: session.agents,
        streamActivity: state.agentLastActivity,
      });
      addAgentUpdates({
        timestamps,
        serverId,
        agents: session.agentDetails,
        streamActivity: state.agentLastActivity,
      });
    }
    const sorted = [...timestamps].sort((a, b) => b[1] - a[1]);
    const ranks = new Map<string, number>();
    let rank = 0;
    let lastTime: number | null = null;
    for (const [key, timestamp] of sorted) {
      if (timestamp !== lastTime) rank += 1;
      ranks.set(key, rank);
      lastTime = timestamp;
    }
    // Stream timestamps are already coalesced. Only publish a new rank map when ordering changes.
    const sameRanks =
      ranks.size === previous.size &&
      [...ranks].every(([key, value]) => previous.get(key) === value);
    if (!sameRanks) previous = ranks;
    return previous;
  };
}

export function useSidebarRecency(input: {
  workspaces: ReadonlyMap<string, SidebarWorkspaceEntry>;
  enabled: boolean;
}): WorkspaceRecency {
  const selector = useMemo(
    () => createSidebarRecencySelector(input.workspaces),
    [input.workspaces],
  );
  return useSessionStore(input.enabled ? selector : emptyRecency);
}
