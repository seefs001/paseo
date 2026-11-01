import type {
  BoardDecision,
  BoardDeskSettings,
  BoardGoal,
  BOARD_CHECKPOINT_KINDS,
} from "@getpaseo/protocol/messages";
import type { ProjectDescriptor } from "@/stores/session-store";
import type { BoardCard, BoardHostInput } from "./columns";
import {
  buildBoardItems,
  filterBoardItems,
  type BoardAgentItem,
  type BoardFilters,
  type BoardItem,
} from "./items";

/**
 * The Desk asks "whose move is it?" instead of "which status is this in?".
 * - Decide: checkpoints waiting on the user, each a brief with its own actions.
 * - Flight: work agents are moving, grouped.
 * - Ahead: per group, Ready work agents may take and Fog ideas not yet specified.
 * - Landed: what finished, within the host's retention.
 * Snoozed checkpoints leave Decide until they wake.
 */
export type DeskCheckpointKind = (typeof BOARD_CHECKPOINT_KINDS)[number];

export interface DeskCheckpoint {
  /** Snooze key; a new checkpoint on the same agent or task gets a new key. */
  key: string;
  kind: DeskCheckpointKind;
  serverId: string;
  serverName: string;
  /** When the checkpoint started waiting, epoch ms. */
  since: number;
  /** The agent or task item behind it; null for a decision. */
  item: BoardItem | null;
  decision: BoardDecision | null;
  goal: BoardGoal | null;
  /** Wake time while snoozed, epoch ms. */
  snoozedUntil: number | null;
}

export type DeskGroupSubject =
  | { type: "goal"; goal: BoardGoal }
  | { type: "project"; project: ProjectDescriptor }
  | { type: "host"; serverName: string }
  | { type: "agent"; provider: string }
  /** Work with no goal (or project, or provider) under the current grouping. */
  | { type: "loose" };

export interface DeskGroup<T> {
  key: string;
  serverId: string | null;
  subject: DeskGroupSubject;
  entries: T;
}

type DeskGroupHead = Omit<DeskGroup<unknown>, "entries">;

export interface DeskAheadEntries {
  ready: BoardCard[];
  fog: BoardCard[];
}

export interface DeskModel {
  /** Oldest waiting first. */
  decide: DeskCheckpoint[];
  /** Soonest to wake first. */
  snoozed: DeskCheckpoint[];
  /** Running work, plus checkpoints whose kind the host keeps out of Decide. */
  flight: DeskGroup<BoardItem[]>[];
  /** Every unlanded goal appears, even when empty, so work can be dropped into it. */
  ahead: DeskGroup<DeskAheadEntries>[];
  /** Newest first. */
  landed: DeskGroup<BoardItem[]>[];
}

export interface DeskHostInput extends BoardHostInput {
  goals: ReadonlyMap<string, BoardGoal>;
  decisions: ReadonlyMap<string, BoardDecision>;
  snoozes: ReadonlyMap<string, number>;
}

/** Narrows the Desk to one goal, or to work without a goal (`goalId: null`). */
export interface DeskGoalFocus {
  serverId: string;
  goalId: string | null;
}

export interface DeskOptions {
  settings: BoardDeskSettings;
  filters: BoardFilters;
  focus: DeskGoalFocus | null;
  showSubagents: boolean;
  now: number;
}

function agentCheckpointKind(item: BoardAgentItem): DeskCheckpointKind {
  if (item.bucket === "needs_input") {
    return item.agent.pendingPermissions[0]?.kind === "question" ? "question" : "permission";
  }
  return item.bucket === "failed" ? "failed" : "review";
}

function agentCheckpointKey(item: BoardAgentItem, kind: DeskCheckpointKind): string {
  const { agent } = item;
  const permission = agent.pendingPermissions[0];
  const marker = permission
    ? `perm:${permission.id}`
    : String((agent.attentionTimestamp ?? agent.updatedAt).getTime());
  return `agent:${agent.id}:${kind}:${marker}`;
}

/** The checkpoint an item in Needs you or Review represents. */
function checkpointFor(item: BoardItem): Omit<DeskCheckpoint, "goal" | "snoozedUntil"> {
  if (item.kind === "agent") {
    const kind = agentCheckpointKind(item);
    return {
      key: agentCheckpointKey(item, kind),
      kind,
      serverId: item.serverId,
      serverName: item.serverName,
      since: item.sortTime,
      item,
      decision: null,
    };
  }
  const { task } = item.card;
  return {
    key: `task:${task.id}:review:${task.updatedAt}`,
    kind: "review",
    serverId: item.serverId,
    serverName: item.serverName,
    since: item.sortTime,
    item,
    decision: null,
  };
}

function itemGoalId(item: BoardItem, goals: ReadonlyMap<string, BoardGoal>): string | null {
  if (item.kind === "task") return item.card.task.goalId;
  if (item.task?.task.goalId) return item.task.task.goalId;
  // A goal's owner agent works under that goal.
  for (const goal of goals.values()) if (goal.ownerAgentId === item.agent.id) return goal.id;
  return null;
}

function itemProjectId(item: BoardItem): string | null {
  if (item.kind === "agent") return item.workspace.projectId;
  return item.card.workspace?.projectId ?? item.card.task.projectId;
}

interface Grouper {
  host: DeskHostInput;
  grouping: BoardDeskSettings["grouping"];
}

function groupOf(input: Grouper & { item: BoardItem }): DeskGroupHead {
  const { host, grouping, item } = input;
  const loose = { key: `${host.serverId}:loose`, serverId: host.serverId, subject: LOOSE };
  switch (grouping) {
    case "goal": {
      const goal = host.goals.get(itemGoalId(item, host.goals) ?? "");
      if (!goal) return loose;
      return {
        key: `${host.serverId}:goal:${goal.id}`,
        serverId: host.serverId,
        subject: { type: "goal", goal },
      };
    }
    case "project": {
      const project = host.directory.projects.get(itemProjectId(item) ?? "");
      if (!project) return loose;
      return {
        key: `${host.serverId}:project:${project.projectId}`,
        serverId: host.serverId,
        subject: { type: "project", project },
      };
    }
    case "host":
      return {
        key: `host:${host.serverId}`,
        serverId: host.serverId,
        subject: { type: "host", serverName: host.serverName },
      };
    case "agent": {
      if (item.kind !== "agent") return loose;
      return {
        key: `agent:${item.agent.provider}`,
        serverId: null,
        subject: { type: "agent", provider: item.agent.provider },
      };
    }
  }
}

const LOOSE: DeskGroupSubject = { type: "loose" };

class GroupCollector<T> {
  private readonly groups = new Map<string, DeskGroup<T>>();

  constructor(private readonly empty: () => T) {}

  entry(group: DeskGroupHead): T {
    const existing = this.groups.get(group.key);
    if (existing) return existing.entries;
    const created: DeskGroup<T> = { ...group, entries: this.empty() };
    this.groups.set(group.key, created);
    return created.entries;
  }

  ensure(group: DeskGroupHead): void {
    this.entry(group);
  }

  list(): DeskGroup<T>[] {
    return [...this.groups.values()].sort(compareGroups);
  }
}

/** Goals by rank, then named groups alphabetically; loose work last. */
function compareGroups(a: DeskGroup<unknown>, b: DeskGroup<unknown>): number {
  const order = (group: DeskGroup<unknown>) => (group.subject.type === "loose" ? 1 : 0);
  if (order(a) !== order(b)) return order(a) - order(b);
  if (a.subject.type === "goal" && b.subject.type === "goal") {
    return a.subject.goal.rank - b.subject.goal.rank;
  }
  return groupLabel(a.subject).localeCompare(groupLabel(b.subject));
}

function groupLabel(subject: DeskGroupSubject): string {
  switch (subject.type) {
    case "goal":
      return subject.goal.title;
    case "project":
      return subject.project.projectCustomName ?? subject.project.projectDisplayName;
    case "host":
      return subject.serverName;
    case "agent":
      return subject.provider;
    case "loose":
      return "";
  }
}

function decisionCheckpoint(input: {
  host: DeskHostInput;
  decision: BoardDecision;
}): Omit<DeskCheckpoint, "snoozedUntil"> {
  const { host, decision } = input;
  return {
    key: `decision:${decision.id}`,
    kind: "decision",
    serverId: host.serverId,
    serverName: host.serverName,
    since: Date.parse(decision.createdAt),
    item: null,
    decision,
    goal: decision.goalId ? (host.goals.get(decision.goalId) ?? null) : null,
  };
}

class DeskBuilder {
  readonly decide: DeskCheckpoint[] = [];
  readonly snoozed: DeskCheckpoint[] = [];
  readonly flight = new GroupCollector<BoardItem[]>(() => []);
  readonly ahead = new GroupCollector<DeskAheadEntries>(() => ({ ready: [], fog: [] }));
  readonly landed = new GroupCollector<BoardItem[]>(() => []);
  private readonly decideKinds: ReadonlySet<DeskCheckpointKind>;
  private readonly landedCutoff: number;

  constructor(private readonly options: DeskOptions) {
    this.decideKinds = new Set(options.settings.decideKinds);
    this.landedCutoff = options.now - options.settings.landedRetentionDays * 24 * 60 * 60 * 1000;
  }

  addHost(host: DeskHostInput): void {
    const { options } = this;
    const focus = options.focus;
    if (focus && focus.serverId !== host.serverId) return;
    const columns = filterBoardItems(
      buildBoardItems([host], {
        showSubagents: options.showSubagents,
        doneWindow: "all",
        now: options.now,
      }),
      options.filters,
    );
    const grouper: Grouper = { host, grouping: options.settings.grouping };
    const inFocus = (item: BoardItem | null, goalId: string | null) =>
      !focus || (item ? itemGoalId(item, host.goals) : goalId) === focus.goalId;

    for (const item of [...columns.needs_you, ...columns.review]) {
      const goalId = itemGoalId(item, host.goals);
      const goal = goalId ? (host.goals.get(goalId) ?? null) : null;
      if (inFocus(item, null)) this.place(host, grouper, { ...checkpointFor(item), goal });
    }
    for (const decision of host.decisions.values()) {
      if (decision.resolvedAt !== null || !inFocus(null, decision.goalId)) continue;
      this.place(host, grouper, decisionCheckpoint({ host, decision }));
    }
    for (const item of columns.running) {
      if (inFocus(item, null)) this.flight.entry(groupOf({ ...grouper, item })).push(item);
    }
    this.addAhead({ host, grouper, columns, inFocus });
    for (const item of columns.done) {
      if (item.sortTime < this.landedCutoff || !inFocus(item, null)) continue;
      this.landed.entry(groupOf({ ...grouper, item })).push(item);
    }
  }

  build(): DeskModel {
    this.decide.sort((a, b) => a.since - b.since);
    this.snoozed.sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
    const landed = this.landed.list();
    for (const group of landed) group.entries.sort((a, b) => b.sortTime - a.sortTime);
    return {
      decide: this.decide,
      snoozed: this.snoozed,
      flight: this.flight.list(),
      ahead: this.ahead.list(),
      landed,
    };
  }

  private place(
    host: DeskHostInput,
    grouper: Grouper,
    checkpoint: Omit<DeskCheckpoint, "snoozedUntil">,
  ): void {
    const wake = host.snoozes.get(checkpoint.key);
    if (wake !== undefined && wake > this.options.now) {
      this.snoozed.push({ ...checkpoint, snoozedUntil: wake });
    } else if (this.decideKinds.has(checkpoint.kind) || checkpoint.item === null) {
      this.decide.push({ ...checkpoint, snoozedUntil: null });
    } else {
      this.flight.entry(groupOf({ ...grouper, item: checkpoint.item })).push(checkpoint.item);
    }
  }

  private addAhead(input: {
    host: DeskHostInput;
    grouper: Grouper;
    columns: ReturnType<typeof buildBoardItems>;
    inFocus: (item: BoardItem | null, goalId: string | null) => boolean;
  }): void {
    const { host, grouper, columns, inFocus } = input;
    if (grouper.grouping === "goal") {
      for (const goal of host.goals.values()) {
        if (goal.landedAt !== null || !inFocus(null, goal.id)) continue;
        this.ahead.ensure({
          key: `${host.serverId}:goal:${goal.id}`,
          serverId: host.serverId,
          subject: { type: "goal", goal },
        });
      }
    }
    for (const item of [...columns.ready, ...columns.fog]) {
      if (item.kind !== "task" || !inFocus(item, null)) continue;
      const entries = this.ahead.entry(groupOf({ ...grouper, item }));
      entries[item.column === "ready" ? "ready" : "fog"].push(item.card);
    }
  }
}

export function buildDeskModel(hosts: readonly DeskHostInput[], options: DeskOptions): DeskModel {
  const builder = new DeskBuilder(options);
  for (const host of hosts) builder.addHost(host);
  return builder.build();
}

/** Decide count for the sidebar: every unsnoozed checkpoint of a kind the host puts in Decide. */
export function countDeskDecide(
  hosts: readonly DeskHostInput[],
  settings: BoardDeskSettings,
): number {
  return buildDeskModel(hosts, {
    settings,
    filters: { query: "", projects: [], workspaces: [], providers: [], labels: [] },
    focus: null,
    showSubagents: false,
    now: Date.now(),
  }).decide.length;
}
