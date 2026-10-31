import { z } from "zod";
import { AgentTimelineCursorSchema, type AgentMetadata } from "@getpaseo/protocol/messages";
import { timelineItemIdentity } from "@getpaseo/protocol/timeline-identity";
import { ensureAgentLoaded, type EnsureAgentLoadedDeps } from "../agent-loading.js";
import type { AgentManager } from "../agent-manager.js";
import type { ProjectedTimelineRow } from "../timeline-projection.js";
import { PaseoToolInputError } from "./types.js";

export const ReadAgentContextInputSchema = z.object({
  agentId: z.string().optional().describe("Agent ID; defaults to the calling agent."),
});

export const ReadAgentHistoryInputSchema = z.object({
  agentId: z.string(),
  messageId: z
    .string()
    .optional()
    .describe("Message identity returned by this tool or the source message."),
  cursor: AgentTimelineCursorSchema.optional(),
  direction: z
    .enum(["around", "before", "after", "tail"])
    .optional()
    .describe(
      "around includes the anchor and earlier items; before/after exclude the anchor. Defaults to around with an anchor, otherwise tail.",
    ),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

type ReadAgentContextInput = z.infer<typeof ReadAgentContextInputSchema>;
type ReadAgentHistoryInput = z.infer<typeof ReadAgentHistoryInputSchema>;

interface AgentContextDependencies extends EnsureAgentLoadedDeps {
  agentManager: AgentManager;
  callerAgentId?: string;
}

export async function readAgentContext(
  input: ReadAgentContextInput,
  deps: AgentContextDependencies,
): Promise<{ metadata: AgentMetadata | null }> {
  const agentId = input.agentId ?? deps.callerAgentId;
  if (!agentId) {
    throw new PaseoToolInputError("agentId is required outside an agent-scoped session");
  }
  const agent = deps.agentManager.getAgent(agentId);
  if (agent && !agent.internal) {
    return { metadata: agent.config.metadata ?? null };
  }
  const record = await deps.agentStorage.get(agentId);
  if (!record || record.internal) {
    throw new PaseoToolInputError(`Agent ${agentId} not found`);
  }
  return { metadata: record.metadata ?? null };
}

function messageIdentity(row: ProjectedTimelineRow, epoch: string): string {
  const item = row.item;
  if (item.type === "user_message") {
    return (
      item.messageId ??
      item.clientMessageId ??
      row.providerMessageId ??
      `timeline:${epoch}:${row.seqStart}`
    );
  }
  if (item.type === "assistant_message" && item.messageId) return item.messageId;
  return row.providerMessageId ?? timelineItemIdentity(item) ?? `timeline:${epoch}:${row.seqStart}`;
}

function matchesMessage(row: ProjectedTimelineRow, messageId: string, epoch: string): boolean {
  if (messageIdentity(row, epoch) === messageId) return true;
  const prefix = `timeline:${epoch}:`;
  if (messageId.startsWith(prefix)) {
    const seq = Number(messageId.slice(prefix.length));
    if (
      Number.isInteger(seq) &&
      row.sourceSeqRanges.some((range) => seq >= range.startSeq && seq <= range.endSeq)
    )
      return true;
  }
  if (row.providerMessageId === messageId) return true;
  return row.item.type === "user_message" && row.item.clientMessageId === messageId;
}

function findMessage(
  input: ReadAgentHistoryInput,
  deps: AgentContextDependencies,
  epoch: string,
): ProjectedTimelineRow {
  const sourceCursor = input.cursor;
  const canUseCursor = sourceCursor !== undefined && sourceCursor.epoch === epoch;
  let cursor = canUseCursor ? { epoch, seq: sourceCursor.seq + 1 } : undefined;
  for (;;) {
    const page = deps.agentManager.fetchTimeline(input.agentId, {
      direction: cursor ? "before" : "tail",
      cursor,
      limit: 100,
    });
    const anchor = page.rows.find((row) => {
      if (canUseCursor) {
        return row.sourceSeqRanges.some(
          (range) => sourceCursor.seq >= range.startSeq && sourceCursor.seq <= range.endSeq,
        );
      }
      return input.messageId !== undefined && matchesMessage(row, input.messageId, epoch);
    });
    if (anchor) return anchor;
    if (!page.hasOlder || page.startSeq === null) break;
    cursor = { epoch, seq: page.startSeq };
  }
  throw new PaseoToolInputError(
    "History anchor not found; use a current cursor or a stable message ID",
  );
}

export async function readAgentHistory(
  input: ReadAgentHistoryInput,
  deps: AgentContextDependencies,
) {
  const agent = await ensureAgentLoaded(input.agentId, deps);
  if (agent.internal) {
    throw new PaseoToolInputError(`Agent ${input.agentId} not found`);
  }
  const hasAnchor = input.messageId !== undefined || input.cursor !== undefined;
  const direction = input.direction ?? (hasAnchor ? "around" : "tail");
  if (direction !== "tail" && !hasAnchor) {
    throw new PaseoToolInputError("messageId or cursor is required for an anchored history read");
  }
  const { epoch } = deps.agentManager.fetchTimeline(input.agentId, { limit: 1 });
  const staleCursor = input.cursor !== undefined && input.cursor.epoch !== epoch;
  if (staleCursor && !input.messageId) {
    throw new PaseoToolInputError("History cursor expired; provide a stable message ID");
  }
  let cursor = input.cursor;
  if (direction !== "tail") {
    const anchor = findMessage(input, deps, epoch);
    let seq = anchor.seqStart;
    if (direction === "around") seq += 1;
    if (direction === "after") seq = anchor.seqEnd;
    cursor = { epoch, seq };
  }
  const fetched = deps.agentManager.fetchTimeline(input.agentId, {
    direction: direction === "around" ? "before" : direction,
    cursor,
    limit: input.limit,
  });
  // Source-coverage spans can expand a projected page. MCP reads keep a hard item bound.
  const rows =
    direction === "after" ? fetched.rows.slice(0, input.limit) : fetched.rows.slice(-input.limit);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const startCursor = first ? { epoch, seq: first.seqStart } : null;
  const endCursor = last ? { epoch, seq: last.seqEnd } : null;
  return {
    agentId: input.agentId,
    epoch,
    staleCursor,
    startCursor,
    endCursor,
    hasOlder: fetched.hasOlder || fetched.rows[0] !== first,
    hasNewer: fetched.hasNewer || fetched.rows[fetched.rows.length - 1] !== last,
    entries: rows.map((row) => ({
      messageId: messageIdentity(row, epoch),
      cursor: { epoch, seq: row.seqEnd },
      providerMessageId: row.providerMessageId,
      timestamp: row.timestamp,
      seqStart: row.seqStart,
      seqEnd: row.seqEnd,
      sourceSeqRanges: row.sourceSeqRanges,
      turnId: row.turnId,
      item: row.item,
    })),
  };
}
