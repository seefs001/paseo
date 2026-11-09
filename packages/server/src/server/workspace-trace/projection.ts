import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import type { Artifact } from "@getpaseo/protocol/messages";
import type { StoredSchedule } from "@getpaseo/protocol/schedule/types";
import type {
  WorkspaceTraceAnchor,
  WorkspaceTraceEdge,
  WorkspaceTraceGap,
  WorkspaceTraceLane,
  WorkspaceTraceNode,
  WorkspaceTracePage,
  WorkspaceTraceQuery,
} from "@getpaseo/protocol/workspace-trace";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { TraceParticipant, TraceRecord } from "./journal.js";

type MessageRecord = Extract<TraceRecord, { kind: "message" }>;
interface ProjectionInput {
  query: WorkspaceTraceQuery;
  serverId: string;
  instanceId: string;
  records: readonly TraceRecord[];
  agents: StoredAgentRecord[];
  artifacts: Artifact[];
  schedules: StoredSchedule[];
  truncated: boolean;
  incomplete: boolean;
  hasPending(agentId: string): boolean;
}
function laneId(participant: TraceParticipant): string {
  return `${participant.serverId}/${participant.agentId}`;
}
function messageNodeId(serverId: string, messageId: string): string {
  return `message:${serverId}:${messageId}`;
}

/** Internal projection: only recorded identities create causal links. */
export class TraceProjection {
  private readonly agents: Map<string, StoredAgentRecord>;
  private readonly nodes = new Map<string, WorkspaceTraceNode>();
  private readonly edges: WorkspaceTraceEdge[] = [];
  private readonly lanes = new Map<string, WorkspaceTraceLane>();
  private readonly gaps: WorkspaceTraceGap[] = [{ kind: "history" }];
  private readonly messages = new Map<string, MessageRecord>();
  private readonly creations = new Map<string, string>();

  constructor(private readonly input: ProjectionInput) {
    this.agents = new Map(input.agents.map((agent) => [agent.id, agent]));
  }

  page(): WorkspaceTracePage {
    if (this.input.truncated) this.gaps.push({ kind: "retention" });
    if (this.input.incomplete) this.gaps.push({ kind: "recording" });
    for (const record of this.input.records) {
      if (record.kind === "message") this.addMessage(record);
      if (record.kind === "delegation") this.addDelegation(record);
    }
    for (const record of this.input.records) {
      if (record.kind === "dispatch") this.addDispatch(record);
    }
    for (const artifact of this.input.artifacts) this.addArtifact(artifact);
    for (const schedule of this.input.schedules) this.addSchedule(schedule);
    for (const [id, record] of this.messages) this.linkNotification(id, record);
    return this.window();
  }

  private isLocal(participant: TraceParticipant): boolean {
    if (participant.serverId !== this.input.serverId) return false;
    const workspaceId =
      participant.workspaceId ?? this.agents.get(participant.agentId)?.workspaceId;
    return workspaceId === this.input.query.workspaceId;
  }

  private isInternal(participant: TraceParticipant): boolean {
    return (
      participant.serverId === this.input.serverId &&
      this.agents.get(participant.agentId)?.internal === true
    );
  }

  private visibleRelation(source: TraceParticipant, target: TraceParticipant): boolean {
    const touchesWorkspace = this.isLocal(source) || this.isLocal(target);
    return touchesWorkspace && !this.isInternal(source) && !this.isInternal(target);
  }

  private addLane(participant: TraceParticipant): string {
    const id = laneId(participant);
    if (this.lanes.has(id)) return id;
    const local = this.isLocal(participant);
    const agent =
      participant.serverId === this.input.serverId
        ? this.agents.get(participant.agentId)
        : undefined;
    const parent = agent ? getParentAddressFromLabels(agent.labels, this.input.serverId) : null;
    let availability: WorkspaceTraceLane["availability"] = "external";
    if (local) {
      availability = "missing";
      if (agent) availability = agent.archivedAt ? "archived" : "local";
    }
    this.lanes.set(id, {
      id,
      serverId: participant.serverId,
      agentId: participant.agentId,
      workspaceId: participant.workspaceId ?? agent?.workspaceId ?? null,
      title: local ? (agent?.title ?? null) : null,
      availability,
      parentLaneId: local && parent ? `${parent.serverId}/${parent.agentId}` : null,
    });
    return id;
  }

  private anchor(participant: TraceParticipant): WorkspaceTraceAnchor | null {
    if (!this.isLocal(participant) || !this.agents.has(participant.agentId)) return null;
    return { kind: "agent", serverId: participant.serverId, agentId: participant.agentId };
  }

  private addMessage(record: MessageRecord): void {
    if (!this.visibleRelation(record.source, record.target)) return;
    const id = messageNodeId(record.target.serverId, record.messageId);
    this.messages.set(id, record);
    const pending =
      record.target.serverId === this.input.serverId &&
      this.input.hasPending(record.target.agentId);
    const current = record.instanceId === this.input.instanceId;
    const status = pending && current ? "queued" : "unknown";
    this.nodes.set(id, {
      id,
      kind: record.notificationEvent ? "notification" : "message",
      laneId: this.addLane(record.source),
      at: record.at,
      evidence: "recorded",
      status,
      messageIds: [record.messageId],
      anchor: this.anchor(record.source),
      requestedBehavior: record.requestedBehavior,
      sourceTurnId: record.sourceTurnId,
      notificationEvent: record.notificationEvent,
      subscriptionIds: record.subscriptionIds,
    });
    if (record.target.serverId !== this.input.serverId) this.addRemoteAdmission(id, record);
  }

  private addRemoteAdmission(id: string, record: MessageRecord): void {
    const targetId = `admission:${id}`;
    this.nodes.set(targetId, {
      id: targetId,
      kind: "message",
      laneId: this.addLane(record.target),
      at: record.at,
      evidence: "recorded",
      status: "unknown",
      messageIds: [record.messageId],
      anchor: null,
    });
    this.edges.push({
      id: targetId,
      sourceNodeId: id,
      targetNodeId: targetId,
      kind: "message",
      evidence: "recorded",
    });
  }

  private addDelegation(record: Extract<TraceRecord, { kind: "delegation" }>): void {
    if (!this.visibleRelation(record.source, record.target)) return;
    const sourceId = `delegation:${record.id}`;
    const targetId = `created:${record.id}`;
    this.creations.set(laneId(record.target), targetId);
    this.nodes.set(sourceId, {
      id: sourceId,
      kind: "delegation",
      laneId: this.addLane(record.source),
      at: record.at,
      evidence: "recorded",
      status: "recorded",
      messageIds: [],
      anchor: this.anchor(record.source),
      sourceTurnId: record.sourceTurnId,
    });
    this.nodes.set(targetId, {
      id: targetId,
      kind: "agent_created",
      laneId: this.addLane(record.target),
      at: record.at,
      evidence: "recorded",
      status: "recorded",
      messageIds: [],
      anchor: this.anchor(record.target),
    });
    this.edges.push({
      id: record.id,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      kind: "delegation",
      evidence: "recorded",
    });
  }

  private addDispatch(record: Extract<TraceRecord, { kind: "dispatch" }>): void {
    const sources = record.messageIds.map((id) => messageNodeId(record.target.serverId, id));
    const visible = this.isLocal(record.target) || sources.some((id) => this.nodes.has(id));
    if (!visible || this.isInternal(record.target)) return;
    const id = `dispatch:${record.id}`;
    let anchor = this.anchor(record.target);
    const canLocate =
      anchor?.kind === "agent" && record.status === "dispatched" && record.messageIds.length > 0;
    if (canLocate && anchor?.kind === "agent")
      anchor = { ...anchor, callId: `paseo-agent-message:${record.messageIds[0]}` };
    this.nodes.set(id, {
      id,
      kind: "dispatch",
      laneId: this.addLane(record.target),
      at: record.at,
      evidence: "recorded",
      status: record.status,
      messageIds: record.messageIds,
      anchor,
      behavior: record.behavior,
    });
    for (const sourceId of sources) this.linkDispatch(record, id, sourceId);
  }

  private linkDispatch(
    record: Extract<TraceRecord, { kind: "dispatch" }>,
    id: string,
    sourceId: string,
  ): void {
    const source = this.nodes.get(sourceId);
    if (!source) {
      this.gaps.push({ kind: "recording", agentId: record.target.agentId });
      return;
    }
    source.status = record.status;
    source.behavior = record.behavior;
    this.edges.push({
      id: `${id}/${sourceId}`,
      sourceNodeId: sourceId,
      targetNodeId: id,
      kind: source.kind === "notification" ? "notification" : "message",
      evidence: "recorded",
    });
  }

  private addArtifact(artifact: Artifact): void {
    if (artifact.workspaceId !== this.input.query.workspaceId || !artifact.sourceAgentId) return;
    const participant = {
      agentId: artifact.sourceAgentId,
      serverId: this.input.serverId,
      workspaceId: artifact.workspaceId,
    };
    if (this.isInternal(participant)) return;
    const id = `artifact:${artifact.id}`;
    this.nodes.set(id, {
      id,
      kind: "artifact",
      laneId: this.addLane(participant),
      at: artifact.createdAt,
      evidence: "existing",
      status: "recorded",
      messageIds: [],
      title: artifact.title,
      anchor: { kind: "artifact", artifactId: artifact.id },
    });
  }

  private addSchedule(schedule: StoredSchedule): void {
    for (const run of schedule.runs) {
      if (!run.agentId) continue;
      const participant = {
        agentId: run.agentId,
        serverId: this.input.serverId,
        workspaceId: run.workspaceId ?? null,
      };
      if (!this.isLocal(participant) || this.isInternal(participant)) continue;
      const id = `schedule:${schedule.id}:${run.id}`;
      this.nodes.set(id, {
        id,
        kind: "schedule",
        laneId: this.addLane(participant),
        at: run.startedAt,
        evidence: "existing",
        status: "recorded",
        messageIds: [],
        anchor: this.anchor(participant),
        title: schedule.name ?? undefined,
      });
    }
  }

  private linkNotification(id: string, record: MessageRecord): void {
    const origins = (record.triggerMessageIds ?? []).map((messageId) =>
      messageNodeId(record.source.serverId, messageId),
    );
    for (const agentId of record.triggerCreationAgentIds ?? []) {
      const creation = this.creations.get(`${record.source.serverId}/${agentId}`);
      if (creation) origins.push(creation);
      else this.gaps.push({ kind: "retention" });
    }
    for (const origin of origins) {
      if (this.nodes.has(origin))
        this.edges.push({
          id: `notification:${origin}:${id}`,
          sourceNodeId: origin,
          targetNodeId: id,
          kind: "notification",
          evidence: "recorded",
        });
      else this.gaps.push({ kind: "retention" });
    }
    if (this.nodes.get(id)?.status === "unknown")
      this.gaps.push({ kind: "pending", agentId: record.target.agentId });
  }

  private addWithinBudget(selected: Set<string>, id: string, budget: number): void {
    if (selected.has(id)) return;
    if (selected.size < budget) selected.add(id);
    else this.gaps.push({ kind: "window" });
  }

  private focus(selected: Set<string>, id: string): void {
    if (!this.nodes.has(id)) {
      this.gaps.push({ kind: "focus_unavailable" });
      return;
    }
    selected.add(id);
    const query = this.input.query;
    for (let depth = 0; depth < (query.depth ?? 2); depth++) {
      const frontier = new Set(selected);
      for (const edge of this.edges) {
        const touchesFrontier = frontier.has(edge.sourceNodeId) || frontier.has(edge.targetNodeId);
        if (!touchesFrontier) continue;
        this.addWithinBudget(selected, edge.sourceNodeId, query.limit ?? 100);
        this.addWithinBudget(selected, edge.targetNodeId, query.limit ?? 100);
      }
    }
  }

  private selectPage(selected: Set<string>, ordered: WorkspaceTraceNode[]): string | null {
    const { cursor, limit = 100 } = this.input.query;
    const index = cursor ? ordered.findIndex((node) => node.id === cursor) : -1;
    if (cursor && index < 0) {
      this.gaps.push({ kind: "focus_unavailable" });
      return null;
    }
    const offset = index + 1;
    for (const node of ordered.slice(offset, offset + limit)) selected.add(node.id);
    return offset + limit < ordered.length ? ordered[offset + limit - 1]!.id : null;
  }

  private window(): WorkspaceTracePage {
    const ordered = [...this.nodes.values()].sort(
      (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
    );
    const selected = new Set<string>();
    const focus = this.input.query.focusNodeId;
    let nextCursor: string | null = null;
    if (focus) this.focus(selected, focus);
    else nextCursor = this.selectPage(selected, ordered);
    // One-hop batch inputs share a hard 200-node budget, never an unbounded closure.
    const dispatches = new Set(
      [...selected].filter((id) => this.nodes.get(id)?.kind === "dispatch"),
    );
    for (const edge of this.edges) {
      if (dispatches.has(edge.targetNodeId)) this.addWithinBudget(selected, edge.sourceNodeId, 200);
    }
    const visibleNodes = ordered.filter((node) => selected.has(node.id));
    const laneIds = new Set(visibleNodes.map((node) => node.laneId));
    const visibleEdges = this.edges.filter(
      (edge) => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId),
    );
    const clipped = this.edges.some(
      (edge) => selected.has(edge.sourceNodeId) !== selected.has(edge.targetNodeId),
    );
    if (clipped) this.gaps.push({ kind: "window" });
    const uniqueGaps = new Map(this.gaps.map((gap) => [`${gap.kind}:${gap.agentId ?? ""}`, gap]));
    return {
      workspaceId: this.input.query.workspaceId,
      serverId: this.input.serverId,
      capturedAt: new Date().toISOString(),
      nodes: visibleNodes,
      edges: visibleEdges,
      lanes: [...this.lanes.values()].filter((lane) => laneIds.has(lane.id)),
      gaps: [...uniqueGaps.values()],
      nextCursor,
      focusNodeId: focus ?? null,
    };
  }
}
