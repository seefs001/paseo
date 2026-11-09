import { join } from "node:path";
import type { Logger } from "pino";
import type {
  WorkspaceTraceNode,
  WorkspaceTracePage,
  WorkspaceTraceQuery,
} from "@getpaseo/protocol/workspace-trace";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { Message, DispatchRequest } from "../agent/agent-messages/delivery.js";
import type { PromptDispatchDisposition } from "../agent/agent-prompt.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { ScheduleService } from "../schedule/service.js";
import { TraceJournal, type TraceParticipant } from "./journal.js";
import { TraceProjection } from "./projection.js";

interface Dependencies {
  paseoHome: string;
  serverId: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  artifacts(): ArtifactStore | undefined;
  schedules: ScheduleService;
  hasPending(agentId: string): boolean;
}
export interface TraceSource {
  participant: TraceParticipant;
  turnId?: string;
}
interface RemoteMessage {
  source: TraceSource;
  agentId: string;
  serverId: string;
  messageId: string;
  behavior: "steer" | "interrupt";
}

/** Records trusted daemon facts and owns the bounded, workspace-local causal projection. */
export class WorkspaceTrace {
  private readonly journal: TraceJournal;

  constructor(private readonly deps: Dependencies) {
    this.journal = new TraceJournal(join(deps.paseoHome, "workspace-trace.jsonl"), deps.logger);
  }

  source(agentId: string): TraceSource {
    const agent = this.deps.agentManager.getAgent(agentId);
    return {
      participant: this.participant(agentId),
      turnId: agent?.activeForegroundTurnId ?? undefined,
    };
  }

  delegated(
    source: TraceSource,
    agentId: string,
    serverId = this.deps.serverId,
    workspaceId?: string,
  ): void {
    const target = this.participant(agentId, serverId, workspaceId);
    if (this.isInternal(source.participant) || this.isInternal(target)) return;
    this.journal.append({
      kind: "delegation",
      source: source.participant,
      target,
      sourceTurnId: source.turnId,
    });
  }

  remoteMessage(input: RemoteMessage): void {
    if (this.isInternal(input.source.participant)) return;
    this.journal.append({
      kind: "message",
      source: input.source.participant,
      target: this.participant(input.agentId, input.serverId),
      messageId: input.messageId,
      sourceTurnId: input.source.turnId,
      requestedBehavior: input.behavior,
    });
  }

  queued(message: Message, messageId: string): void {
    if (!message.trace) return;
    const source = this.participant(message.source.agentId, message.source.serverId);
    const target = this.participant(message.recipientId);
    if (this.isInternal(source) || this.isInternal(target)) return;
    this.journal.append({
      kind: "message",
      source,
      target,
      messageId,
      sourceTurnId: message.trace.sourceTurnId,
      requestedBehavior: message.activeTurnBehavior ?? "steer",
      notificationEvent:
        message.source.kind === "agent-notification" ? message.source.event : undefined,
      subscriptionIds: message.trace.subscriptionIds,
      triggerMessageIds: message.trace.triggerMessageIds,
      triggerCreationAgentIds: message.trace.triggerCreationAgentIds,
    });
  }

  dispatched(
    batchId: string,
    request: DispatchRequest,
    disposition: PromptDispatchDisposition,
    replaced: boolean,
  ): void {
    const target = this.participant(request.recipientId);
    if (this.isInternal(target)) return;
    let behavior: WorkspaceTraceNode["behavior"] = "started";
    if (disposition === "steered") behavior = "steered";
    else if (disposition === "out_of_band") behavior = "out_of_band";
    else if (replaced) behavior = "interrupted";
    this.journal.append(
      {
        kind: "dispatch",
        target,
        messageIds: [...request.messageIds],
        status: "dispatched",
        behavior,
      },
      batchId,
    );
  }

  failed(batchId: string, request: DispatchRequest): void {
    const target = this.participant(request.recipientId);
    if (this.isInternal(target)) return;
    this.journal.append(
      { kind: "dispatch", target, messageIds: [...request.messageIds], status: "failed" },
      batchId,
    );
  }

  flush(): Promise<void> {
    return this.journal.flush();
  }

  async get(query: WorkspaceTraceQuery): Promise<WorkspaceTracePage> {
    const [records, agents, schedules] = await Promise.all([
      this.journal.records(),
      this.deps.agentStorage.listAll(),
      this.deps.schedules.list(),
    ]);
    return new TraceProjection({
      query,
      records,
      agents,
      schedules,
      serverId: this.deps.serverId,
      instanceId: this.journal.instanceId,
      artifacts: this.deps.artifacts()?.list() ?? [],
      truncated: this.journal.truncated,
      incomplete: this.journal.incomplete,
      hasPending: this.deps.hasPending,
    }).page();
  }

  private isInternal(participant: TraceParticipant): boolean {
    return (
      participant.serverId === this.deps.serverId &&
      this.deps.agentManager.getAgent(participant.agentId)?.internal === true
    );
  }

  private participant(
    agentId: string,
    serverId = this.deps.serverId,
    workspaceId?: string,
  ): TraceParticipant {
    const local = serverId === this.deps.serverId;
    const agent = local ? this.deps.agentManager.getAgent(agentId) : null;
    return { agentId, serverId, workspaceId: workspaceId ?? agent?.workspaceId ?? null };
  }
}
