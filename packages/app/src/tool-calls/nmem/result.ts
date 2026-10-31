import { z } from "zod";

const OptionalText = z.string().nullish();
const OptionalNumber = z.number().nullish();

const MemorySchema = z.object({
  id: z.string(),
  title: OptionalText,
  content: OptionalText,
  score: OptionalNumber,
  importance: OptionalNumber,
  unit_type: OptionalText,
  labels: z.array(z.string()).nullish(),
  source: OptionalText,
  created_at: OptionalText,
});

const MemoriesSchema = z.object({
  query: OptionalText,
  total: OptionalNumber,
  search_mode: OptionalText,
  memories: z.array(MemorySchema),
});

const ThreadSchema = z.object({
  id: z.string(),
  title: OptionalText,
  message_count: OptionalNumber,
  matches: OptionalNumber,
  source: OptionalText,
});

const ThreadsSchema = z.object({
  query: OptionalText,
  total: OptionalNumber,
  threads: z.array(ThreadSchema),
});

const MessageSchema = z.object({
  id: z.string(),
  index: OptionalNumber,
  role: z.string(),
  content: OptionalText,
  timestamp: OptionalText,
});

const ThreadDetailSchema = z.object({
  id: z.string(),
  title: OptionalText,
  source: OptionalText,
  created_at: OptionalText,
  total_messages: OptionalNumber,
  messages: z.array(MessageSchema),
});

const EntrySchema = z.object({
  path: z.string(),
  name: OptionalText,
  title: OptionalText,
  kind: OptionalText,
  type: OptionalText,
  updated_at: OptionalText,
});

const EntriesSchema = z.object({
  entries: z.array(EntrySchema),
  next_cursor: OptionalText,
  total_estimate: OptionalNumber,
});

const RangeSchema = z.object({
  start_line: z.number(),
  end_line: z.number(),
  total_lines: OptionalNumber,
});

const FileSchema = z.object({
  path: z.string(),
  body: z.string(),
  content_type: OptionalText,
  frontmatter: z.record(z.string(), z.unknown()).nullish(),
  range: RangeSchema.nullish(),
});

const StatsSchema = z.object({
  memories: z.number(),
  threads: z.number(),
  entities: z.number(),
  labels: z.number(),
  communities: z.number(),
});

export type NmemMemory = z.infer<typeof MemorySchema>;
export type NmemMemories = z.infer<typeof MemoriesSchema>;
export type NmemThreads = z.infer<typeof ThreadsSchema>;
export type NmemThreadMessage = z.infer<typeof MessageSchema>;
export type NmemThread = z.infer<typeof ThreadDetailSchema>;
export type NmemEntries = z.infer<typeof EntriesSchema>;
export type NmemFileRange = z.infer<typeof RangeSchema>;
export type NmemStats = z.infer<typeof StatsSchema>;

/** A row of the plain-text search table. The CLI shortens titles and sources and omits content. */
export interface NmemMemoryTableRow {
  id: string;
  title: string;
  score: string | null;
  type: string | null;
  source: string | null;
  age: string | null;
  importance: string | null;
}

export interface NmemMemoryTable {
  query: string | null;
  rows: NmemMemoryTableRow[];
}

export interface NmemField {
  key: string;
  value: string;
}

export interface NmemFile {
  path: string;
  title: string | null;
  contentType: string | null;
  /** The body without the YAML block that `frontmatter` already carries. */
  body: string;
  labels: string[];
  range: NmemFileRange | null;
  frontmatter: NmemField[];
}

export type NmemResult =
  | { kind: "memories"; memories: NmemMemories }
  | { kind: "memory"; memory: NmemMemory }
  | { kind: "memoryTable"; table: NmemMemoryTable }
  | { kind: "threads"; threads: NmemThreads }
  | { kind: "thread"; thread: NmemThread }
  | { kind: "entries"; entries: NmemEntries }
  | { kind: "file"; file: NmemFile }
  | { kind: "stats"; stats: NmemStats };

/**
 * Reads the output nmem returned for one call. Returns null for anything that is not a complete,
 * recognized result, so the caller shows the original text instead of a partial reading of it.
 */
export function parseNmemResult(output: string): NmemResult | null {
  const json = parseJson(output);
  if (json !== undefined) return isRecord(json) ? parseJsonResult(json) : null;
  return parseMemoryTable(output) ?? parseMemoryText(output);
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonResult(value: Record<string, unknown>): NmemResult | null {
  if (Array.isArray(value.memories)) {
    const parsed = MemoriesSchema.safeParse(value);
    return parsed.success ? { kind: "memories", memories: parsed.data } : null;
  }
  if (Array.isArray(value.threads)) {
    const parsed = ThreadsSchema.safeParse(value);
    return parsed.success ? { kind: "threads", threads: parsed.data } : null;
  }
  if (Array.isArray(value.messages)) {
    const parsed = ThreadDetailSchema.safeParse(value);
    return parsed.success ? { kind: "thread", thread: parsed.data } : null;
  }
  if (Array.isArray(value.entries)) {
    const parsed = EntriesSchema.safeParse(value);
    return parsed.success ? { kind: "entries", entries: parsed.data } : null;
  }
  if (typeof value.body === "string") {
    const parsed = FileSchema.safeParse(value);
    return parsed.success ? { kind: "file", file: toFile(parsed.data) } : null;
  }
  if (typeof value.content === "string") {
    const parsed = MemorySchema.safeParse(value);
    return parsed.success ? { kind: "memory", memory: parsed.data } : null;
  }
  const stats = StatsSchema.safeParse(value);
  return stats.success ? { kind: "stats", stats: stats.data } : null;
}

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

function toFile(file: z.infer<typeof FileSchema>): NmemFile {
  const frontmatter = file.frontmatter ?? null;
  const title = typeof frontmatter?.title === "string" ? frontmatter.title : null;
  const labels = frontmatter?.labels;
  const stringLabels = Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : [];
  const body = frontmatter ? file.body.replace(FRONTMATTER_BLOCK, "") : file.body;
  return {
    path: file.path,
    title,
    contentType: file.content_type ?? null,
    body: body.replace(/^\s*\n/, ""),
    labels: stringLabels,
    range: file.range ?? null,
    frontmatter: frontmatter ? frontmatterFields(frontmatter) : [],
  };
}

function frontmatterFields(frontmatter: Record<string, unknown>): NmemField[] {
  return Object.entries(frontmatter).flatMap(([key, value]) => {
    const text = fieldText(value);
    return text ? [{ key, value: text }] : [];
  });
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const TABLE_SUMMARY = /^Found (\d+) match(?:es)? for (.+)$/m;
const TABLE_CELL_GAP = /\s{2,}/;

function parseMemoryTable(output: string): NmemResult | null {
  const lines = output.split("\n").filter((line) => line.startsWith("│"));
  const [header, ...rows] = lines.map(tableCells);
  if (!header?.includes("ID") || !header.includes("TITLE")) return null;
  if (rows.some((row) => row.length !== header.length)) return null;
  const records = rows.map((row) => tableRecord(header, row));
  const summary = TABLE_SUMMARY.exec(output);
  return {
    kind: "memoryTable",
    table: { query: summary ? summary[2].trim() : null, rows: records },
  };
}

function tableCells(line: string): string[] {
  return line
    .replace(/^│|│\s*$/g, "")
    .trim()
    .split(TABLE_CELL_GAP);
}

function tableRecord(header: string[], row: string[]): NmemMemoryTableRow {
  const cells = new Map(header.map((column, index) => [column, row[index]]));
  return {
    id: cells.get("ID") ?? "",
    title: cells.get("TITLE") ?? "",
    score: cells.get("SCORE") ?? null,
    type: cells.get("TYPE") ?? null,
    source: cells.get("SOURCE") ?? null,
    age: cells.get("AGE") ?? null,
    importance: cells.get("IMP") ?? null,
  };
}

const TEXT_FIELD_LINE = /^[A-Z][A-Za-z]*: /;
const TEXT_FIELD_GAP = /\s{2,}(?=[A-Z][A-Za-z]*: )/;

/** The plain-text `m show` layout: a title, `Key: value` header lines, a blank line, then the content. */
function parseMemoryText(output: string): NmemResult | null {
  const [title, ...lines] = output.trim().split("\n");
  if (!title || !lines[0]?.startsWith("ID: ")) return null;
  const fields = new Map<string, string>();
  let bodyStart = 0;
  while (bodyStart < lines.length && TEXT_FIELD_LINE.test(lines[bodyStart])) {
    for (const part of lines[bodyStart].split(TEXT_FIELD_GAP)) {
      const separator = part.indexOf(": ");
      fields.set(part.slice(0, separator), part.slice(separator + 2).trim());
    }
    bodyStart += 1;
  }
  const importance = Number(fields.get("Importance"));
  const memory: NmemMemory = {
    id: fields.get("ID") ?? "",
    title: title.trim(),
    content: lines.slice(bodyStart).join("\n").trim(),
    importance: Number.isFinite(importance) ? importance : null,
    unit_type: fields.get("Type") ?? null,
    labels: fields.get("Labels")?.split(/,\s*/) ?? null,
    source: fields.get("Source") ?? null,
    created_at: fields.get("Date") ?? null,
  };
  return { kind: "memory", memory };
}
