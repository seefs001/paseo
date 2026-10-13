import { z } from "zod";
import {
  isAgentToolCallItem,
  type AgentToolCallItem,
  type StreamItem,
  type ToolCallItem,
} from "@/types/stream";

const CallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.string(),
  status: z.enum(["running", "ok", "error", "cancelled"]),
  error: z.string().optional(),
});
const ResultSchema = z.object({
  details: z.object({ calls: z.array(z.unknown()) }),
});

const statuses = {
  running: "running",
  ok: "completed",
  error: "failed",
  cancelled: "canceled",
} as const;

const recordedCallsCache = new WeakMap<AgentToolCallItem, AgentToolCallItem[]>();

function recordedCalls(parent: AgentToolCallItem): AgentToolCallItem[] {
  const cached = recordedCallsCache.get(parent);
  if (cached) return cached;
  const { data } = parent.payload;
  if (data.detail.type !== "unknown") return [];
  const result = ResultSchema.safeParse(data.detail.output);
  if (!result.success) return [];

  const calls = result.data.details.calls.flatMap((raw, index): AgentToolCallItem[] => {
    const parsed = CallSchema.safeParse(raw);
    if (!parsed.success) return [];
    const call = parsed.data;
    // Pi does not know a running tool's id until executeTool resolves. Its live
    // execution events carry the real id and parent; don't duplicate those rows.
    if (call.id === `${data.callId}/?` && data.status === "running") return [];
    return [
      {
        kind: "tool_call",
        id: `${parent.id}:nested:${index}`,
        timestamp: parent.timestamp,
        payload: {
          source: "agent",
          data: {
            provider: data.provider,
            callId: call.id,
            name: call.name,
            status: statuses[call.status],
            error: call.error ?? null,
            detail: { type: "unknown", input: call.args, output: null },
            metadata: { parentToolCallId: data.callId },
          },
        },
      },
    ];
  });
  recordedCallsCache.set(parent, calls);
  return calls;
}

function sameItems(left: readonly StreamItem[], right: readonly StreamItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

interface CodemodeRows {
  replacements: Map<StreamItem, StreamItem>;
  hidden: Set<StreamItem>;
}

function indexChildrenByParent(calls: AgentToolCallItem[]) {
  const childrenByParent = new Map<string, AgentToolCallItem[]>();
  for (const call of calls) {
    const parentId = call.payload.data.metadata?.parentToolCallId;
    if (typeof parentId !== "string") continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(call);
    childrenByParent.set(parentId, siblings);
  }
  return childrenByParent;
}

function foldCalls(items: ToolCallItem[], previous: CodemodeRows): CodemodeRows {
  const replacements = new Map<StreamItem, StreamItem>();
  const hidden = new Set<StreamItem>();
  const calls = items.filter(isAgentToolCallItem);
  const byCallId = new Map(calls.map((call) => [call.payload.data.callId, call]));
  const childrenByParent = indexChildrenByParent(calls);

  for (const parent of calls) {
    const { data } = parent.payload;
    if (data.name !== "codemode") continue;
    const liveChildren = childrenByParent.get(data.callId) ?? [];
    const children: ToolCallItem[] = [];
    const included = new Set<string>();
    for (const recorded of recordedCalls(parent)) {
      const childId = recorded.payload.data.callId;
      // Interrupted calls can retain the placeholder even in the final result.
      // Prefer the real execution rows when available rather than doubling them.
      if (childId === `${data.callId}/?` && liveChildren.length > 0) continue;
      const live = byCallId.get(childId);
      if (live === parent) continue;
      children.push(live ?? recorded);
      if (live) hidden.add(live);
      included.add(childId);
    }
    for (const child of liveChildren) {
      if (child === parent || included.has(child.payload.data.callId)) continue;
      children.push(child);
      hidden.add(child);
    }
    if (children.length === 0) continue;
    const existing = previous.replacements.get(parent);
    const unchanged =
      existing?.kind === "tool_call" && sameItems(existing.nestedCalls ?? [], children);
    const row = unchanged ? existing : { ...parent, nestedCalls: children };
    replacements.set(parent, row);
  }
  return { replacements, hidden };
}

/** Fold by explicit Pi parentage, never by neighboring rows or concurrent call timing. */
export function createCodemodeProjection() {
  let previousTail: StreamItem[] | undefined;
  let tailCalls: ToolCallItem[] = [];
  let previousHeadCalls: ToolCallItem[] = [];
  let rows: CodemodeRows = { replacements: new Map(), hidden: new Set() };
  let projectedTail: StreamItem[] = [];

  function project(items: StreamItem[]): StreamItem[] {
    const result = items.flatMap((item) => {
      if (rows.hidden.has(item)) return [];
      return [rows.replacements.get(item) ?? item];
    });
    return sameItems(items, result) ? items : result;
  }

  return (tail: StreamItem[], head: StreamItem[]) => {
    const tailChanged = previousTail !== tail;
    if (tailChanged) tailCalls = tail.filter((item) => item.kind === "tool_call");
    const headCalls = head.filter((item) => item.kind === "tool_call");
    if (tailChanged || !sameItems(previousHeadCalls, headCalls)) {
      rows = foldCalls([...tailCalls, ...headCalls], rows);
      const nextTail = project(tail);
      projectedTail = sameItems(projectedTail, nextTail) ? projectedTail : nextTail;
      previousTail = tail;
      previousHeadCalls = headCalls;
    }
    return { tail: projectedTail, head: project(head) };
  };
}
