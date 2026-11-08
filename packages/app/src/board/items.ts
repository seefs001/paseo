import { deriveAgentStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import type { WorkspaceStateBucket } from "@getpaseo/protocol/messages";
import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import {
  BOARD_COLUMNS,
  COLUMN_BY_STATE_BUCKET,
  buildBoardColumns,
  isPlanningColumn,
  type BoardCard,
  type BoardColumnId,
  type BoardHostInput,
} from "./columns";

/**
 * The Board shows two kinds of items. Every live root agent on a host is an agent item, whether
 * or not anyone planned it, so the Board is the one place to see all ongoing work. Board tasks
 * are task items while they are planned, done, or started without a visible agent; once their
 * workspace has a root agent, the task rides on that agent's card instead of showing twice.
 */
export type BoardItem = BoardTaskItem | BoardAgentItem;

interface BoardItemBase {
  key: string;
  serverId: string;
  serverName: string;
  column: BoardColumnId;
  /** Ordering time; see `compareItems` for each column's direction. */
  sortTime: number;
}

export interface BoardTaskItem extends BoardItemBase {
  kind: "task";
  card: BoardCard;
}

export interface BoardAgentChild {
  key: string;
  agent: Agent;
  bucket: WorkspaceStateBucket;
}

export interface BoardAgentItem extends BoardItemBase {
  kind: "agent";
  agent: Agent;
  /** The agent's own state; the column can differ when a task or running subagents hold it. */
  bucket: WorkspaceStateBucket;
  workspace: WorkspaceDescriptor;
  project: ProjectDescriptor | null;
  /** The unfinished Board task linked to this agent's workspace. */
  task: BoardCard | null;
  /** Set when this item is a subagent shown in a lane of its own. */
  parent: Agent | null;
  /** Direct subagents, always listed on the parent card. */
  children: BoardAgentChild[];
}

export type BoardItemColumns = Record<BoardColumnId, BoardItem[]>;

/** A task card as the task item the Board would build for it. */
export function toBoardTaskItem(card: BoardCard): BoardTaskItem {
  return {
    kind: "task",
    key: card.key,
    serverId: card.serverId,
    serverName: card.serverName,
    column: card.column,
    sortTime: card.sortTime,
    card,
  };
}

export const BOARD_DONE_WINDOWS = ["24h", "7d", "all"] as const;
export type BoardDoneWindow = (typeof BOARD_DONE_WINDOWS)[number];

const DONE_WINDOW_MS: Record<BoardDoneWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

export interface BoardItemOptions {
  /** Subagents also get lane cards. Waiting or failed subagents always do. */
  showSubagents: boolean;
  doneWindow: BoardDoneWindow;
  now: number;
}

function agentBucket(agent: Agent): WorkspaceStateBucket {
  if (agent.status === "initializing") return "running";
  return deriveAgentStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}

function agentSortTime(agent: Agent, column: BoardColumnId): number {
  if (column === "running" && agent.turn.phase === "open" && agent.turn.startedAt) {
    return agent.turn.startedAt.getTime();
  }
  if (column === "done") return agent.updatedAt.getTime();
  return (agent.attentionTimestamp ?? agent.updatedAt).getTime();
}

/** Planning columns by rank; waiting and running oldest first; the rest newest first. */
function compareItems(a: BoardItem, b: BoardItem): number {
  const column = a.column;
  if (isPlanningColumn(column) && a.kind === "task" && b.kind === "task") {
    if (a.card.task.rank !== b.card.task.rank) return a.card.task.rank - b.card.task.rank;
    return b.sortTime - a.sortTime;
  }
  if (column === "running" || column === "needs_you") return a.sortTime - b.sortTime;
  return b.sortTime - a.sortTime;
}

function isActiveBucket(bucket: WorkspaceStateBucket): boolean {
  return bucket === "running" || bucket === "needs_input";
}

interface HostAgents {
  /** Live agents whose workspace is active and in default discovery. */
  visible: Map<
    string,
    { agent: Agent; workspace: WorkspaceDescriptor; bucket: WorkspaceStateBucket }
  >;
  childrenByParent: Map<string, Agent[]>;
}

function collectHostAgents(host: BoardHostInput): HostAgents {
  const visible: HostAgents["visible"] = new Map();
  for (const agent of host.directory.agents.values()) {
    if (agent.archivedAt) continue;
    const workspace = agent.workspaceId ? host.directory.workspaces.get(agent.workspaceId) : null;
    if (!workspace || workspace.background || workspace.archivingAt !== null) continue;
    visible.set(agent.id, { agent, workspace, bucket: agentBucket(agent) });
  }
  const childrenByParent = new Map<string, Agent[]>();
  for (const { agent } of visible.values()) {
    if (!agent.parentAgentId || !visible.has(agent.parentAgentId)) continue;
    const siblings = childrenByParent.get(agent.parentAgentId) ?? [];
    siblings.push(agent);
    childrenByParent.set(agent.parentAgentId, siblings);
  }
  return { visible, childrenByParent };
}

/** Whether any subagent below `agentId` is running or waiting on the user. */
function hasActiveDescendant(
  hostAgents: HostAgents,
  agentId: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(agentId)) return false;
  seen.add(agentId);
  for (const child of hostAgents.childrenByParent.get(agentId) ?? []) {
    const entry = hostAgents.visible.get(child.id);
    if (entry && isActiveBucket(entry.bucket)) return true;
    if (hasActiveDescendant(hostAgents, child.id, seen)) return true;
  }
  return false;
}

function resolveAgentColumn(input: {
  bucket: WorkspaceStateBucket;
  hasTask: boolean;
  holdsRunning: boolean;
}): BoardColumnId {
  const { bucket, hasTask, holdsRunning } = input;
  // A parent whose own turn ended keeps running while its subagents work.
  if (holdsRunning && (bucket === "done" || bucket === "attention")) return "running";
  // Plain sessions the user has already seen are finished; a task waits in Review for acceptance.
  if (bucket === "done" && !hasTask) return "done";
  return COLUMN_BY_STATE_BUCKET[bucket];
}

function emptyColumns(): BoardItemColumns {
  return { fog: [], ready: [], running: [], needs_you: [], review: [], done: [] };
}

/** Unfinished started tasks by workspace, so a workspace's root agents can carry their task. */
function indexStartedTasks(
  taskColumns: Record<BoardColumnId, BoardCard[]>,
): Map<string, BoardCard> {
  const byWorkspace = new Map<string, BoardCard>();
  for (const column of BOARD_COLUMNS) {
    for (const card of taskColumns[column]) {
      if (card.task.completedAt === null && card.task.workspaceId !== null) {
        byWorkspace.set(card.task.workspaceId, card);
      }
    }
  }
  return byWorkspace;
}

/** Adds the host's agent items and returns the workspaces that have a root agent card. */
function addAgentItems(input: {
  host: BoardHostInput;
  hostAgents: HostAgents;
  taskByWorkspace: ReadonlyMap<string, BoardCard>;
  options: BoardItemOptions;
  columns: BoardItemColumns;
}): Set<string> {
  const { host, hostAgents, taskByWorkspace, options, columns } = input;
  const workspacesWithAgents = new Set<string>();
  for (const { agent, workspace, bucket } of hostAgents.visible.values()) {
    const parentEntry = agent.parentAgentId ? hostAgents.visible.get(agent.parentAgentId) : null;
    const surfacesAsChild =
      options.showSubagents || bucket === "needs_input" || bucket === "failed";
    if (parentEntry && !surfacesAsChild) continue;
    const task = parentEntry ? null : (taskByWorkspace.get(workspace.id) ?? null);
    if (!parentEntry) workspacesWithAgents.add(workspace.id);
    const column = resolveAgentColumn({
      bucket,
      hasTask: task !== null,
      holdsRunning: hasActiveDescendant(hostAgents, agent.id),
    });
    const children = (hostAgents.childrenByParent.get(agent.id) ?? []).map((child) => ({
      key: `${host.serverId}:${child.id}`,
      agent: child,
      bucket: hostAgents.visible.get(child.id)?.bucket ?? agentBucket(child),
    }));
    columns[column].push({
      kind: "agent",
      key: `${host.serverId}:agent:${agent.id}`,
      serverId: host.serverId,
      serverName: host.serverName,
      column,
      sortTime: agentSortTime(agent, column),
      agent,
      bucket,
      workspace,
      project:
        workspace.projectId === null
          ? null
          : (host.directory.projects.get(workspace.projectId) ?? null),
      task,
      parent: parentEntry?.agent ?? null,
      children,
    });
  }
  return workspacesWithAgents;
}

function addTaskItems(input: {
  taskColumns: Record<BoardColumnId, BoardCard[]>;
  workspacesWithAgents: ReadonlySet<string>;
  columns: BoardItemColumns;
}): void {
  const { taskColumns, workspacesWithAgents, columns } = input;
  for (const column of BOARD_COLUMNS) {
    for (const card of taskColumns[column]) {
      const ridesOnAgent =
        card.task.completedAt === null &&
        card.task.workspaceId !== null &&
        workspacesWithAgents.has(card.task.workspaceId);
      if (ridesOnAgent) continue;
      columns[column].push({
        kind: "task",
        key: card.key,
        serverId: card.serverId,
        serverName: card.serverName,
        column,
        sortTime: card.sortTime,
        card,
      });
    }
  }
}

export function buildBoardItems(
  hosts: readonly BoardHostInput[],
  options: BoardItemOptions,
): BoardItemColumns {
  const columns = emptyColumns();
  for (const host of hosts) {
    const taskColumns = buildBoardColumns([host]);
    const workspacesWithAgents = addAgentItems({
      host,
      hostAgents: collectHostAgents(host),
      taskByWorkspace: indexStartedTasks(taskColumns),
      options,
      columns,
    });
    addTaskItems({ taskColumns, workspacesWithAgents, columns });
  }
  const doneCutoff = options.now - DONE_WINDOW_MS[options.doneWindow];
  columns.done = columns.done.filter((item) => item.sortTime >= doneCutoff);
  for (const column of BOARD_COLUMNS) columns[column].sort(compareItems);
  return columns;
}

/** Task cards of a planning column, in display order, for rank moves. */
export function planningCards(items: readonly BoardItem[]): BoardCard[] {
  return items.flatMap((item) => (item.kind === "task" ? [item.card] : []));
}

export interface BoardFilters {
  query: string;
  /** `serverId:projectId` keys. Empty means every project. */
  projects: readonly string[];
  /** `serverId:workspaceId` keys. */
  workspaces: readonly string[];
  /** Provider ids; task items without an agent only match when this is empty. */
  providers: readonly string[];
  /** Workspace label names, compared case-insensitively. */
  labels: readonly string[];
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  query: "",
  projects: [],
  workspaces: [],
  providers: [],
  labels: [],
};

export function hasBoardFilters(filters: BoardFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.projects.length > 0 ||
    filters.workspaces.length > 0 ||
    filters.providers.length > 0 ||
    filters.labels.length > 0
  );
}

interface ItemFacts {
  projectId: string | null;
  workspace: WorkspaceDescriptor | null;
  project: ProjectDescriptor | null;
  provider: string | null;
}

function itemFacts(item: BoardItem): ItemFacts {
  if (item.kind === "agent") {
    return {
      projectId: item.workspace.projectId,
      workspace: item.workspace,
      project: item.project,
      provider: item.agent.provider,
    };
  }
  const { card } = item;
  return {
    projectId: card.workspace?.projectId ?? card.task.projectId,
    workspace: card.workspace,
    project: card.project,
    provider: null,
  };
}

/** Every searchable string of an item, lowercased. */
export function boardItemSearchText(item: BoardItem): string {
  const { workspace, project } = itemFacts(item);
  const parts: (string | null | undefined)[] = [
    project?.projectCustomName,
    project?.projectDisplayName,
    workspace?.title,
    workspace?.name,
    workspace?.workspaceDirectory,
    workspace?.gitRuntime?.currentBranch,
    ...(workspace?.labels ?? []),
  ];
  const pullRequest = workspace?.githubRuntime?.pullRequest;
  if (pullRequest) {
    parts.push(pullRequest.title, pullRequest.url);
    if (pullRequest.number !== undefined) parts.push(`#${pullRequest.number}`);
  }
  const task = item.kind === "task" ? item.card.task : item.task?.task;
  if (task) parts.push(task.title, task.notes, task.id, `T-${task.number}`);
  if (item.kind === "agent") {
    parts.push(item.agent.title, item.agent.id, item.agent.provider, item.agent.model);
  }
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .toLowerCase();
}

function matchesFilters(item: BoardItem, filters: BoardFilters, query: string): boolean {
  const facts = itemFacts(item);
  if (filters.projects.length > 0) {
    const key = facts.projectId ? `${item.serverId}:${facts.projectId}` : null;
    if (!key || !filters.projects.includes(key)) return false;
  }
  if (filters.workspaces.length > 0) {
    const key = facts.workspace ? `${item.serverId}:${facts.workspace.id}` : null;
    if (!key || !filters.workspaces.includes(key)) return false;
  }
  if (filters.providers.length > 0) {
    if (!facts.provider || !filters.providers.includes(facts.provider)) return false;
  }
  if (filters.labels.length > 0) {
    const labels = new Set((facts.workspace?.labels ?? []).map((label) => label.toLowerCase()));
    if (!filters.labels.some((label) => labels.has(label.toLowerCase()))) return false;
  }
  return query.length === 0 || boardItemSearchText(item).includes(query);
}

export function filterBoardItems(
  columns: BoardItemColumns,
  filters: BoardFilters,
): BoardItemColumns {
  if (!hasBoardFilters(filters)) return columns;
  const query = filters.query.trim().toLowerCase();
  const filtered = { ...columns };
  for (const column of BOARD_COLUMNS) {
    filtered[column] = columns[column].filter((item) => matchesFilters(item, filters, query));
  }
  return filtered;
}
