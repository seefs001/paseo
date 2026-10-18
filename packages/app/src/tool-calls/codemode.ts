import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
import {
  isAgentToolCallItem,
  type AgentToolCallItem,
  type StreamItem,
  type ToolCallItem,
} from "@/types/stream";

const SCRIPT_OUTPUT_LIMIT = 8_000;

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
    const restored = detailForRecordedCall(call.name, call.args);
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
            detail: restored.detail,
            metadata: {
              parentToolCallId: data.callId,
              ...(restored.summary ? { summary: restored.summary } : {}),
            },
          },
        },
      },
    ];
  });
  const fullOutput = fullOutputCall(parent);
  const restoredCalls = fullOutput ? [...calls, fullOutput] : calls;
  recordedCallsCache.set(parent, restoredCalls);
  return restoredCalls;
}

interface RestoredCallDetail {
  detail: ToolCallDetail;
  summary?: string;
}

function detailForRecordedCall(name: string, args: string): RestoredCallDetail {
  const values = recordedValues(args);
  const typed = typedRecordedDetail(name, values);
  if (typed) return { detail: typed };
  const summary = recordedSummary(values);
  return {
    detail: { type: "unknown", input: values ?? args, output: null },
    ...(summary ? { summary } : {}),
  };
}

function typedRecordedDetail(
  name: string,
  values: Record<string, unknown> | undefined,
): ToolCallDetail | undefined {
  const command = stringValue(values, "command");
  const filePath = stringValue(values, "path");
  if (name === "bash" && command) return { type: "shell", command, exitCode: null };
  if (name === "read" && filePath) return readDetail(filePath, values);
  if (name === "edit" && filePath) return { type: "edit", filePath, ...firstEdit(values) };
  if (name === "write" && filePath) return writeDetail(filePath, values);
  if (name === "web_search") {
    const query = searchQuery(values);
    if (query) return { type: "search", query, toolName: "web_search" };
  }
  if (name === "fetch_content") {
    const url = fetchUrl(values);
    if (url) return { type: "fetch", url };
  }
  return undefined;
}

function readDetail(filePath: string, values: Record<string, unknown> | undefined): ToolCallDetail {
  const offset = finiteNumber(values?.offset);
  const limit = finiteNumber(values?.limit);
  return {
    type: "read",
    filePath,
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function writeDetail(
  filePath: string,
  values: Record<string, unknown> | undefined,
): ToolCallDetail {
  const content = stringValue(values, "content");
  return { type: "write", filePath, ...(content ? { content } : {}) };
}

function recordedSummary(values: Record<string, unknown> | undefined): string | undefined {
  return (
    stringValue(values, "command") ??
    stringValue(values, "path") ??
    stringValue(values, "task_id") ??
    stringValue(values, "url")
  );
}

function recordedValues(args: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(args);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return salvagedValues(args);
  }
}

function salvagedValues(args: string): Record<string, unknown> | undefined {
  const values: Record<string, unknown> = {};
  for (const key of ["command", "path", "url", "task_id"]) {
    const field = readStringField(args, key);
    if (field) values[key] = field;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function readStringField(source: string, key: string): string | undefined {
  const keyAt = source.indexOf(`"${key}"`);
  if (keyAt < 0) return undefined;
  let index = keyAt + key.length + 2;
  while (index < source.length && source[index] === " ") index += 1;
  if (source[index] !== ":") return undefined;
  index += 1;
  while (index < source.length && source[index] === " ") index += 1;
  if (source[index] !== '"') return undefined;
  index += 1;
  let value = "";
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      if (index + 1 >= source.length) return stripTruncationMarker(value);
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (character === '"') return value;
    value += character ?? "";
    index += 1;
  }
  const truncated = stripTruncationMarker(value);
  return truncated.length > 0 ? truncated : undefined;
}

function stripTruncationMarker(value: string): string {
  return value.endsWith("...") ? value.slice(0, -3) : value;
}

function stringValue(values: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = values?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstEdit(values: Record<string, unknown> | undefined): {
  oldString?: string;
  newString?: string;
} {
  const edits = values?.edits;
  if (!Array.isArray(edits) || !isRecord(edits[0])) return {};
  const oldString = typeof edits[0].oldText === "string" ? edits[0].oldText : undefined;
  const newString = typeof edits[0].newText === "string" ? edits[0].newText : undefined;
  return {
    ...(oldString === undefined ? {} : { oldString }),
    ...(newString === undefined ? {} : { newString }),
  };
}

function searchQuery(values: Record<string, unknown> | undefined): string | undefined {
  const queries = values?.queries;
  if (typeof queries === "string" && queries.trim()) return queries;
  if (!Array.isArray(queries)) return undefined;
  const parts = queries.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function fetchUrl(values: Record<string, unknown> | undefined): string | undefined {
  const url = stringValue(values, "url");
  if (url) return url;
  const urls = values?.urls;
  if (!Array.isArray(urls)) return undefined;
  return typeof urls[0] === "string" && urls[0].trim().length > 0 ? urls[0] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fullOutputCall(parent: AgentToolCallItem): AgentToolCallItem | undefined {
  const output =
    parent.payload.data.detail.type === "unknown" ? parent.payload.data.detail.output : undefined;
  const filePath = fullOutputPath(output);
  if (!filePath) return undefined;
  const { data } = parent.payload;
  return {
    kind: "tool_call",
    id: `${parent.id}:full-output`,
    timestamp: parent.timestamp,
    payload: {
      source: "agent",
      data: {
        provider: data.provider,
        callId: `${data.callId}:full-output`,
        name: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath },
        metadata: { parentToolCallId: data.callId },
      },
    },
  };
}

function fullOutputPath(output: unknown): string | undefined {
  if (!isRecord(output) || !isRecord(output.details)) return undefined;
  const filePath = output.details.fullOutputPath;
  return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : undefined;
}

function scriptOutputText(parent: AgentToolCallItem): string | undefined {
  if (parent.payload.data.detail.type !== "unknown") return undefined;
  const body = visibleScriptBody(outputText(parent.payload.data.detail.output));
  if (!body) return undefined;
  const hasFullOutput = fullOutputPath(parent.payload.data.detail.output) !== undefined;
  if (body.length <= SCRIPT_OUTPUT_LIMIT) return body;
  const note = hasFullOutput ? "Output truncated. The full output is below." : "Output truncated.";
  return `${body.slice(0, SCRIPT_OUTPUT_LIMIT)}\n\n${note}`;
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!isRecord(output) || !Array.isArray(output.content)) return "";
  const parts: string[] = [];
  for (const block of output.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function visibleScriptBody(raw: string): string | undefined {
  const marker = raw.indexOf("==> text");
  const sliced = marker >= 0 ? raw.slice(marker) : raw;
  const stripped = sliced
    .replace(/^Script (?:completed|failed)\s*\n?/i, "")
    .replace(/^Wall time[^\n]*\n?/i, "")
    .replace(/^Output:\s*\n?/i, "")
    .trim();
  return stripped.length > 0 ? stripped : undefined;
}

function presentCodemodeParent(parent: AgentToolCallItem, children: ToolCallItem[]): ToolCallItem {
  const text = scriptOutputText(parent);
  const hosted = children.length > 0 ? { ...parent, nestedCalls: children } : parent;
  if (!text) return hosted;
  return {
    ...hosted,
    payload: {
      ...parent.payload,
      data: {
        ...parent.payload.data,
        detail: { type: "plain_text", label: "Output", text },
      },
    },
  };
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
    if (children.length === 0 && !scriptOutputText(parent)) continue;
    const existing = previous.replacements.get(parent);
    const unchanged =
      existing?.kind === "tool_call" && sameItems(existing.nestedCalls ?? [], children);
    const row = unchanged ? existing : presentCodemodeParent(parent, children);
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
