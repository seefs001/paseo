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

export function isPathMentionQuery(query: string): boolean {
  return query.includes("/");
}

export type ComposerMentionKind = "all" | "chat" | "file";

export interface ResolvedComposerMention {
  kind: ComposerMentionKind;
  filter: string;
}

const MENTION_KIND_PREFIX = /^(chat|file)(?:\s+|\/|$)(.*)$/i;

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
  if (kind !== "chat" && kind !== "file") {
    return null;
  }
  return { kind, filter: match[2] ?? "" };
}

export function mentionOptionGroups(kind: ComposerMentionKind): {
  sessions: boolean;
  files: boolean;
} {
  return {
    sessions: kind === "chat" || kind === "all",
    files: kind === "file" || kind === "all",
  };
}

// `#` opens agent profiles only at a word boundary, and never for `#123` issue references.
const PROFILE_MENTION = /(?:^|[\s(（，。：；！？])#([^\s#/\\()[\]{}'"`<>]*)$/u;
// `%` opens agent roles under the same boundary rule, so `50%` and `%20` never open it.
const ROLE_MENTION = /(?:^|[\s(（，。：；！？])%([^\s%/\\()[\]{}'"`<>]*)$/u;

export function findActiveProfileMention(input: {
  text: string;
  cursorIndex: number;
}): SessionMentionRange | null {
  const cursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const match = PROFILE_MENTION.exec(input.text.slice(0, cursor));
  if (!match || /^\d/.test(match[1])) return null;
  return { start: cursor - match[1].length - 1, end: cursor, query: match[1] };
}

export function findActiveRoleMention(input: {
  text: string;
  cursorIndex: number;
}): SessionMentionRange | null {
  const cursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const match = ROLE_MENTION.exec(input.text.slice(0, cursor));
  if (!match || /^\d/.test(match[1])) return null;
  return { start: cursor - match[1].length - 1, end: cursor, query: match[1] };
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

export interface AgentRoleMention {
  id: string;
  name: string;
  description?: string | null;
  defaultProfileId?: string | null;
}

export function rankAgentRoleMentions<T extends AgentRoleMention>(input: {
  roles: readonly T[];
  query: string;
}): T[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return [...input.roles];
  return input.roles.filter((role) =>
    [role.name, role.id, role.description ?? ""].join(" ").toLowerCase().includes(query),
  );
}

// The role's instructions stay out of the card: the daemon reads them by id when the agent is
// created, and an agent that reads them here may take them as instructions for itself.
/**
 * `create_agent` resolves `role` only on the host that runs it, so a role from another host
 * must not be passed by id: the same id there can name a different role.
 */
export function buildAgentRoleAddressCard(
  input: AgentRoleMention,
  source?: { serverId: string; targetServerId?: string },
): string {
  const lines = ["Referenced agent role", `- roleId: ${input.id}`, `- name: ${input.name}`];
  if (source) lines.push(`- host: ${source.serverId}`);
  if (source?.targetServerId && source.targetServerId !== source.serverId) {
    lines.push(
      "",
      `This role belongs to host ${source.serverId}, not the host this message was sent to (${source.targetServerId}). Roles cannot be used across hosts: do not pass this roleId or a same-named role to create_agent. Tell the user the role is unavailable here.`,
    );
    return lines.join("\n");
  }
  if (input.description?.trim()) lines.push(`- description: ${input.description.trim()}`);
  if (input.defaultProfileId?.trim()) {
    lines.push(`- defaultProfileId: ${input.defaultProfileId.trim()}`);
  }
  lines.push(
    "",
    "Pass roleId as `role` to create_agent. The daemon writes the role's instructions into the new agent's system prompt. A role does not choose a model: still pass provider and model. Only providers with supportsSystemPrompt in list_providers accept a role. Call list_roles if the id is not found. Do not guess the id from the name.",
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
