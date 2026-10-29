import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { McpCallRecord } from "@getpaseo/protocol/messages";
import type pino from "pino";

const DEFAULT_MEMORY_LIMIT = 200;
const DEFAULT_MAX_BYTES = 2_000_000;
const TAIL_BYTES = 512_000;
const ERROR_LIMIT = 200;
const ARGUMENT_LIMIT = 4_000;
const LABEL_LIMIT = 48;
const MAX_LABELS = 8;
const INTERNAL_AGENT_LABEL_PREFIX = "paseo.";

export interface McpCallDraft {
  callerAgentId: string | null;
  method: string;
  tool: string | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
  arguments?: string | null;
  labels?: readonly string[];
}

interface McpCallLogOptions {
  memoryLimit?: number;
  maxBytes?: number;
}

interface JsonRpcCall {
  method: string;
  tool: string | null;
  arguments: string | null;
}

const logs = new Map<string, McpCallLog>();

export function getMcpCallLog(
  paseoHome: string,
  logger?: pino.Logger,
  options?: McpCallLogOptions,
): McpCallLog {
  const existing = logs.get(paseoHome);
  if (existing) {
    if (logger) existing.setLogger(logger);
    return existing;
  }
  const created = new McpCallLog(paseoHome, logger, options);
  logs.set(paseoHome, created);
  return created;
}

export class McpCallLog {
  private readonly filePath: string;
  private readonly memoryLimit: number;
  private readonly maxBytes: number;
  private logger: pino.Logger | undefined;
  private records: McpCallRecord[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;

  constructor(paseoHome: string, logger?: pino.Logger, options?: McpCallLogOptions) {
    this.filePath = path.join(paseoHome, "mcp-calls.jsonl");
    this.memoryLimit = options?.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.logger = logger;
    this.ready = this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    const stored = await readStoredRecords(this.filePath, this.memoryLimit, this.logger);
    this.records = [...stored, ...this.records].slice(-this.memoryLimit);
  }

  setLogger(logger: pino.Logger): void {
    this.logger = logger;
  }

  record(draft: McpCallDraft): McpCallRecord {
    const labels = normalizeLabels(draft.labels ?? []);
    const record: McpCallRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      callerAgentId: draft.callerAgentId,
      method: draft.method,
      tool: draft.tool,
      ok: draft.ok,
      error: clipError(draft.error),
      durationMs: Math.max(0, Math.floor(draft.durationMs)),
      arguments: clipArguments(draft.arguments ?? null),
      ...(labels.length > 0 ? { labels } : {}),
    };
    this.records.push(record);
    if (this.records.length > this.memoryLimit) {
      this.records.splice(0, this.records.length - this.memoryLimit);
    }
    this.logger?.info(
      {
        callerAgentId: record.callerAgentId,
        method: record.method,
        tool: record.tool,
        ok: record.ok,
        durationMs: record.durationMs,
      },
      "Agent MCP call",
    );
    this.enqueueWrite(record);
    return record;
  }

  async list(limit: number): Promise<McpCallRecord[]> {
    await this.ready;
    const size = Math.min(this.memoryLimit, Math.max(1, Math.floor(limit)));
    return this.records.slice(-size).toReversed();
  }

  flush(): Promise<void> {
    return this.writeChain;
  }

  private enqueueWrite(record: McpCallRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.writeChain = this.writeChain
      .then(() => this.appendLine(line))
      .catch((error: unknown) => {
        this.logger?.warn({ err: error }, "Failed to store Agent MCP call");
      });
  }

  private async appendLine(line: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const current = await stat(this.filePath).catch(() => null);
    if (current && current.size > this.maxBytes) {
      await rename(this.filePath, `${this.filePath}.1`).catch(() => undefined);
    }
    await appendFile(this.filePath, line, "utf8");
  }
}

export function jsonRpcCalls(body: unknown): JsonRpcCall[] {
  const messages = Array.isArray(body) ? body : [body];
  const calls: JsonRpcCall[] = [];
  for (const message of messages) {
    if (!isRecord(message) || typeof message["method"] !== "string" || message["method"] === "") {
      continue;
    }
    const params = message["params"];
    const isToolCall = message["method"] === "tools/call";
    let tool: string | null = null;
    let callArguments: string | null = null;
    if (isToolCall && isRecord(params)) {
      tool = typeof params["name"] === "string" ? params["name"] : null;
      callArguments = formatCallArguments(params["arguments"]);
    } else if (!isToolCall) {
      callArguments = formatCallArguments(params);
    }
    calls.push({ method: message["method"], tool, arguments: callArguments });
  }
  return calls;
}

/**
 * Labels stamped on every call of one MCP request: the `label` query values the client put in its
 * MCP URL (repeatable or comma-separated), then the caller agent's own labels as `key=value`.
 * Paseo's internal `paseo.*` agent labels identify plumbing, not the work, so they stay out.
 */
export function resolveCallLabels(input: {
  connection: unknown;
  agentLabels: Readonly<Record<string, string>> | null;
}): string[] {
  const connectionValues = Array.isArray(input.connection) ? input.connection : [input.connection];
  const labels: string[] = [];
  for (const value of connectionValues) {
    if (typeof value !== "string") continue;
    labels.push(...value.split(","));
  }
  for (const [key, value] of Object.entries(input.agentLabels ?? {})) {
    if (key.startsWith(INTERNAL_AGENT_LABEL_PREFIX)) continue;
    labels.push(`${key}=${value}`);
  }
  return normalizeLabels(labels);
}

export function recordMcpRequestBody(
  log: McpCallLog,
  params: {
    body: unknown;
    callerAgentId: string | null;
    labels: readonly string[];
    ok: boolean;
    error: string | null;
    durationMs: number;
    skipToolCalls: number;
  },
): void {
  const calls = jsonRpcCalls(params.body);
  let skippedTools = 0;
  const entries = calls.length > 0 ? calls : [{ method: "request", tool: null, arguments: null }];
  for (const call of entries) {
    if (call.method === "tools/call" && skippedTools < params.skipToolCalls) {
      skippedTools += 1;
      continue;
    }
    log.record({
      callerAgentId: params.callerAgentId,
      method: call.method,
      tool: call.tool,
      ok: params.ok,
      error: params.error,
      durationMs: params.durationMs,
      arguments: call.arguments,
      labels: params.labels,
    });
  }
}

function normalizeLabels(values: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const value of values) {
    const label = value.trim().slice(0, LABEL_LIMIT);
    if (label) labels.add(label);
    if (labels.size === MAX_LABELS) break;
  }
  return [...labels];
}

function clipError(error: string | null): string | null {
  if (error === null) return null;
  return error.length > ERROR_LIMIT ? `${error.slice(0, ERROR_LIMIT)}…` : error;
}

function clipArguments(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  if (value.length <= ARGUMENT_LIMIT + 1) return value;
  return `${value.slice(0, ARGUMENT_LIMIT)}…`;
}

/** Pretty JSON for a tool input. Returns null when there is nothing to store. */
export function formatCallArguments(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return clipArguments(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStoredRecords(
  filePath: string,
  memoryLimit: number,
  logger: pino.Logger | undefined,
): Promise<McpCallRecord[]> {
  try {
    const text = await readTail(filePath, TAIL_BYTES);
    if (text === null) return [];
    const records: McpCallRecord[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const record = parseStoredRecord(line);
      if (record) records.push(record);
    }
    return records.slice(-memoryLimit);
  } catch (error) {
    logger?.warn({ err: error }, "Failed to read stored Agent MCP calls");
    return [];
  }
}

function parseStoredRecord(line: string): McpCallRecord | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) return null;
    if (typeof value["id"] !== "string" || typeof value["at"] !== "string") return null;
    if (typeof value["method"] !== "string" || typeof value["ok"] !== "boolean") return null;
    if (typeof value["durationMs"] !== "number") return null;
    const storedLabels = Array.isArray(value["labels"])
      ? normalizeLabels(
          value["labels"].filter((label): label is string => typeof label === "string"),
        )
      : [];
    return {
      id: value["id"],
      at: value["at"],
      callerAgentId: typeof value["callerAgentId"] === "string" ? value["callerAgentId"] : null,
      method: value["method"],
      tool: typeof value["tool"] === "string" ? value["tool"] : null,
      ok: value["ok"],
      error: typeof value["error"] === "string" ? value["error"] : null,
      durationMs: value["durationMs"],
      ...(typeof value["arguments"] === "string"
        ? { arguments: clipArguments(value["arguments"]) }
        : {}),
      ...(storedLabels.length > 0 ? { labels: storedLabels } : {}),
    };
  } catch {
    return null;
  }
}

async function readTail(filePath: string, maxBytes: number): Promise<string | null> {
  const info = await stat(filePath).catch(() => null);
  if (!info) return null;
  const start = Math.max(0, info.size - maxBytes);
  const length = info.size - start;
  const buffer = Buffer.alloc(length);
  const handle = await open(filePath, "r");
  try {
    await handle.read(buffer, 0, length, start);
  } finally {
    await handle.close();
  }
  const text = buffer.toString("utf8");
  if (start === 0) return text;
  const newline = text.indexOf("\n");
  return newline === -1 ? "" : text.slice(newline + 1);
}
