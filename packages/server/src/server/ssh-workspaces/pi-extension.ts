import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PiSshExtensionFile {
  path: string;
  cleanup: () => void;
}

// Registered by the routing extension; the daemon checks for it after Pi starts. Pi keeps
// running when an extension fails to load, so a missing marker means tools would run locally.
export const PI_SSH_MARKER_COMMAND = "paseo-ssh-routing";

export async function createPiSshExtensionFile(input: {
  bindingFile: string;
  ownerCwd: string;
}): Promise<PiSshExtensionFile> {
  const dir = await mkdtemp(join(tmpdir(), "paseo-pi-ssh-"));
  const filePath = join(dir, "paseo-ssh-routing.mjs");
  await writeFile(filePath, buildPiSshExtensionSource({ ...input, extensionPath: filePath }), {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    path: filePath,
    cleanup: () => void rm(dir, { recursive: true, force: true }).catch(() => undefined),
  };
}

// The extension is a thin client of the daemon bridge. It never runs ssh itself: the daemon
// admits each call against its current state, records side-effect intents, executes, and
// reports the outcome (completed, not sent, unknown).
function buildPiSshExtensionSource(input: {
  bindingFile: string;
  ownerCwd: string;
  extensionPath: string;
}): string {
  const constants = JSON.stringify({
    bindingFile: input.bindingFile,
    ownerCwd: input.ownerCwd,
    extensionPath: input.extensionPath,
    marker: PI_SSH_MARKER_COMMAND,
    remoteTools: ["read", "write", "edit", "bash", "ls", "find", "grep"],
  });
  return `
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import nodePath from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createMcpExtension,
  createReadToolDefinition,
  createWriteToolDefinition,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const C = ${constants};
const posix = nodePath.posix;
const binding = JSON.parse(readFileSync(C.bindingFile, "utf8"));
if (binding.version !== 2 || typeof binding.token !== "string" || typeof binding.directory !== "string") {
  throw new Error("Invalid SSH workspace binding");
}
const DIR = binding.directory;
const NONCE = randomBytes(6).toString("hex");
let turnRevision = null;
let remoteHome = null;

// One request to the daemon bridge. Resolves with the final result line.
function call(route, body, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("aborted before sending"));
    const payload = Buffer.from(JSON.stringify({ ...body, token: binding.token }), "utf8");
    const req = http.request(
      { socketPath: binding.socketPath, path: route, method: "POST", headers: { "content-length": payload.length } },
      (res) => {
        let buffer = "";
        let result = null;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (!line) continue;
            const message = JSON.parse(line);
            if (message.type === "result") result = message;
            else options.onLine?.(message);
          }
        });
        res.on("end", () => (result ? resolve(result) : reject(new Error("Paseo bridge closed without a result; outcome unknown"))));
        res.on("error", reject);
      },
    );
    const onAbort = () => req.destroy(new Error("aborted"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => reject(options.signal?.aborted ? new Error("aborted") : error));
    req.on("close", () => options.signal?.removeEventListener("abort", onAbort));
    req.end(payload);
  });
}

function toRemote(path) {
  let value = String(path ?? ".");
  if (value.startsWith("@")) value = value.slice(1);
  if (value === "~" || value.startsWith("~/")) {
    if (!remoteHome) throw new Error("Remote home directory is unknown; use an absolute path");
    value = remoteHome + value.slice(1);
  }
  return posix.normalize(posix.isAbsolute(value) ? value : posix.join(DIR, value));
}

// Loaded Pi skills are owner resources: reads inside a loaded skill's directory come from
// the owner computer and writes there are refused.
let localSkills = true;
let skillRoots = [];
function refreshSkillRoots(promptOptions) {
  if (!localSkills) {
    skillRoots = [];
    return;
  }
  skillRoots = (promptOptions?.skills ?? [])
    .map((skill) => skill.baseDir)
    .filter((dir) => typeof dir === "string" && dir.length > 1)
    .map((dir) => {
      try {
        return realpathSync(dir);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
function ownerSkillPath(path) {
  if (skillRoots.length === 0 || typeof path !== "string" || !nodePath.isAbsolute(path)) return null;
  let real;
  try {
    real = realpathSync(path);
  } catch {
    return null;
  }
  return skillRoots.some((root) => real === root || real.startsWith(root + nodePath.sep)) ? real : null;
}

// Operations for one tool call. Every operation has its own id so the daemon can refuse to
// send the same one twice.
// \`signal\` is the tool call's own signal; every step honours it, so a stopped edit never
// reaches its write.
function remoteOperations(toolName, toolCallId, extra = {}, signal) {
  let seq = 0;
  const op = async (kind, fields, options = {}) => {
    seq += 1;
    const result = await call(
      "/op",
      { ...fields, kind, toolName, turnRevision, ...extra, operationId: NONCE + ":" + toolCallId + ":" + seq },
      { signal, ...options },
    );
    if (result.outcome !== "completed") {
      const error = new Error(result.error || "SSH operation " + result.outcome);
      error.outcome = result.outcome;
      throw error;
    }
    return result;
  };
  const ok = async (kind, fields) => {
    const result = await op(kind, fields);
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || "").trim() || kind + " failed with exit " + result.exitCode);
    }
    return Buffer.from(result.stdout || "", "base64");
  };
  return {
    readFile: (p) => ok("read", { path: p }),
    access: (p) => ok("access", { path: p }).then(() => undefined),
    accessWrite: (p) => ok("access", { path: p, write: true }).then(() => undefined),
    writeFile: (p, content) => ok("write", { path: p, content: Buffer.from(content, "utf8").toString("base64") }).then(() => undefined),
    mkdir: (p) => ok("mkdir", { path: p }).then(() => undefined),
    exists: async (p) => (await op("exists", { path: p })).exitCode === 0,
    stat: async (p) => {
      const result = await op("stat", { path: p });
      if (result.exitCode !== 0) throw new Error("not found: " + p);
      const kind = Buffer.from(result.stdout || "", "base64").toString("utf8").trim();
      return { isDirectory: () => kind === "d" };
    },
    readdir: async (p) => (await ok("readdir", { path: p })).toString("utf8").split("\\0").filter(Boolean),
    find: async (cwd) => (await ok("find", { path: cwd })).toString("utf8").split("\\0").filter(Boolean),
    grep: async (path, pattern, flags, signal) => {
      const result = await op("grep", { path, pattern, flags }, { signal });
      if (result.exitCode === 1) return "";
      if (result.exitCode !== 0) throw new Error((result.stderr || "").trim() || "grep failed with exit " + result.exitCode);
      return Buffer.from(result.stdout || "", "base64").toString("utf8");
    },
    exec: async (command, { onData, signal, timeout }) => {
      let result;
      try {
        result = await call(
          "/op",
          { kind: "exec", toolName, turnRevision, ...extra, operationId: NONCE + ":" + toolCallId + ":" + ++seq, command, cwd: DIR, timeoutSec: timeout },
          { signal, onLine: (line) => line.type === "data" && onData(Buffer.from(line.data, "base64")) },
        );
      } catch (error) {
        if (signal?.aborted) {
          onData(Buffer.from("\\n[paseo] Stop requested. The SSH session was closed; whether remote processes exited is unknown.\\n"));
          throw new Error("aborted");
        }
        onData(Buffer.from("\\n[paseo] " + error.message + "\\n"));
        throw error;
      }
      if (result.outcome === "completed") return { exitCode: result.exitCode };
      const note = result.outcome === "not_sent" ? "Not sent: " : "Outcome unknown, not retried: ";
      onData(Buffer.from("\\n[paseo] " + note + (result.error || result.outcome) + "\\n"));
      throw new Error(result.error || "SSH command " + result.outcome);
    },
  };
}

function globToRegExp(pattern) {
  let out = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (ch === "?") out += "[^/]";
    else if (ch === "{") {
      braces += 1;
      out += "(?:";
    } else if (ch === "}" && braces > 0) {
      braces -= 1;
      out += ")";
    } else if (ch === "," && braces > 0) out += "|";
    else out += ch.replace(/[.+^$()|[\\]\\\\]/g, "\\\\$&");
  }
  return new RegExp("^" + out + "$");
}

function definitionsFor(toolName, toolCallId, signal) {
  const ops = remoteOperations(toolName, toolCallId, {}, signal);
  switch (toolName) {
    case "read":
      return createReadToolDefinition(DIR, { operations: { readFile: ops.readFile, access: ops.access, detectImageMimeType: async (p) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" })[posix.extname(p).toLowerCase()] ?? null } });
    case "write":
      return createWriteToolDefinition(DIR, { operations: { writeFile: ops.writeFile, mkdir: ops.mkdir } });
    case "edit":
      return createEditToolDefinition(DIR, { operations: { readFile: ops.readFile, writeFile: ops.writeFile, access: ops.accessWrite } });
    case "bash":
      return createBashToolDefinition(DIR, { operations: { exec: (command, _cwd, options) => ops.exec(command, options) } });
    case "ls":
      return createLsToolDefinition(DIR, { operations: { exists: ops.exists, stat: ops.stat, readdir: ops.readdir } });
    case "find":
      return createFindToolDefinition(DIR, {
        operations: {
          exists: ops.exists,
          glob: async (pattern, cwd, options) => {
            const regex = globToRegExp(pattern.replace(/^\\.\\//, ""));
            const matchBase = !pattern.includes("/");
            const results = [];
            for (const entry of await ops.find(cwd)) {
              if (entry === ".") continue;
              const rel = entry.startsWith("./") ? entry.slice(2) : entry;
              if (regex.test(matchBase ? posix.basename(rel) : rel)) results.push(rel);
              if (results.length >= options.limit) break;
            }
            return results;
          },
        },
      });
    default:
      return null;
  }
}

async function remoteGrep(toolCallId, params, signal) {
  const ops = remoteOperations("grep", toolCallId, {}, signal);
  const target = toRemote(params.path ?? ".");
  const limit = Math.max(1, Math.min(Number(params.limit ?? 100), 1000));
  const flags = ["-rnI"];
  if (params.ignoreCase) flags.push("-i");
  flags.push(params.literal ? "-F" : "-E");
  if (params.context) flags.push("-C" + Math.max(0, Math.min(Number(params.context), 20)));
  if (params.glob) flags.push("--include=" + params.glob);
  const text = await ops.grep(target, String(params.pattern), flags, signal);
  const lines = text.split("\\n").filter(Boolean);
  const shown = lines.slice(0, limit).join("\\n");
  const more = lines.length > limit ? "\\n[" + (lines.length - limit) + " more lines not shown]" : "";
  return { content: [{ type: "text", text: shown ? shown + more : "No matches found" }], details: undefined };
}

const sameMcpName = (a, b) => a.replace(/-/g, "_") === b.replace(/-/g, "_");

// MCP servers this session may start: the owner's mcp.json entries and extension
// registrations, filtered by the routing's current selection. Pi's MCP extension sees only
// this list (through the facade below), at session start and on every registration change.
function ownerMcpServers(pi, selected, errors) {
  const servers = [];
  const file = nodePath.join(getAgentDir(), "mcp.json");
  let configured = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      configured = parsed.mcpServers ?? parsed["mcp-servers"] ?? {};
    } catch (error) {
      errors.push("Could not read " + file + ": " + error.message);
    }
  }
  for (const [name, config] of Object.entries(configured)) {
    if (selected.some((entry) => sameMcpName(entry, name))) servers.push({ name, config, extensionPath: file });
  }
  for (const registered of pi.getMcpServers?.() ?? []) {
    if (servers.some((entry) => sameMcpName(entry.name, registered.name))) continue;
    if (selected.some((entry) => sameMcpName(entry, registered.name))) servers.push(registered);
  }
  return servers;
}

export default async function paseoSshRouting(pi) {
  const session = await call("/session", {});
  if (session.error) throw new Error(session.error);
  localSkills = session.localSkills !== false;
  remoteHome = typeof session.remoteHome === "string" ? session.remoteHome : null;
  let selectedMcp = Array.isArray(session.localMcpServers) ? session.localMcpServers : [];
  const mcpErrors = [];
  const mcpChangeHandlers = [];
  // Pi's MCP extension runs behind a facade: getMcpServers returns only selected servers and
  // its change handler is kept so a routing change can close and start servers.
  const mcpPi = new Proxy(pi, {
    get(target, prop) {
      if (prop === "getMcpServers") return () => ownerMcpServers(pi, selectedMcp, mcpErrors);
      if (prop === "on") {
        return (event, handler) => {
          if (event === "mcp_servers_change") mcpChangeHandlers.push(handler);
          return target.on(event, handler);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const refreshMcp = async (next, ctx) => {
    const same = next.length === selectedMcp.length && next.every((name) => selectedMcp.includes(name));
    if (same) return;
    selectedMcp = next;
    // Waits until removed servers are closed and added ones have started connecting.
    for (const handler of mcpChangeHandlers) await handler({ type: "mcp_servers_change" }, ctx);
  };

  pi.registerCommand(C.marker, {
    description: "Show where this SSH workspace runs tools",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Tools run on " + binding.machineDisplayName + " in " + DIR, "info");
    },
  });

  const ownerRead = createReadToolDefinition(C.ownerCwd);
  for (const name of C.remoteTools) {
    const template = name === "grep" ? createGrepToolDefinition(DIR) : definitionsFor(name, "template");
    pi.registerTool({
      ...template,
      async execute(id, params, signal, onUpdate) {
        if (name === "read") {
          const ownerPath = ownerSkillPath(params.path);
          if (ownerPath) return ownerRead.execute(id, { ...params, path: ownerPath }, signal, onUpdate);
        }
        if (name === "grep") return remoteGrep(id, params, signal);
        const next = { ...params };
        if (name !== "bash" && typeof next.path === "string") next.path = toRemote(next.path);
        if (signal?.aborted) throw new Error("aborted; nothing was sent");
        return definitionsFor(name, id, signal).execute(id, next, signal, onUpdate);
      },
    });
  }

  pi.on("session_start", (_event, ctx) => {
    refreshSkillRoots(ctx.getSystemPromptOptions?.());
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const turn = await call("/turn", {});
    if (turn.error) throw new Error(turn.error);
    await refreshMcp(Array.isArray(turn.localMcpServers) ? turn.localMcpServers : [], ctx);
    turnRevision = turn.routingRevision;
    localSkills = turn.localSkills !== false;
    refreshSkillRoots(event.systemPromptOptions);
    const local = turn.localTools.length > 0 ? turn.localTools.join(", ") : "none";
    const sections = [
      "<execution_location>",
      "This workspace runs on the SSH machine \\"" + turn.machineDisplayName + "\\". Project directory: " + DIR,
      "read, write, edit, ls, find, grep and bash operate on that machine. The owner computer's files are not the project.",
      localSkills ? "Loaded skill files are read from the owner computer, read-only; commands from skills still run on the SSH machine." : "",
      "Tools that run on the owner computer by routing: " + local + ". Other tools are unavailable.",
      "</execution_location>",
    ];
    if (turn.unknownOperations.length > 0) {
      sections.push(
        "<unknown_outcomes>",
        "These operations on the SSH machine may or may not have run. Changes on the machine stay blocked until the user confirms them in Paseo (Files, Operations). Inspect read-only and tell the user; do not repeat them:",
        ...turn.unknownOperations.map((op) => "- " + op.kind + (op.path ? " " + op.path : "") + (op.detail ? ": " + op.detail : "")),
        "</unknown_outcomes>",
      );
    }
    for (const file of turn.instructions) {
      sections.push("<project_instructions source=\\"" + turn.machineDisplayName + ":" + file.path + "\\">", file.text, "</project_instructions>");
    }
    if (turn.instructionsError) {
      sections.push("<project_instructions_error>" + turn.instructionsError + "</project_instructions_error>");
    }
    // Pi renders its process directory into the prompt; the project directory is the remote one.
    const systemPrompt = String(event.systemPrompt).split(C.ownerCwd).join(DIR);
    return { systemPrompt: systemPrompt + "\\n" + sections.filter(Boolean).join("\\n") };
  });

  pi.on("tool_call", async (event) => {
    const name = event.toolName;
    if (C.remoteTools.includes(name)) {
      const registered = pi.getAllTools().find((tool) => tool.name === name);
      if (registered?.sourceInfo?.path !== C.extensionPath) {
        return { block: true, reason: "Tool \\"" + name + "\\" was replaced by another extension, so it has no verified SSH implementation." };
      }
      if ((name === "write" || name === "edit") && ownerSkillPath(event.input?.path)) {
        return { block: true, reason: "Skill files on the owner computer are read-only." };
      }
    }
    let decision;
    try {
      decision = await call("/admit", { toolName: name, turnRevision });
    } catch (error) {
      return { block: true, reason: "Paseo could not admit this call (" + error.message + "); nothing was executed." };
    }
    if (decision.error) return { block: true, reason: decision.error };
    if (decision.decision === "deny") return { block: true, reason: decision.reason };
    return undefined;
  });

  pi.on("user_bash", async (event) => {
    const refused = (output) => ({ result: { output, exitCode: 1, cancelled: false, truncated: false } });
    let decision;
    try {
      decision = await call("/admit", { toolName: "bash", turnRevision: null, userShell: true });
    } catch (error) {
      return refused("Paseo could not admit this command (" + error.message + "); it was not run.");
    }
    if (decision.error) return refused(decision.error);
    if (decision.decision !== "remote") return refused(decision.reason || "bash is not available here; the command was not run.");
    // The revision this admission used stays bound to the command's operations.
    const ops = remoteOperations("bash", "user-" + randomBytes(4).toString("hex"), {
      userShell: true,
      turnRevision: decision.routingRevision ?? null,
    });
    return { operations: { exec: (command, _cwd, options) => ops.exec(command, options) } };
  });

  // Replaces Pi's built-in MCP for this session (Pi is started with --no-mcp). Registered last
  // so the routing's before_agent_start refreshes servers before MCP renders its section.
  createMcpExtension({
    loadConfig: () => ({ servers: [], errors: mcpErrors.splice(0), autoEnableCodemode: true }),
  })(mcpPi);
}
`.trimStart();
}
