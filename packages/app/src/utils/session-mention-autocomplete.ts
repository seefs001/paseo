export interface SessionMentionRange {
  start: number;
  end: number;
  query: string;
}

export interface SessionMentionCandidate {
  id: string;
  serverId: string;
  title: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
  parentAgentId: string | null;
  activityAt: number;
  isOpenTab: boolean;
}

export interface RankSessionMentionCandidatesInput {
  agents: readonly SessionMentionCandidate[];
  currentAgentId: string;
  currentWorkspaceId: string | null;
  query: string;
}

interface ApplySessionMentionReplacementInput {
  text: string;
  mention: SessionMentionRange;
}

export function isPathMentionQuery(query: string): boolean {
  return query.includes("/");
}

export function resolveComposerMentionMode(input: {
  mentionQuery: string | null;
  canAttachSessionMention: boolean;
}): "file" | "session" | null {
  if (input.mentionQuery === null) {
    return null;
  }
  if (!input.canAttachSessionMention || isPathMentionQuery(input.mentionQuery)) {
    return "file";
  }
  return "session";
}

export function applySessionMentionReplacement(input: ApplySessionMentionReplacementInput): string {
  return `${input.text.slice(0, input.mention.start)}${input.text.slice(input.mention.end)}`;
}

export function rankSessionMentionCandidates(
  input: RankSessionMentionCandidatesInput,
): SessionMentionCandidate[] {
  const query = input.query.trim().toLowerCase();
  const currentAgentId = input.currentAgentId.trim();
  const currentWorkspaceId = input.currentWorkspaceId?.trim() || null;
  const matches = input.agents.filter((agent) => {
    if (currentAgentId && agent.id === currentAgentId) {
      return false;
    }
    if (!query) {
      return true;
    }
    return sessionMentionSearchHaystack(agent).includes(query);
  });
  matches.sort((left, right) => {
    const bucketDelta =
      sessionMentionBucket(left, currentAgentId, currentWorkspaceId) -
      sessionMentionBucket(right, currentAgentId, currentWorkspaceId);
    if (bucketDelta !== 0) {
      return bucketDelta;
    }
    if (right.activityAt !== left.activityAt) {
      return right.activityAt - left.activityAt;
    }
    return left.id.localeCompare(right.id);
  });
  return matches;
}

export function buildAgentSessionAddressCard(input: {
  agentId: string;
  serverId: string;
  title: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
}): string {
  const shortId = input.agentId.slice(0, 7);
  const title = input.title?.trim() || shortId;
  const model = input.model?.trim() || "unknown";
  const workspaceId = input.workspaceId?.trim() || "unknown";
  return [
    "Referenced agent session",
    `- agentId: ${input.agentId}`,
    `- shortId: ${shortId}`,
    `- title: ${title}`,
    `- provider: ${input.provider}`,
    `- model: ${model}`,
    `- cwd: ${input.cwd}`,
    `- workspaceId: ${workspaceId}`,
    `- host: ${input.serverId}`,
    "",
    "Use agentId with send_agent_prompt to message this session, or get_agent_activity to read its conversation. Do not guess the id from the title.",
  ].join("\n");
}

function sessionMentionBucket(
  agent: SessionMentionCandidate,
  currentAgentId: string,
  currentWorkspaceId: string | null,
): number {
  if (currentAgentId && agent.parentAgentId === currentAgentId) {
    return 0;
  }
  if (currentWorkspaceId && agent.workspaceId === currentWorkspaceId) {
    return 1;
  }
  if (agent.isOpenTab) {
    return 2;
  }
  return 3;
}

function sessionMentionSearchHaystack(agent: SessionMentionCandidate): string {
  return [agent.title, agent.id, agent.provider, agent.model]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}
