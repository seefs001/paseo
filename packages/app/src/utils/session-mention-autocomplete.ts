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

export type ComposerMentionKind = "all" | "chat" | "agent" | "file";

export interface ResolvedComposerMention {
  kind: ComposerMentionKind;
  filter: string;
}

const MENTION_KIND_PREFIX = /^(chat|agent|file)(?:\s+|\/|$)(.*)$/i;

export function resolveComposerMention(input: {
  mentionQuery: string | null;
  canAttachSessionMention: boolean;
}): ResolvedComposerMention | null {
  if (input.mentionQuery === null) {
    return null;
  }
  if (!input.canAttachSessionMention) {
    return { kind: "file", filter: input.mentionQuery };
  }
  const prefixed = parseMentionKindPrefix(input.mentionQuery);
  if (prefixed) {
    return prefixed;
  }
  if (isPathMentionQuery(input.mentionQuery)) {
    return { kind: "file", filter: input.mentionQuery };
  }
  return { kind: "all", filter: input.mentionQuery };
}

function parseMentionKindPrefix(query: string): ResolvedComposerMention | null {
  const match = MENTION_KIND_PREFIX.exec(query);
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase();
  if (kind !== "chat" && kind !== "agent" && kind !== "file") {
    return null;
  }
  return { kind, filter: match[2] ?? "" };
}

export function mentionOptionGroups(kind: ComposerMentionKind): {
  sessions: boolean;
  profiles: boolean;
  files: boolean;
} {
  return {
    sessions: kind === "chat" || kind === "all",
    profiles: kind === "agent" || kind === "all",
    files: kind === "file" || kind === "all",
  };
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

export interface AgentProfileMention {
  id: string;
  name: string;
  provider: string;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
  notes?: string | null;
}

export function rankAgentProfileMentions(input: {
  profiles: readonly AgentProfileMention[];
  query: string;
}): AgentProfileMention[] {
  const query = input.query.trim().toLowerCase();
  if (!query) {
    return [...input.profiles];
  }
  return input.profiles.filter((profile) => agentProfileSearchHaystack(profile).includes(query));
}

export function buildAgentProfileAddressCard(input: AgentProfileMention): string {
  const model = input.model?.trim() || "unknown";
  const lines = [
    "Referenced agent profile",
    `- profileId: ${input.id}`,
    `- name: ${input.name}`,
    `- provider: ${input.provider}`,
    `- model: ${model}`,
  ];
  if (input.modeId?.trim()) {
    lines.push(`- modeId: ${input.modeId.trim()}`);
  }
  if (input.thinkingOptionId?.trim()) {
    lines.push(`- thinkingOptionId: ${input.thinkingOptionId.trim()}`);
  }
  if (input.featureValues && Object.keys(input.featureValues).length > 0) {
    lines.push(`- featureValues: ${JSON.stringify(input.featureValues)}`);
  }
  if (input.notes?.trim()) {
    lines.push(`- notes: ${input.notes.trim()}`);
  }
  lines.push(
    "",
    "Copy provider, model, modeId, thinkingOptionId, and featureValues into create_agent. There is no profile parameter. Do not guess these values from the name.",
  );
  return lines.join("\n");
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

function agentProfileSearchHaystack(profile: AgentProfileMention): string {
  return [profile.name, profile.id, profile.provider, profile.model]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}
