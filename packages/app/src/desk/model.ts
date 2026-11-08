import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import type { Artifact, BoardDecision } from "@getpaseo/protocol/messages";
import type { ArtifactHost } from "@/artifacts/store";
import type { BoardHostTasks } from "@/board/tasks";
import type {
  HostRuntimeAgentDirectoryStatus,
  HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { HostDirectory } from "@/stores/session-store-hooks";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";

export type DeskSourceState =
  | { status: "ready" | "loading" | "offline" | "unsupported" }
  | { status: "error"; message: string };

export interface DeskHostRuntime {
  serverId: string;
  connectionStatus: HostRuntimeConnectionStatus;
  directoryStatus: HostRuntimeAgentDirectoryStatus;
  directoryError: string | null;
  connectionError: string | null;
  lastOnlineAt: string | null;
}

export interface DeskHostInput {
  serverId: string;
  serverName: string;
  runtime: DeskHostRuntime;
  directory: HostDirectory;
  board: BoardHostTasks | undefined;
}

export interface DeskHostCoverage {
  serverId: string;
  serverName: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastOnlineAt: string | null;
  sessions: DeskSourceState;
  decisions: DeskSourceState;
  artifacts: DeskSourceState;
}

export interface DeskSession {
  key: string;
  serverId: string;
  serverName: string;
  agent: Agent;
  workspace: WorkspaceDescriptor;
  freshness: "current" | "last-known";
  currentStatus: Agent["status"] | null;
  isRunning: boolean;
  isChild: boolean;
}

interface DeskRequestBase {
  key: string;
  serverId: string;
  serverName: string;
  canRespond: boolean;
}

export interface DeskPermissionRequest extends DeskRequestBase {
  kind: "permission";
  session: DeskSession;
  request: AgentPermissionRequest;
}

export interface DeskDecisionRequest extends DeskRequestBase {
  kind: "decision";
  session: DeskSession | null;
  decision: BoardDecision;
}

export type DeskRequest = DeskPermissionRequest | DeskDecisionRequest;

export interface DeskArtifact {
  key: string;
  serverId: string;
  serverName: string;
  artifact: Artifact;
  workspace: WorkspaceDescriptor | null;
  sourceSession: DeskSession | null;
  canOpen: boolean;
}

export interface DeskAttentionCounts {
  needsYou: number;
  running: number;
  /** False means some hosts or request sources are not currently known. */
  isComplete: boolean;
}

export interface DeskModel {
  hosts: DeskHostCoverage[];
  requests: DeskRequest[];
  sessions: DeskSession[];
  activeSessions: DeskSession[];
  /** Finished attention is the available reply signal; no timeline text is fetched. */
  recentReplies: DeskSession[];
  artifacts: DeskArtifact[];
  counts: DeskAttentionCounts;
}

export interface DeskProjectionInput {
  hosts: readonly DeskHostInput[];
  artifactsByHost: Readonly<Record<string, ArtifactHost>>;
}

interface HostProjection {
  sessions: DeskSession[];
  requests: DeskRequest[];
  sessionsState: DeskSourceState;
  decisionsState: DeskSourceState;
}

const READY: DeskSourceState = { status: "ready" };
const LOADING: DeskSourceState = { status: "loading" };
const OFFLINE: DeskSourceState = { status: "offline" };

function directoryState(host: DeskHostInput): DeskSourceState {
  const { runtime, directory } = host;
  if (runtime.connectionStatus === "error") {
    return { status: "error", message: runtime.connectionError ?? "" };
  }
  if (runtime.connectionStatus === "offline") return OFFLINE;
  if (runtime.connectionStatus !== "online") return LOADING;
  const failed =
    runtime.directoryStatus === "error_before_first_success" ||
    runtime.directoryStatus === "error_after_ready";
  if (failed) return { status: "error", message: runtime.directoryError ?? "" };
  const ready = runtime.directoryStatus === "ready" && directory.hydrated;
  return ready ? READY : LOADING;
}

function collectionState(input: {
  runtime: DeskHostRuntime;
  source: BoardHostTasks | ArtifactHost | undefined;
}): DeskSourceState {
  const { runtime, source } = input;
  if (source?.status === "unsupported") return source;
  if (runtime.connectionStatus === "offline") return OFFLINE;
  if (runtime.connectionStatus === "error") {
    return { status: "error", message: runtime.connectionError ?? "" };
  }
  if (runtime.connectionStatus !== "online") return LOADING;
  if (!source) return LOADING;
  if (source.status === "error") return { status: "error", message: source.message };
  if (source.status === "ready") return READY;
  return { status: source.status };
}

function openDecisions(host: DeskHostInput): BoardDecision[] {
  if (host.board?.status !== "ready") return [];
  return [...host.board.decisions.values()].filter((decision) => decision.resolvedAt === null);
}

function visibleWorkspace(host: DeskHostInput, agent: Agent): WorkspaceDescriptor | null {
  const hiddenAgent = agent.archivedAt || agent.background;
  if (hiddenAgent || !agent.workspaceId) return null;
  const workspace = host.directory.workspaces.get(agent.workspaceId);
  if (!workspace) return null;
  const hiddenWorkspace = workspace.background || workspace.archivingAt !== null;
  return hiddenWorkspace ? null : workspace;
}

function projectSessions(input: {
  host: DeskHostInput;
  decisions: readonly BoardDecision[];
  current: boolean;
}): DeskSession[] {
  const { host, decisions, current } = input;
  const askingAgents = new Set(decisions.map((decision) => decision.agentId));
  const sessions: DeskSession[] = [];
  for (const agent of host.directory.agents.values()) {
    const workspace = visibleWorkspace(host, agent);
    if (!workspace) continue;
    const parent = agent.parentAgentId ? host.directory.agents.get(agent.parentAgentId) : undefined;
    const root = isWorkspaceRootAgent(agent, parent);
    const executing =
      agent.status === "running" ||
      agent.status === "initializing" ||
      (agent.backgroundWork?.count ?? 0) > 0;
    const needsOwnEntry =
      executing ||
      agent.pendingPermissions.length > 0 ||
      agent.status === "error" ||
      askingAgents.has(agent.id);
    if (!root && !needsOwnEntry) continue;
    sessions.push({
      key: `${host.serverId}:agent:${agent.id}`,
      serverId: host.serverId,
      serverName: host.serverName,
      agent,
      workspace,
      freshness: current ? "current" : "last-known",
      currentStatus: current ? agent.status : null,
      isRunning: current && executing,
      isChild: !root,
    });
  }
  return sessions;
}

function projectRequests(input: {
  host: DeskHostInput;
  sessions: readonly DeskSession[];
  decisions: readonly BoardDecision[];
  decisionsCurrent: boolean;
}): DeskRequest[] {
  const { host, sessions, decisions, decisionsCurrent } = input;
  const requests: DeskRequest[] = [];
  const sessionsById = new Map(sessions.map((session) => [session.agent.id, session]));
  for (const session of sessions) {
    for (const request of session.agent.pendingPermissions) {
      requests.push({
        kind: "permission",
        key: `${host.serverId}:permission:${session.agent.id}:${request.id}`,
        serverId: host.serverId,
        serverName: host.serverName,
        session,
        request,
        canRespond: session.freshness === "current",
      });
    }
  }
  for (const decision of decisions) {
    const agent = decision.agentId ? host.directory.agents.get(decision.agentId) : undefined;
    if (agent && !visibleWorkspace(host, agent)) continue;
    const session = decision.agentId ? (sessionsById.get(decision.agentId) ?? null) : null;
    requests.push({
      kind: "decision",
      key: `${host.serverId}:decision:${decision.id}`,
      serverId: host.serverId,
      serverName: host.serverName,
      session,
      decision,
      canRespond: decisionsCurrent,
    });
  }
  return requests;
}

function projectHost(host: DeskHostInput): HostProjection {
  const sessionsState = directoryState(host);
  const decisionsState = collectionState({ runtime: host.runtime, source: host.board });
  const decisions = openDecisions(host);
  const sessions = projectSessions({ host, decisions, current: sessionsState.status === "ready" });
  const requests = projectRequests({
    host,
    sessions,
    decisions,
    decisionsCurrent: decisionsState.status === "ready",
  });
  return { sessions, requests, sessionsState, decisionsState };
}

function addCounts(counts: DeskAttentionCounts, host: HostProjection): void {
  counts.needsYou += host.requests.filter((request) => request.canRespond).length;
  counts.running += host.sessions.filter((session) => session.isRunning).length;
  const decisionsKnown =
    host.decisionsState.status === "ready" || host.decisionsState.status === "unsupported";
  counts.isComplete &&= host.sessionsState.status === "ready" && decisionsKnown;
}

/** Reads existing replicas only. It creates neither directory demand nor subscriptions. */
export function countDeskAttention(hosts: readonly DeskHostInput[]): DeskAttentionCounts {
  const counts: DeskAttentionCounts = { needsYou: 0, running: 0, isComplete: true };
  for (const host of hosts) addCounts(counts, projectHost(host));
  return counts;
}

function projectArtifacts(input: {
  host: DeskHostInput;
  source: ArtifactHost | undefined;
  sessions: readonly DeskSession[];
  state: DeskSourceState;
}): DeskArtifact[] {
  const { host, source, sessions, state } = input;
  if (source?.status !== "ready") return [];
  const rows: DeskArtifact[] = [];
  const sessionsById = new Map(sessions.map((session) => [session.agent.id, session]));
  for (const artifact of source.artifacts.values()) {
    const workspace = host.directory.workspaces.get(artifact.workspaceId) ?? null;
    if (workspace?.background) continue;
    const sourceSession = artifact.sourceAgentId
      ? (sessionsById.get(artifact.sourceAgentId) ?? null)
      : null;
    rows.push({
      key: `${host.serverId}:artifact:${artifact.id}`,
      serverId: host.serverId,
      serverName: host.serverName,
      artifact,
      workspace,
      sourceSession,
      canOpen: state.status === "ready",
    });
  }
  return rows;
}

function isRecentReply(session: DeskSession): boolean {
  const stopped = session.agent.status === "idle" || session.agent.status === "closed";
  return (
    session.freshness === "current" &&
    stopped &&
    session.agent.attentionReason === "finished" &&
    !session.isChild
  );
}

function isActiveSession(session: DeskSession): boolean {
  return (
    session.freshness === "last-known" ||
    session.isRunning ||
    session.agent.status === "error" ||
    session.agent.pendingPermissions.length > 0
  );
}

export function projectDesk(input: DeskProjectionInput): DeskModel {
  const hosts: DeskHostCoverage[] = [];
  const sessions: DeskSession[] = [];
  const requests: DeskRequest[] = [];
  const artifacts: DeskArtifact[] = [];
  const counts: DeskAttentionCounts = { needsYou: 0, running: 0, isComplete: true };
  for (const host of input.hosts) {
    const projected = projectHost(host);
    const source = input.artifactsByHost[host.serverId];
    const artifactsState = collectionState({ runtime: host.runtime, source });
    hosts.push({
      serverId: host.serverId,
      serverName: host.serverName,
      connectionStatus: host.runtime.connectionStatus,
      lastOnlineAt: host.runtime.lastOnlineAt,
      sessions: projected.sessionsState,
      decisions: projected.decisionsState,
      artifacts: artifactsState,
    });
    sessions.push(...projected.sessions);
    requests.push(...projected.requests);
    artifacts.push(
      ...projectArtifacts({ host, source, sessions: projected.sessions, state: artifactsState }),
    );
    addCounts(counts, projected);
  }
  sessions.sort((a, b) => b.agent.lastActivityAt.getTime() - a.agent.lastActivityAt.getTime());
  artifacts.sort((a, b) => b.artifact.updatedAt.localeCompare(a.artifact.updatedAt));
  return {
    hosts,
    requests,
    sessions,
    activeSessions: sessions.filter(isActiveSession),
    recentReplies: sessions.filter(isRecentReply),
    artifacts,
    counts,
  };
}
