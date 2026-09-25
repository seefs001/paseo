import type { Agent } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";

export type SessionListAgent = Pick<Agent, "title" | "provider" | "lastActivityAt" | "archivedAt">;

export interface OpenSession {
  tabId: string;
  agentId: string;
  title: string;
  provider: string;
  activityAt: number;
}

export function collectOpenSessions(input: {
  tabs: readonly WorkspaceTab[];
  agents: ReadonlyMap<string, SessionListAgent>;
  details: ReadonlyMap<string, SessionListAgent>;
  activity: ReadonlyMap<string, Date>;
  untitled: string;
}): OpenSession[] {
  const entries: OpenSession[] = [];
  for (const tab of input.tabs) {
    if (tab.target.kind !== "agent") continue;
    const agentId = tab.target.agentId;
    const agent = input.agents.get(agentId) ?? input.details.get(agentId);
    if (!agent || agent.archivedAt) continue;
    const activityAt = Math.max(
      input.activity.get(agentId)?.getTime() ?? 0,
      agent.lastActivityAt.getTime(),
    );
    entries.push({
      tabId: tab.tabId,
      agentId,
      title: agent.title || input.untitled,
      provider: agent.provider,
      activityAt,
    });
  }
  return entries.sort(
    (a, b) =>
      b.activityAt - a.activityAt ||
      a.title.localeCompare(b.title) ||
      a.tabId.localeCompare(b.tabId),
  );
}
