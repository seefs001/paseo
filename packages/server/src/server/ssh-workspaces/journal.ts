import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { SshOperation } from "@getpaseo/protocol/ssh-workspaces";

// Durable record of side-effect intents sent to SSH machines, one JSONL file per workspace.
// An intent is written before anything is sent; if that write fails nothing is sent. The
// last line for an operationId is its state. Operations that were admitted or sent when the
// daemon stopped become "unknown" on the next start: Paseo cannot prove they did not run.
//
// This is not exactly-once execution. It lets Paseo refuse to resend an operation id, show
// what is unresolved, and stop automatic side effects until a person decides.

export type SshOperationState = SshOperation["state"];

export interface SshOperationRecord extends SshOperation {
  fingerprint: string;
}

const TERMINAL: ReadonlySet<SshOperationState> = new Set([
  "completed",
  "not_sent",
  "unknown",
  "acknowledged",
]);

export class SshOperationJournal {
  private readonly dir: string;
  private readonly byWorkspace = new Map<string, Map<string, SshOperationRecord>>();
  private loaded = false;
  // Journals that could not be read. Side effects there are refused: a missing record could
  // let an operation id be sent again.
  private unreadable: string | null = null;
  private readonly unreadableWorkspaces = new Map<string, string>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(paseoHome: string) {
    this.dir = join(paseoHome, "ssh-operations");
  }

  async initialize(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    let files: string[] = [];
    try {
      files = await readdir(this.dir);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        this.unreadable = `SSH operation journal could not be read: ${String(error)}`;
      }
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const workspaceId = file.slice(0, -".jsonl".length);
      const records = new Map<string, SshOperationRecord>();
      let text = "";
      try {
        text = await readFile(join(this.dir, file), "utf8");
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") {
          this.unreadableWorkspaces.set(workspaceId, `could not read ${file}: ${String(error)}`);
        }
      }
      const lines = text.split("\n");
      // Only the last line may be torn by a crash; a bad line before it means lost records.
      const last = lines.findLastIndex((line) => line.trim().length > 0);
      lines.forEach((line, index) => {
        if (!line.trim()) return;
        try {
          const record = JSON.parse(line) as SshOperationRecord;
          records.set(record.operationId, record);
        } catch {
          if (index !== last) {
            this.unreadableWorkspaces.set(workspaceId, `${file} has a damaged line ${index + 1}`);
          }
        }
      });
      this.byWorkspace.set(workspaceId, records);
    }
    this.loaded = true;
    for (const [workspaceId, records] of this.byWorkspace) {
      for (const record of records.values()) {
        if (record.state === "admitted" || record.state === "sent") {
          await this.write(workspaceId, {
            ...record,
            state: "unknown",
            detail: "The daemon stopped before this operation reported a result.",
            at: new Date().toISOString(),
          });
        }
      }
    }
  }

  get(workspaceId: string, operationId: string): SshOperationRecord | null {
    return this.byWorkspace.get(workspaceId)?.get(operationId) ?? null;
  }

  list(workspaceId: string, limit = 100): SshOperation[] {
    const records = [...(this.byWorkspace.get(workspaceId)?.values() ?? [])];
    return records
      .slice(-limit)
      .toReversed()
      .map(({ fingerprint: _fingerprint, ...operation }) => operation);
  }

  unresolved(workspaceId: string): SshOperationRecord[] {
    return [...(this.byWorkspace.get(workspaceId)?.values() ?? [])].filter(
      (record) => record.state === "unknown",
    );
  }

  // Claims an operation id synchronously, then persists the intent. A concurrent request
  // with the same id sees the claim and never sends. If persisting fails the claim is
  // dropped and the caller must not send.
  async reserve(
    workspaceId: string,
    record: SshOperationRecord,
  ): Promise<{ reserved: true } | { reserved: false; existing: SshOperationRecord }> {
    if (!this.loaded) throw new Error("SSH operation journal is not ready");
    const problem = this.unreadable ?? this.unreadableWorkspaces.get(workspaceId);
    if (problem) throw new Error(`${problem}. Changes on the machine are refused.`);
    let records = this.byWorkspace.get(workspaceId);
    if (!records) {
      records = new Map();
      this.byWorkspace.set(workspaceId, records);
    }
    const existing = records.get(record.operationId);
    if (existing) return { reserved: false, existing };
    records.set(record.operationId, record);
    try {
      await this.write(workspaceId, record);
    } catch (error) {
      if (records.get(record.operationId) === record) records.delete(record.operationId);
      throw error;
    }
    return { reserved: true };
  }

  // A person confirmed these unknown outcomes. Each entry must still match the state and
  // timestamp the person saw; anything that moved on is skipped and returned as stale.
  async acknowledge(
    workspaceId: string,
    entries: ReadonlyArray<{ operationId: string; at: string }>,
    detail: string,
  ): Promise<{ acknowledged: string[]; stale: string[] }> {
    const acknowledged: string[] = [];
    const stale: string[] = [];
    for (const entry of entries) {
      const current = this.get(workspaceId, entry.operationId);
      if (!current || current.state !== "unknown" || current.at !== entry.at) {
        stale.push(entry.operationId);
        continue;
      }
      await this.write(workspaceId, { ...current, state: "acknowledged", detail, at: now() });
      acknowledged.push(entry.operationId);
    }
    return { acknowledged, stale };
  }

  markUnrecorded(workspaceId: string, operationId: string): void {
    const record = this.get(workspaceId, operationId);
    if (!record) return;
    this.byWorkspace.get(workspaceId)?.set(operationId, {
      ...record,
      state: "unknown",
      detail: "The result could not be recorded.",
      at: now(),
    });
  }

  isTerminal(state: SshOperationState): boolean {
    return TERMINAL.has(state);
  }

  // Appends the record before callers act on it. Throws when it cannot be persisted.
  write(workspaceId: string, record: SshOperationRecord): Promise<void> {
    if (!this.loaded) return Promise.reject(new Error("SSH operation journal is not ready"));
    const next = this.writes.then(() => this.append(workspaceId, record));
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async append(workspaceId: string, record: SshOperationRecord): Promise<void> {
    await appendFile(join(this.dir, `${workspaceId}.jsonl`), `${JSON.stringify(record)}\n`, {
      mode: 0o600,
    });
    let records = this.byWorkspace.get(workspaceId);
    if (!records) {
      records = new Map();
      this.byWorkspace.set(workspaceId, records);
    }
    records.set(record.operationId, record);
  }
}

function now(): string {
  return new Date().toISOString();
}
