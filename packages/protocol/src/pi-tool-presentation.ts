import { z } from "zod";
import { stripCwdPrefix } from "./path-utils.js";

const SummaryPartSchema = z.object({
  kind: z.enum(["text", "path"]),
  value: z.string(),
});
const SummarySchema = z.array(SummaryPartSchema);
type SummaryPart = z.infer<typeof SummaryPartSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function textPart(value: string | undefined): SummaryPart[] {
  return value ? [{ kind: "text", value }] : [];
}

function pathPart(value: unknown): SummaryPart[] {
  const path = text(value);
  return path ? [{ kind: "path", value: path }] : [];
}

function countPart(value: unknown, label: string): SummaryPart[] {
  const count = positive(value);
  return count === undefined ? [] : textPart(`${label} ${count}`);
}

function textList(value: unknown): SummaryPart[] {
  if (!Array.isArray(value)) return textPart(text(value));
  const values = value.flatMap((entry) => textPart(text(entry)));
  if (values.length <= 3) return values;
  return [...values.slice(0, 3), ...textPart(`+${values.length - 3} more`)];
}

function lineRange(args: Record<string, unknown>): SummaryPart[] {
  const offset = positive(args.offset);
  const limit = positive(args.limit);
  if (limit === undefined) return offset ? textPart(`from line ${offset}`) : [];
  const start = offset ?? 1;
  const label = limit === 1 ? `line ${start}` : `lines ${start}–${start + limit - 1}`;
  return textPart(label);
}

function fileSummary(name: string, args: Record<string, unknown>): SummaryPart[] {
  const path = pathPart(args.path);
  if (path.length === 0) return [];
  if (name === "read") return [...path, ...lineRange(args)];
  if (name === "edit" && Array.isArray(args.edits)) {
    const count = args.edits.length;
    const label = count === 1 ? "1 edit" : `${count} edits`;
    return [...path, ...textPart(label)];
  }
  if (name === "write" && typeof args.content === "string") {
    const content = args.content.replace(/\n$/, "");
    const count = args.content.length === 0 ? 0 : content.split("\n").length;
    const label = count === 1 ? "1 line" : `${count} lines`;
    return [...path, ...textPart(label)];
  }
  return path;
}

function searchSummary(args: Record<string, unknown>): SummaryPart[] {
  const query = text(args.pattern);
  if (!query) return [];
  return [
    ...textPart(query),
    ...pathPart(args.path),
    ...textPart(text(args.glob)),
    ...textPart(args.ignoreCase === true ? "ignore case" : undefined),
    ...textPart(args.literal === true ? "literal" : undefined),
    ...countPart(args.context, "context"),
    ...countPart(args.limit, "limit"),
  ];
}

function storedContentSummary(args: Record<string, unknown>): SummaryPart[] {
  const target = text(args.url) ?? text(args.query) ?? text(args.responseId);
  if (!target) return [];
  const parts = textPart(target);
  const find = textList(args.findText);
  if (find.length > 0) return [...parts, ...textPart("find"), ...find];
  const offset = positive(args.offset) ?? 0;
  const limit = positive(args.limit);
  if (limit !== undefined) return [...parts, ...textPart(`chars ${offset}–${offset + limit - 1}`)];
  return [...parts, ...countPart(args.offset, "char offset")];
}

function webSearchSummary(args: Record<string, unknown>): SummaryPart[] {
  const queries = textList(args.queries ?? args.query);
  if (queries.length === 0) return [];
  const count = positive(args.numResults);
  const label = count === undefined ? undefined : `${count} results`;
  return [...queries, ...textPart(label)];
}

function summaryParts(name: string, args: Record<string, unknown>): SummaryPart[] {
  switch (name) {
    case "read":
    case "edit":
    case "write":
      return fileSummary(name, args);
    case "bash": {
      const command = text(args.command);
      if (!command) return [];
      const timeout = positive(args.timeout);
      const label = timeout === undefined ? undefined : `timeout ${timeout}s`;
      return [...textPart(command), ...textPart(label)];
    }
    case "find":
    case "grep":
      return searchSummary(args);
    case "ls":
      return [...pathPart(args.path ?? "."), ...countPart(args.limit, "limit")];
    case "tool_search": {
      const query = text(args.query);
      return query ? [...textPart(query), ...countPart(args.limit, "limit")] : [];
    }
    case "web_search":
      return webSearchSummary(args);
    case "fetch_content":
      return textList(args.urls ?? args.url);
    case "get_search_content":
      return storedContentSummary(args);
    case "source_check":
      return textPart(text(args.claim));
    default:
      return [];
  }
}

/** Keep known display parameters separate from detail so old clients can ignore the metadata. */
export function buildPiToolCallMetadata(name: string, input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {};
  const parts = summaryParts(name, input);
  for (const part of parts) {
    if (part.kind === "path") continue;
    const value = part.value.replace(/\s+/g, " ").trim();
    part.value = value.length > 240 ? `${value.slice(0, 239)}…` : value;
  }
  return parts.length > 0 ? { piToolSummary: parts } : {};
}

export function getPiToolCallSummary(
  metadata: Record<string, unknown> | undefined,
  cwd: string | undefined,
): string | undefined {
  const parsed = SummarySchema.safeParse(metadata?.piToolSummary);
  if (!parsed.success) return undefined;
  const parts = parsed.data.map((part) => {
    const value = part.kind === "path" ? stripCwdPrefix(part.value, cwd) : part.value;
    return value.replace(/\s+/g, " ").trim();
  });
  return parts.filter(Boolean).join(" · ") || undefined;
}
