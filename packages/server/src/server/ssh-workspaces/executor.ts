import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { errorFromSpawn, isPreExecutionFailure, wrapRemoteScript } from "./transport.js";

// The one place that runs anything on an SSH machine. Every caller (Pi tools, user shell,
// file browser, probes) gets the same facts back: whether the remote script reported an
// exit status, whether it is known not to have run, or whether the outcome is unknown.
//
// A script reports through a per-run trailer on stderr: \x1ePASEO-EXIT-<nonce>:<code>\x1e.
// Its stdout and the rest of stderr belong to the command. Without the trailer the run did
// not complete as far as Paseo can prove, regardless of the ssh exit status.

export type RemoteOutcome =
  // The script ran to its end and reported its exit status.
  | { kind: "completed"; exitCode: number }
  // Nothing ran on the machine: aborted before spawn, or OpenSSH failed before executing.
  | { kind: "not_sent"; reason: string }
  // The script may have run, partly or fully. Paseo does not retry.
  | { kind: "unknown"; reason: string };

export interface RemoteRunResult {
  outcome: RemoteOutcome;
  stdout: Buffer;
  stderr: string;
}

export interface RemoteRunOptions {
  stdin?: Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  // Streams command output instead of buffering it. Trailers are removed.
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  // Called once the ssh process exists, i.e. the request may have reached the machine.
  onSent?: () => void;
}

const TRAILER_PREFIX = "\u001ePASEO-EXIT-";

export function runRemote(
  sshArgv: readonly string[],
  script: string,
  options: RemoteRunOptions = {},
): Promise<RemoteRunResult> {
  if (options.signal?.aborted) {
    return Promise.resolve({
      outcome: { kind: "not_sent", reason: "aborted before sending" },
      stdout: Buffer.alloc(0),
      stderr: "",
    });
  }
  const nonce = randomBytes(8).toString("hex");
  const trailer = `${TRAILER_PREFIX}${nonce}:`;
  // Printed first on both streams. Stdout before it (login banners, rc output) is dropped.
  // Without a marker, execution is unproven, not necessarily absent.
  const start = `\u001ePASEO-START-${nonce}\u001e`;
  const startBytes = Buffer.from(start, "utf8");
  // stdin stays attached only for scripts that read their input (file writes).
  const body = [
    `printf '\\036PASEO-START-${nonce}\\036'`,
    `printf '\\036PASEO-START-${nonce}\\036' >&2`,
    `( ${script}`,
    `)${options.stdin ? "" : " </dev/null"}`,
    "__paseo_rc=$?",
    `printf '${trailer}%s\\036' "$__paseo_rc" >&2`,
    'exit "$__paseo_rc"',
    "",
  ].join("\n");
  const [command, ...args] = sshArgv;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command!, [...args, wrapRemoteScript(body)], {
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return Promise.resolve({
      outcome: { kind: "not_sent", reason: errorFromSpawn(error).message },
      stdout: Buffer.alloc(0),
      stderr: "",
    });
  }
  return new Promise((resolve) => {
    let spawned = false;
    child.once("spawn", () => {
      spawned = true;
      options.onSent?.();
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let overflow = false;
    let stderrText = "";
    let pendingStderr = "";
    let exitCode: number | null = null;
    let aborted = false;
    let timedOut = false;
    const kill = () => child.kill("SIGTERM");
    const onAbort = () => {
      aborted = true;
      kill();
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, options.timeoutMs)
      : undefined;
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let stdoutStarted = false;
    let stderrStarted = false;
    let preStdout = Buffer.alloc(0);
    child.stdout?.on("data", (raw: Buffer) => {
      let data = raw;
      if (!stdoutStarted) {
        preStdout = Buffer.concat([preStdout, raw]);
        const at = preStdout.indexOf(startBytes);
        if (at < 0) {
          // Keep only a tail that could still contain the marker.
          if (preStdout.length > 1_048_576) preStdout = preStdout.subarray(-startBytes.length);
          return;
        }
        stdoutStarted = true;
        data = preStdout.subarray(at + startBytes.length);
        preStdout = Buffer.alloc(0);
        if (data.length === 0) return;
      }
      stdoutBytes += data.length;
      if (options.maxStdoutBytes && stdoutBytes > options.maxStdoutBytes) {
        overflow = true;
        kill();
        return;
      }
      if (options.onStdout) options.onStdout(data);
      else chunks.push(data);
    });
    // The stream decoder joins split UTF-8 bytes and flushes before the child's close event.
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (data: string) => {
      pendingStderr += data;
      if (!stderrStarted) {
        const at = pendingStderr.indexOf(start);
        if (at < 0) {
          const hold = pendingStderr.lastIndexOf("\u001e");
          if (hold >= 0 && pendingStderr.length - hold < start.length) {
            emitStderr(pendingStderr.slice(0, hold));
            pendingStderr = pendingStderr.slice(hold);
          } else {
            emitStderr(pendingStderr);
            pendingStderr = "";
          }
          return;
        }
        stderrStarted = true;
        emitStderr(pendingStderr.slice(0, at));
        pendingStderr = pendingStderr.slice(at + start.length);
      }
      const index = pendingStderr.indexOf(trailer);
      if (index >= 0) {
        const end = pendingStderr.indexOf("\u001e", index + trailer.length);
        if (end >= 0) {
          exitCode = Number(pendingStderr.slice(index + trailer.length, end));
          emitStderr(pendingStderr.slice(0, index) + pendingStderr.slice(end + 1));
          pendingStderr = "";
          return;
        }
        emitStderr(pendingStderr.slice(0, index));
        pendingStderr = pendingStderr.slice(index);
        return;
      }
      // Hold back a suffix that could be the start of the trailer.
      const hold = pendingStderr.lastIndexOf("\u001e");
      if (hold >= 0 && pendingStderr.length - hold < trailer.length + 8) {
        emitStderr(pendingStderr.slice(0, hold));
        pendingStderr = pendingStderr.slice(hold);
      } else {
        emitStderr(pendingStderr);
        pendingStderr = "";
      }
    });
    function emitStderr(text: string) {
      if (!text) return;
      if (stderrText.length < 65_536) stderrText += text;
      options.onStderr?.(Buffer.from(text, "utf8"));
    }
    let settled = false;
    // `error` and `close` can both fire for one child.
    const finish = (sshStatus: number | null, spawnError?: unknown) => {
      if (settled) return;
      settled = true;
      resolve(settle(sshStatus, spawnError));
    };
    const settle = (sshStatus: number | null, spawnError?: unknown): RemoteRunResult => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (pendingStderr && exitCode === null) emitStderr(pendingStderr);
      const stdout = Buffer.concat(chunks);
      let outcome: RemoteOutcome;
      if (exitCode !== null && Number.isInteger(exitCode) && !overflow) {
        outcome = { kind: "completed", exitCode };
      } else if (spawnError || !spawned) {
        outcome = {
          kind: "not_sent",
          reason: spawnError ? errorFromSpawn(spawnError).message : "ssh did not start",
        };
      } else if (
        sshStatus === 255 &&
        !stderrStarted &&
        !stdoutStarted &&
        preStdout.length === 0 &&
        isPreExecutionFailure(stderrText)
      ) {
        outcome = { kind: "not_sent", reason: firstLine(stderrText) };
      } else if (aborted) {
        outcome = {
          kind: "unknown",
          reason:
            "Stop requested; the SSH session was closed. Whether remote processes exited is unknown.",
        };
      } else if (timedOut) {
        outcome = { kind: "unknown", reason: "Timed out; the SSH session was closed." };
      } else if (overflow) {
        outcome = {
          kind: "unknown",
          reason: "Output exceeded the limit; the SSH session was closed.",
        };
      } else {
        outcome = {
          kind: "unknown",
          reason: firstLine(stderrText) || `SSH ended (status ${sshStatus}) without a result`,
        };
      }
      return { outcome, stdout, stderr: stderrText };
    };
    child.once("error", (error) => finish(null, error));
    child.once("close", (status) => finish(status));
    if (options.stdin && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }
  });
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("Warning: Permanently added")) ?? ""
  );
}

// Throws unless the script completed; returns its exit code and output.
export class RemoteOutcomeError extends Error {
  constructor(readonly outcome: Exclude<RemoteOutcome, { kind: "completed" }>) {
    super(
      outcome.kind === "not_sent"
        ? `Not sent to the SSH machine: ${outcome.reason}`
        : `Outcome unknown: ${outcome.reason}`,
    );
    this.name = "RemoteOutcomeError";
  }
}

export function requireCompleted(result: RemoteRunResult): {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
} {
  if (result.outcome.kind !== "completed") throw new RemoteOutcomeError(result.outcome);
  return { exitCode: result.outcome.exitCode, stdout: result.stdout, stderr: result.stderr };
}
