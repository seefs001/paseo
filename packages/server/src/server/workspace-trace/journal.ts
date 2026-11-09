import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

export const TraceParticipantSchema = z.object({
  serverId: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
});
export type TraceParticipant = z.infer<typeof TraceParticipantSchema>;

const common = {
  id: z.string(),
  at: z.string(),
  instanceId: z.string(),
  retentionBoundary: z.boolean().optional(),
};
const TraceRecordSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("delegation"),
    source: TraceParticipantSchema,
    target: TraceParticipantSchema,
    sourceTurnId: z.string().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("message"),
    source: TraceParticipantSchema,
    target: TraceParticipantSchema,
    messageId: z.string(),
    requestedBehavior: z.enum(["steer", "interrupt"]),
    sourceTurnId: z.string().optional(),
    notificationEvent: z.enum(["finished", "errored", "permission-required", "closed"]).optional(),
    subscriptionIds: z.array(z.string()).optional(),
    triggerMessageIds: z.array(z.string()).optional(),
    triggerCreationAgentIds: z.array(z.string()).optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("dispatch"),
    target: TraceParticipantSchema,
    messageIds: z.array(z.string()),
    status: z.enum(["dispatched", "failed"]),
    behavior: z.enum(["started", "steered", "interrupted", "out_of_band"]).optional(),
  }),
]);
export type TraceRecord = z.infer<typeof TraceRecordSchema>;
type NewRecord<T> = T extends TraceRecord ? Omit<T, keyof typeof common> : never;
export type TraceRecordInput = NewRecord<TraceRecord>;
interface Segment {
  records: TraceRecord[];
  bytes: number;
  exists: boolean;
}
const SEGMENT_BYTES = 2 * 1024 * 1024;

/** Two bounded segments. Admission stays synchronous; reads and shutdown drain the writer. */
export class TraceJournal {
  readonly instanceId = randomUUID();
  private previous: TraceRecord[] = [];
  private current: TraceRecord[] = [];
  private bytes = 0;
  private writing: Promise<void>;
  truncated = false;
  incomplete = false;

  constructor(
    private readonly file: string,
    private readonly logger: Logger,
  ) {
    this.writing = this.load().catch((error) => this.recordFailure(error));
  }

  async records(): Promise<readonly TraceRecord[]> {
    await this.flush();
    return [...this.previous, ...this.current];
  }

  flush(): Promise<void> {
    return this.writing;
  }

  append(input: TraceRecordInput, id: string = randomUUID()): void {
    const record = { ...input, id, at: new Date().toISOString(), instanceId: this.instanceId };
    this.writing = this.writing
      .then(() => this.write(record))
      .catch((error) => this.recordFailure(error));
  }

  private async write(record: TraceRecord): Promise<void> {
    let line = `${JSON.stringify(record)}\n`;
    let bytes = Buffer.byteLength(line);
    // Leave room for the persisted coverage flag when this write rotates a segment.
    if (bytes > SEGMENT_BYTES - 64)
      throw new Error("Workspace Trace record exceeds segment budget");
    if (this.bytes + bytes + 64 > SEGMENT_BYTES) {
      await rename(this.file, `${this.file}.previous`);
      this.truncated ||= this.previous.length > 0;
      this.previous = this.current;
      this.current = [];
      this.bytes = 0;
    }
    if (this.truncated) {
      record.retentionBoundary = true;
      line = `${JSON.stringify(record)}\n`;
      bytes = Buffer.byteLength(line);
    }
    await appendFile(this.file, line, { mode: 0o600 });
    this.bytes += bytes;
    this.current.push(record);
  }

  private recordFailure(error: unknown): void {
    // Observability cannot change admission or provider-dispatch semantics.
    this.incomplete = true;
    this.logger.error({ err: error }, "Workspace Trace recording failed");
  }

  private async load(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const previous = await this.read(`${this.file}.previous`);
    const current = await this.read(this.file);
    this.previous = previous.records;
    this.current = current.records;
    this.bytes = current.bytes;
    this.truncated = [...previous.records, ...current.records].some(
      (record) => record.retentionBoundary,
    );
  }

  private async read(file: string): Promise<Segment> {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { records: [], bytes: 0, exists: false };
      throw error;
    }
    const records: TraceRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line) continue;
      try {
        records.push(TraceRecordSchema.parse(JSON.parse(line)));
      } catch {
        this.incomplete = true;
      }
    }
    // A torn final write must not swallow the next complete record.
    if (content && !content.endsWith("\n")) {
      await appendFile(file, "\n");
      content += "\n";
    }
    return { records, bytes: Buffer.byteLength(content), exists: true };
  }
}
