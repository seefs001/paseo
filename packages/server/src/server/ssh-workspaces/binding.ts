import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { z } from "zod";

// Each SSH workspace owns an owner-side directory:
//   <root>/<workspaceId>/session   Pi process cwd and the workspace record's cwd
//   <root>/<workspaceId>/binding.json   execution binding written by the daemon
// The root lives under the system tmp directory so no ancestor carries AGENTS.md or
// .pi project config into the remote session. The daemon recreates it on startup.
const SSH_SESSION_ROOT = join(tmpdir(), "paseo-ssh-workspaces");

// The binding names the daemon bridge and a token; the daemon decides every call from its
// current state, so a stale binding can only make a session fail, never widen it.
export const SshExecutionBindingSchema = z.object({
  version: z.literal(2),
  workspaceId: z.string(),
  machineDisplayName: z.string(),
  directory: z.string(),
  socketPath: z.string(),
  token: z.string(),
});
export type SshExecutionBinding = z.infer<typeof SshExecutionBindingSchema>;

export function sshSessionDirectory(paseoHomeKey: string, workspaceId: string): string {
  return join(SSH_SESSION_ROOT, paseoHomeKey, workspaceId, "session");
}

export function sshBindingFileForSessionDirectory(sessionDirectory: string): string {
  return join(dirname(sessionDirectory), "binding.json");
}

export function isSshSessionDirectory(cwd: string): boolean {
  return cwd.startsWith(`${SSH_SESSION_ROOT}${sep}`) && basename(cwd) === "session";
}

export async function writeSshExecutionBinding(
  sessionDirectory: string,
  binding: SshExecutionBinding,
): Promise<void> {
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const file = sshBindingFileForSessionDirectory(sessionDirectory);
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// Fails closed: a session directory without a valid binding cannot start an agent.
export async function readSshExecutionBinding(
  sessionDirectory: string,
): Promise<SshExecutionBinding> {
  const file = sshBindingFileForSessionDirectory(sessionDirectory);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `SSH workspace binding is missing for ${sessionDirectory}; the daemon must restore it before agents can run`,
    );
  }
  return SshExecutionBindingSchema.parse(JSON.parse(raw));
}

// Interactive terminals are not available for SSH workspaces yet. Opening one in the
// owner-side session directory would look like a remote shell while running locally.
export function assertNotSshSessionDirectory(cwd: string): void {
  if (isSshLocalOnlyPath(cwd)) {
    throw new Error(
      "Terminals are not available in SSH workspaces yet; ask the agent to run commands",
    );
  }
}

// Directory identity for SSH workspaces on the wire. Not a local path: local-only RPCs that
// receive it fail instead of touching an owner directory with the same name.
export const SSH_DIRECTORY_KEY_PREFIX = "ssh://";

export function sshDirectoryKey(machineId: string, directory: string): string {
  return `${SSH_DIRECTORY_KEY_PREFIX}${machineId}${directory}`;
}

export function isSshLocalOnlyPath(value: string): boolean {
  return value.startsWith(SSH_DIRECTORY_KEY_PREFIX) || isWithinSshSessionRoot(value);
}

function isWithinSshSessionRoot(value: string): boolean {
  return value === SSH_SESSION_ROOT || value.startsWith(`${SSH_SESSION_ROOT}${sep}`);
}

const PATH_KEYS = new Set([
  "cwd",
  "path",
  "paths",
  "root",
  "rootPath",
  "repoRoot",
  "workspaceRoot",
  "worktreePath",
  "directory",
  "sourceCwd",
]);

// Path-like fields of a request, one level deep plus nested source/config/filter objects.
export function collectRequestPaths(message: Record<string, unknown>): string[] {
  const found: string[] = [];
  const visit = (value: Record<string, unknown>, depth: number) => {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" && PATH_KEYS.has(key)) found.push(entry);
      else if (Array.isArray(entry) && PATH_KEYS.has(key)) {
        for (const item of entry) if (typeof item === "string") found.push(item);
      } else if (entry && typeof entry === "object" && !Array.isArray(entry) && depth < 2) {
        visit(entry as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(message, 0);
  return found;
}
