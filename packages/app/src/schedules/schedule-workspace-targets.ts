import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

export interface ScheduleConversationTarget {
  agentId: string;
  title: string | null;
}

export interface ScheduleWorkspaceTarget {
  serverId: string;
  workspaceId: string;
  label: string;
  cwd: string;
  conversations: ScheduleConversationTarget[];
}

export function buildScheduleWorkspaceTargets(input: {
  serverId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
  agents: Iterable<Agent>;
}): ScheduleWorkspaceTarget[] {
  const agents = Array.from(input.agents);
  agents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const conversationsByWorkspace = new Map<string, ScheduleConversationTarget[]>();
  for (const agent of agents) {
    if (!agent.workspaceId || agent.archivedAt || agent.background) continue;
    const conversations = conversationsByWorkspace.get(agent.workspaceId) ?? [];
    conversations.push({ agentId: agent.id, title: agent.title });
    conversationsByWorkspace.set(agent.workspaceId, conversations);
  }
  const workspaces = Array.from(input.workspaces);
  workspaces.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const targets: ScheduleWorkspaceTarget[] = [];
  for (const workspace of workspaces) {
    if (workspace.archivingAt || workspace.background) continue;
    targets.push({
      serverId: input.serverId,
      workspaceId: workspace.id,
      label: workspace.title || workspace.name,
      cwd: workspace.workspaceDirectory,
      conversations: conversationsByWorkspace.get(workspace.id) ?? [],
    });
  }
  return targets;
}
