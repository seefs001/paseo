import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SshMachineProblem, SshMachineTarget } from "@getpaseo/protocol/ssh-workspaces";

export interface SshConnectionFiles {
  // Daemon-managed known_hosts. The user's OpenSSH known_hosts stays read-only.
  knownHostsFile: string;
  controlDir: string;
}

export function sshConnectionFiles(paseoHome: string): SshConnectionFiles {
  // Unix socket paths are short (104 bytes on macOS), so control sockets live in tmp.
  const homeKey = createHash("sha256").update(paseoHome).digest("hex").slice(0, 12);
  return {
    knownHostsFile: join(paseoHome, "ssh", "known_hosts"),
    // macOS tmpdir() is too long for the 104-byte socket limit; /tmp is short on POSIX.
    controlDir: join(
      process.platform === "win32" ? tmpdir() : "/tmp",
      `paseo-ssh-${process.getuid?.() ?? "u"}-${homeKey}`,
    ),
  };
}

export async function ensureSshConnectionDirs(files: SshConnectionFiles): Promise<void> {
  await mkdir(join(files.knownHostsFile, ".."), { recursive: true, mode: 0o700 });
  await mkdir(files.controlDir, { recursive: true, mode: 0o700 });
}

const HOST_PATTERN = /^[A-Za-z0-9_.:%[\]-]+$/;
const USER_PATTERN = /^[A-Za-z0-9_.@-]+$/;

export function validateSshTarget(target: SshMachineTarget): string | null {
  const host = target.host.trim();
  if (!host) return "SSH host is required";
  if (host.startsWith("-") || !HOST_PATTERN.test(host)) {
    return "SSH host must be an OpenSSH alias or hostname, not a command";
  }
  if (target.user != null && (target.user.startsWith("-") || !USER_PATTERN.test(target.user))) {
    return "SSH user contains unsupported characters";
  }
  if (target.port != null && (target.port < 1 || target.port > 65535)) {
    return "SSH port must be between 1 and 65535";
  }
  return null;
}

function quoteSshOption(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

// argv prefix up to and including the destination. Callers append the remote command.
export function buildSshArgv(target: SshMachineTarget, files: SshConnectionFiles): string[] {
  const argv = [
    "ssh",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${quoteSshOption(files.knownHostsFile)} ~/.ssh/known_hosts ~/.ssh/known_hosts2`,
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${quoteSshOption(join(files.controlDir, "%C"))}`,
    "-o",
    "ControlPersist=120",
  ];
  if (target.port != null) argv.push("-p", String(target.port));
  if (target.user) argv.push("-l", target.user);
  argv.push("--", target.host.trim());
  return argv;
}

// The login shell may be fish or another non-POSIX shell. The remote command line uses
// only base64 characters inside single quotes, which every common shell keeps literal.
export function wrapRemoteScript(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return `/bin/sh -c 'eval "$(printf %s ${encoded} | (base64 -d 2>/dev/null || base64 -D))"'`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class SshTransportError extends Error {
  constructor(
    readonly problem: SshMachineProblem,
    message: string,
  ) {
    super(message);
    this.name = "SshTransportError";
  }
}

// OpenSSH reports its own failures with exit status 255. Anything else came from the remote.
export function classifySshFailure(stderr: string): SshMachineProblem {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(stderr)) {
    return "host_key_changed";
  }
  if (/Host key verification failed|No .*host key is known/i.test(stderr)) {
    return "host_key_unknown";
  }
  if (/Permission denied|Too many authentication failures|agent refused/i.test(stderr)) {
    return "auth_failed";
  }
  if (
    /Could not resolve hostname|Connection refused|timed out|No route to host|Network is unreachable|Connection closed|Connection reset/i.test(
      stderr,
    )
  ) {
    return "unreachable";
  }
  return "failed";
}

export function errorFromSpawn(error: unknown): SshTransportError {
  if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") {
    return new SshTransportError(
      "ssh_missing",
      "OpenSSH client (ssh) is not available to the daemon",
    );
  }
  return new SshTransportError("failed", error instanceof Error ? error.message : String(error));
}

// Lexical POSIX normalization for remote paths. Symlinks are not resolved, so a link
// retarget never silently migrates a workspace identity. Paths are taken byte for byte:
// file names may end in spaces or newlines. Trim user-typed directories before calling.
export function normalizeRemotePath(input: string, home: string, base?: string): string {
  let value = input;
  if (value === "~") value = home;
  else if (value.startsWith("~/")) value = `${home}/${value.slice(2)}`;
  if (!value.startsWith("/")) {
    if (!base) throw new Error("Remote path must be absolute or start with ~");
    value = `${base}/${value}`;
  }
  const parts: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

// OpenSSH problems that happen before the remote side runs anything.
// Only messages the OpenSSH client itself prints before a session exists. Remote commands
// can print "Permission denied" too, so the generic classifier is not evidence here.
export function isPreExecutionFailure(stderr: string): boolean {
  return stderr
    .split("\n")
    .some(
      (line) =>
        /^ssh: (Could not resolve hostname|connect to host .* port \d+: )/.test(line) ||
        /Permission denied \((publickey|password|keyboard-interactive|gssapi-[a-z-]+|hostbased)[^)]*\)\.?\s*$/.test(
          line,
        ) ||
        /^Host key verification failed\.?$/.test(line) ||
        /REMOTE HOST IDENTIFICATION HAS CHANGED/.test(line),
    );
}
