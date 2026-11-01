import type { BoardTask } from "@getpaseo/protocol/messages";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import type { HostDirectory } from "@/stores/session-store-hooks";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export const BOARD_COLUMNS = ["fog", "ready", "running", "needs_you", "review", "done"] as const;
export type BoardColumnId = (typeof BOARD_COLUMNS)[number];

/**
 * Started tasks follow their workspace's status bucket, so the Board never asks the user to drag
 * a card the agent already moved. A started task stays in Review until someone accepts it, seen
 * or not; failures land there too, with their error.
 */
export const COLUMN_BY_STATE_BUCKET: Record<WorkspaceDescriptor["status"], BoardColumnId> = {
  running: "running",
  needs_input: "needs_you",
  failed: "review",
  attention: "review",
  done: "review",
};

export interface BoardCard {
  key: string;
  serverId: string;
  serverName: string;
  task: BoardTask;
  column: BoardColumnId;
  project: ProjectDescriptor | null;
  /** The linked workspace while it is in this host's active directory. */
  workspace: WorkspaceDescriptor | null;
  /** Blocking tasks on this host that are not done yet; the task cannot start while any remain. */
  openBlockers: BoardTask[];
  /** Tasks split from this one, and how many of them are done. */
  children: { total: number; done: number };
  /** Ready, unclaimed, ready for agent, no open blockers: what Autopilot and agents take next. */
  onFrontier: boolean;
  sortTime: number;
}

export interface BoardHostInput {
  serverId: string;
  serverName: string;
  tasks: ReadonlyMap<string, BoardTask>;
  directory: HostDirectory;
}

export type BoardColumns = Record<BoardColumnId, BoardCard[]>;

export function resolveBoardColumn(
  task: BoardTask,
  workspace: WorkspaceDescriptor | null,
): BoardColumnId {
  if (task.completedAt !== null) return "done";
  if (task.workspaceId === null) {
    // An agent that claimed the task is working it in its own session.
    if (task.claimedBy !== null) return "running";
    return task.stage;
  }
  // A linked workspace missing from the directory still needs the user's eyes, not a new start.
  if (workspace === null) return "review";
  return COLUMN_BY_STATE_BUCKET[workspace.status];
}

function resolveSortTime(input: {
  task: BoardTask;
  column: BoardColumnId;
  workspace: WorkspaceDescriptor | null;
}): number {
  const { task, column, workspace } = input;
  if (column === "done" && task.completedAt !== null) return Date.parse(task.completedAt);
  if (isPlanningColumn(column)) return Date.parse(task.createdAt);
  return workspace?.statusEnteredAt?.getTime() ?? Date.parse(task.updatedAt);
}

function findWorkspace(
  directory: HostDirectory,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  const key = normalizeWorkspaceOpaqueId(workspaceId);
  return key ? (directory.workspaces.get(key) ?? null) : null;
}

const NO_CHILDREN = { total: 0, done: 0 };

function countChildren(
  tasks: ReadonlyMap<string, BoardTask>,
): Map<string, { total: number; done: number }> {
  const counts = new Map<string, { total: number; done: number }>();
  for (const task of tasks.values()) {
    if (task.parentId === null) continue;
    const count = counts.get(task.parentId) ?? { total: 0, done: 0 };
    count.total += 1;
    if (task.completedAt !== null) count.done += 1;
    counts.set(task.parentId, count);
  }
  return counts;
}

function findOpenBlockers(tasks: ReadonlyMap<string, BoardTask>, task: BoardTask): BoardTask[] {
  return task.blockedBy.flatMap((id) => {
    const blocker = tasks.get(id);
    return blocker && blocker.completedAt === null ? [blocker] : [];
  });
}

export function isPlanningColumn(column: BoardColumnId): column is "fog" | "ready" {
  return column === "fog" || column === "ready";
}

/** Backlog and Todo read in rank order, newest first on a tie; other columns newest first. */
function compareCards(a: BoardCard, b: BoardCard): number {
  if (isPlanningColumn(a.column) && a.task.rank !== b.task.rank) return a.task.rank - b.task.rank;
  return b.sortTime - a.sortTime;
}

/** One task as a card on its host. `children` defaults to a count over the host's tasks. */
export function buildBoardCard(
  host: BoardHostInput,
  task: BoardTask,
  children: { total: number; done: number } = countChildren(host.tasks).get(task.id) ?? NO_CHILDREN,
): BoardCard {
  const workspace = findWorkspace(host.directory, task.workspaceId);
  const column = resolveBoardColumn(task, workspace);
  const openBlockers = findOpenBlockers(host.tasks, task);
  const projectId = workspace?.projectId ?? task.projectId;
  return {
    key: `${host.serverId}:${task.id}`,
    serverId: host.serverId,
    serverName: host.serverName,
    task,
    column,
    project: projectId ? (host.directory.projects.get(projectId) ?? null) : null,
    workspace,
    openBlockers,
    children,
    onFrontier:
      column === "ready" &&
      task.claimedBy === null &&
      task.readyFor === "agent" &&
      openBlockers.length === 0,
    sortTime: resolveSortTime({ task, column, workspace }),
  };
}

export function buildBoardColumns(hosts: readonly BoardHostInput[]): BoardColumns {
  const columns: BoardColumns = {
    fog: [],
    ready: [],
    running: [],
    needs_you: [],
    review: [],
    done: [],
  };
  for (const host of hosts) {
    const children = countChildren(host.tasks);
    for (const task of host.tasks.values()) {
      const card = buildBoardCard(host, task, children.get(task.id) ?? NO_CHILDREN);
      columns[card.column].push(card);
    }
  }
  for (const column of BOARD_COLUMNS) {
    columns[column].sort(compareCards);
  }
  return columns;
}

/** A rank that sorts between two neighbours; either side may be missing. */
function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined) return (after ?? 0) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export interface BacklogMove {
  up: number | null;
  down: number | null;
}

/**
 * The rank each Backlog card takes to move one step up or down. Ranks only order tasks on one
 * host, so a card moves past its neighbours from the same host when the Board mixes hosts.
 */
export function buildBacklogMoves(cards: readonly BoardCard[]): ReadonlyMap<string, BacklogMove> {
  const moves = new Map<string, BacklogMove>();
  const byHost = new Map<string, BoardCard[]>();
  for (const card of cards) {
    const hostCards = byHost.get(card.serverId) ?? [];
    hostCards.push(card);
    byHost.set(card.serverId, hostCards);
  }
  for (const hostCards of byHost.values()) {
    const ranks = hostCards.map((card) => card.task.rank);
    hostCards.forEach((card, index) => {
      moves.set(card.key, {
        up: index > 0 ? rankBetween(ranks[index - 2], ranks[index - 1]) : null,
        down: index < hostCards.length - 1 ? rankBetween(ranks[index + 1], ranks[index + 2]) : null,
      });
    });
  }
  return moves;
}
