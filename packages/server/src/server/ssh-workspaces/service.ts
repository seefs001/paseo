import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import type {
  SshEffectiveRouting,
  SshInboundMessage,
  SshMachine,
  SshMachineConnection,
  SshMachineProbe,
  SshMachineTarget,
  SshOutboundMessage,
  SshRemoteEntry,
  SshToolRoutingPolicy,
  SshWorkspaceRoutingOverride,
  WorkspaceExecutionLocation,
} from "@getpaseo/protocol/ssh-workspaces";

import { writeFileAtomic } from "../atomic-file.js";
import { generateWorkspaceId } from "../workspace-registry-model.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedWorkspaceRecord,
  type WorkspaceRegistry,
} from "../workspace-registry.js";
import { sshDirectoryKey, sshSessionDirectory, writeSshExecutionBinding } from "./binding.js";
import { SshBridgeServer, type SshBridgeRequestContext } from "./bridge.js";
import {
  requireCompleted,
  runRemote,
  RemoteOutcomeError,
  type RemoteRunResult,
} from "./executor.js";
import { SshOperationJournal, type SshOperationRecord } from "./journal.js";
import {
  buildSshArgv,
  classifySshFailure,
  ensureSshConnectionDirs,
  normalizeRemotePath,
  shellQuote,
  sshConnectionFiles,
  SshTransportError,
  validateSshTarget,
  type SshConnectionFiles,
} from "./transport.js";

// Tools the Pi routing extension implements against the machine. They cannot be routed to
// the owner computer: their owner-side handlers would act on the owner's files.
export const SSH_REMOTE_TOOLS = ["read", "write", "edit", "bash", "ls", "find", "grep"] as const;
const SIDE_EFFECT_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "bash"]);
// Pi control flow that stays on the owner. Calls they make are admitted one by one.
const CONTROL_TOOLS: ReadonlySet<string> = new Set(["codemode", "tool_search"]);

const PolicySchema = z.object({
  revision: z.number().int(),
  localTools: z.array(z.string()),
  disabledTools: z.array(z.string()),
  localSkills: z.boolean(),
  localMcpServers: z.array(z.string()).default([]),
});

const OverrideSchema = z.object({
  revision: z.number().int(),
  localTools: z.array(z.string()).nullable(),
  disabledTools: z.array(z.string()).nullable(),
  localSkills: z.boolean().nullable(),
  localMcpServers: z.array(z.string()).nullable().default(null),
});
type StoredOverride = z.infer<typeof OverrideSchema>;

const StoredMachineSchema = z.object({
  machineId: z.string(),
  displayName: z.string(),
  target: z.object({
    host: z.string(),
    user: z.string().nullable().optional(),
    port: z.number().int().nullable().optional(),
  }),
  revision: z.number().int(),
  disabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  policy: PolicySchema,
  probe: z
    .object({
      revision: z.number().int(),
      os: z.string(),
      shell: z.string(),
      home: z.string(),
      user: z.string(),
      hasGit: z.boolean(),
    })
    .nullable()
    .default(null),
  // Removed machines keep their identity so historical sessions still name their origin.
  removedAt: z.string().nullable().default(null),
});
type StoredMachine = z.infer<typeof StoredMachineSchema>;

const StoreSchema = z.object({
  version: z.literal(1),
  machines: z.array(StoredMachineSchema),
  workspaceRouting: z.record(z.string(), OverrideSchema).default({}),
});
type Store = z.infer<typeof StoreSchema>;

const DEFAULT_POLICY: z.infer<typeof PolicySchema> = {
  revision: 1,
  localTools: [],
  disabledTools: [],
  localSkills: true,
  localMcpServers: [],
};

const TOOL_NAME = /^[A-Za-z0-9_.:*-]{1,128}$/;
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_INSTRUCTION_BYTES = 64 * 1024;

interface HostKeyCandidate {
  machineId: string;
  revision: number;
  candidateId: string;
  lines: string;
  fingerprints: string[];
}

interface SessionToken {
  workspaceId: string;
  machineId: string;
  machineRevision: number;
}

export interface SshWorkspaceServiceOptions {
  paseoHome: string;
  serverId: string;
  workspaceRegistry: WorkspaceRegistry;
  logger: Logger;
}

export interface SshRequestAccess {
  // daemon.read: connection targets and routing policies.
  fullConfig: boolean;
}

type Decision =
  | { kind: "remote" | "local" | "control"; routingRevision: string }
  | { kind: "deny"; reason: string; routingRevision: string | null };

export class SshWorkspaceService {
  private readonly storeFile: string;
  private readonly files: SshConnectionFiles;
  private readonly homeKey: string;
  private store: Store | null = null;
  private readonly connections = new Map<string, SshMachineConnection>();
  private readonly checks = new Map<string, Promise<void>>();
  private readonly candidates = new Map<string, HostKeyCandidate>();
  private readonly tokens = new Map<string, SessionToken>();
  private readonly sshWorkspaceIds = new Set<string>();
  private readonly journal: SshOperationJournal;
  private readonly bridge: SshBridgeServer;
  // Serializes store writes and binding publication.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: SshWorkspaceServiceOptions) {
    this.storeFile = join(options.paseoHome, "ssh-machines.json");
    this.files = sshConnectionFiles(options.paseoHome);
    this.homeKey = createHash("sha256").update(options.paseoHome).digest("hex").slice(0, 12);
    this.journal = new SshOperationJournal(options.paseoHome);
    this.bridge = new SshBridgeServer(
      join(this.files.controlDir, "bridge.sock"),
      (route, body, context) => this.handleBridge(route, body, context),
      options.logger,
    );
  }

  // Starts the bridge and issues fresh tokens. Sessions started before a restart cannot
  // reuse old bindings.
  async initialize(): Promise<void> {
    await this.load();
    await ensureSshConnectionDirs(this.files);
    await this.journal.initialize();
    await this.bridge.start();
    for (const workspace of await this.options.workspaceRegistry.listAll()) {
      if (workspace.executionLocation) this.sshWorkspaceIds.add(workspace.workspaceId);
    }
    await this.enqueue(() => this.publishAllBindings());
  }

  async stop(): Promise<void> {
    await this.bridge.stop();
  }

  isSshWorkspaceId(workspaceId: string | null | undefined): boolean {
    return Boolean(workspaceId && this.sshWorkspaceIds.has(workspaceId));
  }

  async handle(msg: SshInboundMessage, access: SshRequestAccess): Promise<SshOutboundMessage> {
    const requestId = msg.requestId;
    try {
      switch (msg.type) {
        case "ssh.machine.list.request":
          return {
            type: "ssh.machine.list.response",
            payload: { requestId, error: null, machines: await this.listMachines(access) },
          };
        case "ssh.machine.save.request":
          return {
            type: "ssh.machine.save.response",
            payload: { requestId, error: null, machine: await this.saveMachine(msg) },
          };
        case "ssh.machine.remove.request": {
          const result = await this.removeMachine(msg.machineId);
          return {
            type: "ssh.machine.remove.response",
            payload: { requestId, machineId: msg.machineId, ...result },
          };
        }
        case "ssh.machine.check.request":
          await this.checkMachine(msg.machineId);
          return {
            type: "ssh.machine.check.response",
            payload: { requestId, error: null, machine: await this.describe(msg.machineId) },
          };
        case "ssh.machine.trust.request":
          await this.trustHostKey(msg.machineId, msg.revision, msg.candidateId);
          return {
            type: "ssh.machine.trust.response",
            payload: { requestId, error: null, machine: await this.describe(msg.machineId) },
          };
        case "ssh.machine.policy.set.request":
          return {
            type: "ssh.machine.policy.set.response",
            payload: { requestId, error: null, machine: await this.setPolicy(msg) },
          };
        case "ssh.workspace.create.request": {
          const workspace = await this.createWorkspace(msg);
          return {
            type: "ssh.workspace.create.response",
            payload: {
              requestId,
              error: null,
              workspaceId: workspace.workspaceId,
              directory: workspace.executionLocation?.directory ?? null,
            },
          };
        }
        case "ssh.workspace.files.list.request": {
          const result = await this.listFiles(msg.workspaceId, msg.path);
          return {
            type: "ssh.workspace.files.list.response",
            payload: { requestId, error: null, workspaceId: msg.workspaceId, ...result },
          };
        }
        case "ssh.workspace.files.read.request": {
          const result = await this.readFile(msg.workspaceId, msg.path);
          return {
            type: "ssh.workspace.files.read.response",
            payload: { requestId, error: null, workspaceId: msg.workspaceId, ...result },
          };
        }
        case "ssh.workspace.routing.get.request":
          return {
            type: "ssh.workspace.routing.get.response",
            payload: { requestId, error: null, ...(await this.getRouting(msg.workspaceId)) },
          };
        case "ssh.workspace.routing.set.request":
          return {
            type: "ssh.workspace.routing.set.response",
            payload: { requestId, error: null, ...(await this.setWorkspaceRouting(msg)) },
          };
        case "ssh.workspace.operations.list.request":
          await this.requireSshWorkspace(msg.workspaceId);
          return {
            type: "ssh.workspace.operations.list.response",
            payload: {
              requestId,
              error: null,
              workspaceId: msg.workspaceId,
              operations: this.journal.list(msg.workspaceId),
            },
          };
        case "ssh.workspace.operations.acknowledge.request":
          return {
            type: "ssh.workspace.operations.acknowledge.response",
            payload: {
              requestId,
              error: null,
              workspaceId: msg.workspaceId,
              ...(await this.acknowledgeOperations(msg.workspaceId, msg.operations)),
            },
          };
      }
    } catch (error) {
      return errorResponse(msg, describeError(error));
    }
  }

  // Location facts for descriptors. Null for local workspaces.
  describeLocation(workspace: PersistedWorkspaceRecord): WorkspaceExecutionLocation | null {
    const location = workspace.executionLocation;
    if (!location) return null;
    const machine = this.store?.machines.find((entry) => entry.machineId === location.machineId);
    return {
      kind: "ssh",
      machineId: location.machineId,
      ...(machine ? { machineDisplayName: machine.displayName } : {}),
      directory: location.directory,
      key: sshDirectoryKey(location.machineId, location.directory),
      gitObservation: location.gitObservation ?? "unobserved",
    };
  }

  // ---- machines ----

  async listMachines(access: SshRequestAccess): Promise<SshMachine[]> {
    const machines = (await this.load()).machines.filter((machine) => !machine.removedAt);
    return Promise.all(machines.map((machine) => this.toWire(machine, access)));
  }

  private async describe(machineId: string): Promise<SshMachine> {
    return this.toWire(await this.requireMachine(machineId), { fullConfig: true });
  }

  private async saveMachine(
    msg: Extract<SshInboundMessage, { type: "ssh.machine.save.request" }>,
  ): Promise<SshMachine> {
    const target = normalizeTarget(msg.target);
    const invalid = validateSshTarget(target);
    if (invalid) throw new Error(invalid);
    const displayName = msg.displayName.trim() || target.host;
    const machineId = msg.machineId;
    const saved = await this.mutate(
      (store, referencing: string[]) => {
        const now = new Date().toISOString();
        if (!msg.machineId) {
          const machine: StoredMachine = {
            machineId: `ssh_${randomBytes(8).toString("hex")}`,
            displayName,
            target,
            revision: 1,
            disabled: msg.disabled ?? false,
            createdAt: now,
            updatedAt: now,
            policy: { ...DEFAULT_POLICY },
            probe: null,
            removedAt: null,
          };
          store.machines.push(machine);
          return machine;
        }
        const machine = store.machines.find(
          (entry) => entry.machineId === msg.machineId && !entry.removedAt,
        );
        if (!machine) throw new Error("SSH machine not found");
        if (msg.expectedRevision !== undefined && msg.expectedRevision !== machine.revision) {
          throw new Error("SSH machine changed since it was loaded; reload and retry");
        }
        // The target is the machine's identity. Any workspace that ever used it, archived ones
        // included, would follow a changed target to another host.
        if (!sameTarget(machine.target, target)) {
          if (referencing.length > 0) {
            throw new Error(
              "Workspaces have used this machine, so its target cannot change. Add a new machine instead.",
            );
          }
          machine.target = target;
          machine.revision += 1;
          machine.probe = null;
        }
        machine.displayName = displayName;
        if (msg.disabled !== undefined) machine.disabled = msg.disabled;
        machine.updatedAt = now;
        return machine;
      },
      async () => (machineId ? this.referencingWorkspaceIds(machineId) : []),
    );
    return this.toWire(saved, { fullConfig: true });
  }

  private async removeMachine(
    machineId: string,
  ): Promise<{ removed: boolean; blockingWorkspaceIds: string[]; error: string | null }> {
    const blocking = await this.mutate(
      (store, active: string[]) => {
        if (active.length > 0) return active;
        const machine = store.machines.find(
          (entry) => entry.machineId === machineId && !entry.removedAt,
        );
        if (!machine) throw new Error("SSH machine not found");
        machine.removedAt = new Date().toISOString();
        return [];
      },
      () => this.activeWorkspaceIds(machineId),
    );
    if (blocking.length > 0) {
      return {
        removed: false,
        blockingWorkspaceIds: blocking,
        error: "Archive the workspaces that use this machine first",
      };
    }
    this.connections.delete(machineId);
    return { removed: true, blockingWorkspaceIds: [], error: null };
  }

  private async setPolicy(
    msg: Extract<SshInboundMessage, { type: "ssh.machine.policy.set.request" }>,
  ): Promise<SshMachine> {
    const localTools = validateLocalTools(msg.localTools);
    const disabledTools = uniqueToolNames(msg.disabledTools);
    const localMcpServers = uniqueMcpServers(msg.localMcpServers ?? []);
    assertNoConflict(localTools, disabledTools);
    const machine = await this.mutate((store) => {
      const entry = store.machines.find(
        (item) => item.machineId === msg.machineId && !item.removedAt,
      );
      if (!entry) throw new Error("SSH machine not found");
      if (entry.policy.revision !== msg.expectedRevision) {
        throw new Error("Tool routing changed since it was loaded; reload and retry");
      }
      entry.policy = {
        revision: entry.policy.revision + 1,
        localTools,
        disabledTools,
        localSkills: msg.localSkills,
        localMcpServers,
      };
      entry.updatedAt = new Date().toISOString();
      return entry;
    });
    return this.toWire(machine, { fullConfig: true });
  }

  private async getRouting(workspaceId: string) {
    const { machine } = await this.requireSshWorkspace(workspaceId);
    const override = this.store?.workspaceRouting[workspaceId] ?? null;
    return {
      workspaceId,
      override: override ? toWireOverride(override) : null,
      effective: effectiveRouting(machine.policy, override),
    };
  }

  private async setWorkspaceRouting(
    msg: Extract<SshInboundMessage, { type: "ssh.workspace.routing.set.request" }>,
  ) {
    const { machine: owner } = await this.requireSshWorkspace(msg.workspaceId);
    const localTools = msg.localTools === null ? null : validateLocalTools(msg.localTools);
    const disabledTools = msg.disabledTools === null ? null : uniqueToolNames(msg.disabledTools);
    const localMcpServers =
      msg.localMcpServers === null || msg.localMcpServers === undefined
        ? null
        : uniqueMcpServers(msg.localMcpServers);
    await this.mutate((store) => {
      const current = store.workspaceRouting[msg.workspaceId];
      const revision = current?.revision ?? 0;
      if (revision !== msg.expectedRevision) {
        throw new Error("Workspace tool routing changed since it was loaded; reload and retry");
      }
      const machine = store.machines.find((entry) => entry.machineId === owner.machineId);
      if (!machine) throw new Error("SSH machine for this workspace is unavailable");
      const next: StoredOverride = {
        revision: revision + 1,
        localTools,
        disabledTools,
        localSkills: msg.localSkills,
        localMcpServers,
      };
      const effective = effectiveRouting(machine.policy, next);
      assertNoConflict(effective.localTools, effective.disabledTools);
      store.workspaceRouting[msg.workspaceId] = next;
    });
    return this.getRouting(msg.workspaceId);
  }

  async checkMachine(machineId: string): Promise<void> {
    const pending = this.checks.get(machineId);
    if (pending) return pending;
    const run = this.runCheck(machineId).finally(() => this.checks.delete(machineId));
    this.checks.set(machineId, run);
    return run;
  }

  private async runCheck(machineId: string): Promise<void> {
    const machine = await this.requireMachine(machineId);
    const revision = machine.revision;
    if (machine.disabled) {
      this.setConnection(machineId, { state: "disabled", revision });
      return;
    }
    this.setConnection(machineId, { state: "checking", revision });
    try {
      const probe = await this.probe(machine);
      await this.mutate((store) => {
        const entry = store.machines.find((item) => item.machineId === machineId);
        if (entry && entry.revision === revision) entry.probe = { revision, ...probe };
      });
      this.setConnection(machineId, {
        state: "ready",
        revision,
        probe,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      const transport =
        error instanceof SshTransportError
          ? error
          : new SshTransportError("failed", describeError(error));
      if (transport.problem === "host_key_unknown") {
        const candidate = await this.scanHostKey(machine).catch((scanError: unknown) => {
          this.options.logger.info({ err: scanError, machineId }, "ssh host key scan failed");
          return null;
        });
        this.setConnection(machineId, {
          state: candidate ? "needs_trust" : "needs_attention",
          problem: "host_key_unknown",
          detail: candidate
            ? "Confirm the host key fingerprint to trust this machine"
            : "The host key is unknown and could not be scanned directly (for example behind ProxyJump). Add it to ~/.ssh/known_hosts on the daemon computer.",
          revision,
          hostKey: candidate
            ? { candidateId: candidate.candidateId, fingerprints: candidate.fingerprints }
            : null,
          checkedAt: new Date().toISOString(),
        });
        return;
      }
      this.setConnection(machineId, {
        state: "needs_attention",
        problem: transport.problem,
        detail: transport.message,
        revision,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  private async probe(machine: StoredMachine): Promise<SshMachineProbe> {
    const result = await runRemote(
      buildSshArgv(machine.target, this.files),
      [
        'printf "%s\\n" "$(uname -s 2>/dev/null)" "${SHELL:-}" "$HOME" "$(id -un 2>/dev/null)"',
        "if command -v git >/dev/null 2>&1; then echo git; else echo nogit; fi",
        "for c in cat mkdir find grep head wc base64 dirname; do command -v $c >/dev/null 2>&1 || echo missing:$c; done",
      ].join("\n"),
      { timeoutMs: 30_000 },
    );
    if (result.outcome.kind !== "completed") {
      const problem = classifySshFailure(result.stderr);
      throw new SshTransportError(
        problem === "failed" ? "remote_command_missing" : problem,
        result.outcome.reason || "SSH connection failed",
      );
    }
    const lines = result.stdout.toString("utf8").split("\n");
    const missing = lines
      .filter((line) => line.startsWith("missing:"))
      .map((line) => line.slice(8));
    if (missing.length > 0) {
      throw new SshTransportError(
        "remote_command_missing",
        `Remote machine is missing: ${missing.join(", ")}`,
      );
    }
    const [os = "", shell = "", home = "", user = "", git = ""] = lines;
    if (!home.startsWith("/")) {
      throw new SshTransportError("unsupported_remote", "Remote machine is not a POSIX system");
    }
    if (!/^(Linux|Darwin|FreeBSD|OpenBSD|NetBSD)$/.test(os)) {
      throw new SshTransportError(
        "unsupported_remote",
        `Unsupported remote system: ${os || "unknown"}`,
      );
    }
    return { os, shell, home, user, hasGit: git === "git" };
  }

  private async scanHostKey(machine: StoredMachine): Promise<HostKeyCandidate | null> {
    const config = await execText("ssh", [
      "-G",
      ...(machine.target.port != null ? ["-p", String(machine.target.port)] : []),
      ...(machine.target.user ? ["-l", machine.target.user] : []),
      "--",
      machine.target.host,
    ]);
    const values = new Map<string, string>();
    for (const line of config.split("\n")) {
      const index = line.indexOf(" ");
      if (index > 0) values.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
    }
    const proxyJump = values.get("proxyjump");
    const proxyCommand = values.get("proxycommand");
    if ((proxyJump && proxyJump !== "none") || (proxyCommand && proxyCommand !== "none")) {
      return null;
    }
    const hostname = values.get("hostkeyalias") ?? values.get("hostname") ?? machine.target.host;
    const port = values.get("port") ?? "22";
    const lines = (
      await execText("ssh-keyscan", [
        "-T",
        "10",
        "-p",
        port,
        "--",
        values.get("hostname") ?? hostname,
      ])
    )
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => {
        const [, ...rest] = line.split(" ");
        const label = port === "22" ? hostname : `[${hostname}]:${port}`;
        return `${label} ${rest.join(" ")}`;
      });
    if (lines.length === 0) return null;
    const text = `${lines.join("\n")}\n`;
    const dir = await mkdtemp(join(tmpdir(), "paseo-ssh-keys-"));
    let fingerprints: string[];
    try {
      const file = join(dir, "keys");
      await writeFile(file, text);
      fingerprints = (await execText("ssh-keygen", ["-l", "-f", file]))
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const candidate: HostKeyCandidate = {
      machineId: machine.machineId,
      revision: machine.revision,
      candidateId: createHash("sha256").update(text).digest("hex").slice(0, 32),
      lines: text,
      fingerprints,
    };
    this.candidates.set(machine.machineId, candidate);
    return candidate;
  }

  private async trustHostKey(machineId: string, revision: number, candidateId: string) {
    const machine = await this.requireMachine(machineId);
    const candidate = this.candidates.get(machineId);
    if (!candidate || candidate.candidateId !== candidateId || candidate.revision !== revision) {
      throw new Error("Host key candidate is stale; check the machine again");
    }
    if (machine.revision !== revision) throw new Error("SSH machine changed; check it again");
    await ensureSshConnectionDirs(this.files);
    const existing = await readFile(this.files.knownHostsFile, "utf8").catch(() => "");
    if (!existing.includes(candidate.lines)) {
      await appendFile(this.files.knownHostsFile, candidate.lines, { mode: 0o600 });
    }
    this.candidates.delete(machineId);
    await this.checkMachine(machineId);
  }

  // ---- workspaces ----

  private async createWorkspace(
    msg: Extract<SshInboundMessage, { type: "ssh.workspace.create.request" }>,
  ): Promise<PersistedWorkspaceRecord> {
    const initial = await this.requireMachine(msg.machineId);
    if (initial.disabled) throw new Error("SSH machine is disabled");
    await this.checkMachine(initial.machineId);
    const connection = this.connections.get(initial.machineId);
    if (connection?.state !== "ready" || !connection.probe) {
      throw new Error(connection?.detail ?? "SSH machine is not ready");
    }
    const directory = normalizeRemotePath(msg.directory.trim(), connection.probe.home);
    const inspected = requireCompleted(
      await runRemote(
        buildSshArgv(initial.target, this.files),
        [
          `[ -d ${shellQuote(directory)} ] || exit 3`,
          "if command -v git >/dev/null 2>&1; then",
          `  r=$(cd -- ${shellQuote(directory)} && git rev-parse --is-inside-work-tree 2>/dev/null); s=$?`,
          '  if [ "$r" = true ]; then echo git; elif [ $s -eq 128 ]; then echo not_git; else echo failed; fi',
          "else echo unobserved; fi",
        ].join("\n"),
        { timeoutMs: 30_000 },
      ),
    );
    if (inspected.exitCode === 3) throw new Error(`Remote directory does not exist: ${directory}`);
    if (inspected.exitCode !== 0) {
      throw new Error(inspected.stderr.trim() || "Could not inspect the remote directory");
    }
    const observed = inspected.stdout.toString("utf8").trim();
    const gitObservation = (["git", "not_git", "failed", "unobserved"] as const).find(
      (value) => value === observed,
    );
    // The machine is re-read inside the queue: a disable, removal or target change that
    // landed while probing wins over this creation.
    return this.enqueue(async () => {
      const store = await this.load();
      const machine = store.machines.find((entry) => entry.machineId === initial.machineId);
      if (!machine || machine.removedAt || machine.disabled) {
        throw new Error("SSH machine was disabled or removed while creating the workspace");
      }
      if (machine.revision !== initial.revision) {
        throw new Error("SSH machine changed while creating the workspace; try again");
      }
      const workspaceId = generateWorkspaceId();
      const cwd = sshSessionDirectory(this.homeKey, workspaceId);
      const now = new Date().toISOString();
      const segments = directory.split("/").filter(Boolean);
      const record = createPersistedWorkspaceRecord({
        workspaceId,
        projectId: null,
        cwd,
        kind: "directory",
        displayName: `${machine.displayName}:${segments[segments.length - 1] ?? "/"}`,
        title: msg.title?.trim() || null,
        createdAt: now,
        updatedAt: now,
        executionLocation: {
          kind: "ssh",
          machineId: machine.machineId,
          directory,
          gitObservation: gitObservation ?? "failed",
        },
      });
      await this.publishBinding(machine, record);
      await this.options.workspaceRegistry.upsert(record);
      this.sshWorkspaceIds.add(workspaceId);
      return record;
    });
  }

  private async requireSshWorkspace(workspaceId: string) {
    const workspace = await this.options.workspaceRegistry.get(workspaceId);
    if (!workspace?.executionLocation) throw new Error("Workspace is not an SSH workspace");
    const location = workspace.executionLocation;
    const machine = await this.requireMachine(location.machineId, { includeRemoved: true });
    return { workspace, location, machine };
  }

  private async resolveWorkspaceForRemote(workspaceId: string) {
    const resolved = await this.requireSshWorkspace(workspaceId);
    if (resolved.machine.removedAt || resolved.machine.disabled) {
      throw new Error("SSH machine is unavailable");
    }
    return resolved;
  }

  private async listFiles(workspaceId: string, path: string) {
    const { location, machine } = await this.resolveWorkspaceForRemote(workspaceId);
    const target = normalizeRemotePath(path || ".", machine.probe?.home ?? "/", location.directory);
    const result = requireCompleted(
      await runRemote(
        buildSshArgv(machine.target, this.files),
        [
          `cd -- ${shellQuote(target)} 2>/dev/null || exit 3`,
          'for f in .* *; do [ "$f" = . ] || [ "$f" = .. ] && continue; [ -e "$f" ] || [ -L "$f" ] || continue',
          'if [ -L "$f" ]; then t=l; s=; elif [ -d "$f" ]; then t=d; s=; elif [ -f "$f" ]; then t=f; s=$(wc -c < "$f" 2>/dev/null | tr -d " "); else t=o; s=; fi',
          'printf \'%s\\t%s\\t%s\\0\' "$t" "$s" "$f"; done',
        ].join("\n"),
        { timeoutMs: 60_000, maxStdoutBytes: 16 * 1024 * 1024 },
      ),
    );
    if (result.exitCode === 3) throw new Error(`Remote directory not found: ${target}`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Listing failed with exit ${result.exitCode}`);
    }
    const kinds = { d: "directory", f: "file", l: "symlink", o: "other" } as const;
    const entries: SshRemoteEntry[] = [];
    for (const record of result.stdout.toString("utf8").split("\0")) {
      if (!record) continue;
      const [kind, size, ...nameParts] = record.split("\t");
      const name = nameParts.join("\t");
      entries.push({
        name,
        path: target === "/" ? `/${name}` : `${target}/${name}`,
        kind: kinds[kind as keyof typeof kinds] ?? "other",
        size: size ? Number(size) : null,
      });
    }
    const rank = (entry: SshRemoteEntry) => (entry.kind === "directory" ? 0 : 1);
    entries.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { machineId: machine.machineId, path: target, entries };
  }

  private async readFile(workspaceId: string, path: string) {
    const { location, machine } = await this.resolveWorkspaceForRemote(workspaceId);
    const target = normalizeRemotePath(path, machine.probe?.home ?? "/", location.directory);
    const result = requireCompleted(
      await runRemote(
        buildSshArgv(machine.target, this.files),
        [
          `[ -f ${shellQuote(target)} ] || exit 3`,
          `wc -c < ${shellQuote(target)} | tr -d ' '`,
          `head -c ${MAX_PREVIEW_BYTES} -- ${shellQuote(target)}`,
        ].join("\n"),
        { timeoutMs: 60_000, maxStdoutBytes: MAX_PREVIEW_BYTES + 64 },
      ),
    );
    if (result.exitCode === 3) throw new Error(`Remote file not found: ${target}`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Reading failed with exit ${result.exitCode}`);
    }
    const newline = result.stdout.indexOf(10);
    const size = Number(result.stdout.subarray(0, newline).toString("utf8"));
    const data = result.stdout.subarray(newline + 1);
    const binary = data.includes(0) || !isValidUtf8(data);
    return {
      machineId: machine.machineId,
      path: target,
      text: binary ? null : data.toString("utf8"),
      binary,
      size: Number.isFinite(size) ? size : null,
      truncated: Number.isFinite(size) && size > data.length,
    };
  }

  // ---- bindings and the Pi bridge ----

  private async publishAllBindings(): Promise<void> {
    const store = await this.load();
    for (const workspace of await this.options.workspaceRegistry.listAll()) {
      const location = workspace.executionLocation;
      // Archived workspaces keep a binding: the bridge refuses them while archived, and
      // restoring one must not need a daemon restart.
      if (!location) continue;
      const machine = store.machines.find((entry) => entry.machineId === location.machineId);
      if (!machine) continue;
      try {
        await this.publishBinding(machine, workspace);
      } catch (error) {
        // No token is registered for this workspace, so its agents cannot start.
        this.options.logger.warn(
          { err: error, workspaceId: workspace.workspaceId },
          "failed to publish SSH workspace binding",
        );
      }
    }
  }

  private async publishBinding(
    machine: StoredMachine,
    workspace: PersistedWorkspaceRecord,
  ): Promise<void> {
    const location = workspace.executionLocation;
    if (!location) return;
    for (const [token, entry] of this.tokens) {
      if (entry.workspaceId === workspace.workspaceId) this.tokens.delete(token);
    }
    const token = randomBytes(24).toString("base64url");
    await writeSshExecutionBinding(workspace.cwd, {
      version: 2,
      workspaceId: workspace.workspaceId,
      machineDisplayName: machine.displayName,
      directory: location.directory,
      socketPath: this.bridge.socketPath,
      token,
    });
    this.tokens.set(token, {
      workspaceId: workspace.workspaceId,
      machineId: machine.machineId,
      machineRevision: machine.revision,
    });
  }

  private async handleBridge(
    route: string,
    body: Record<string, unknown>,
    context: SshBridgeRequestContext,
  ): Promise<Record<string, unknown>> {
    const session = this.tokens.get(typeof body.token === "string" ? body.token : "");
    if (!session) {
      return { error: "This SSH workspace session is no longer valid; reload the agent." };
    }
    switch (route) {
      case "/session":
        return this.bridgeSession(session);
      case "/turn":
        return this.bridgeTurn(session);
      case "/admit": {
        const decision = await this.decide(session, String(body.toolName ?? ""), {
          turnRevision: typeof body.turnRevision === "string" ? body.turnRevision : null,
          userShell: body.userShell === true,
        });
        return decision.kind === "deny"
          ? { decision: "deny", reason: decision.reason }
          : { decision: decision.kind, routingRevision: decision.routingRevision };
      }
      case "/op":
        return this.bridgeOperation(session, body, context);
      default:
        return { error: `Unknown bridge route ${route}` };
    }
  }

  private async bridgeSession(session: SessionToken): Promise<Record<string, unknown>> {
    const { machine, workspace } = await this.requireSshWorkspace(session.workspaceId);
    const routing = effectiveRouting(
      machine.policy,
      this.store?.workspaceRouting[workspace.workspaceId] ?? null,
    );
    return {
      localMcpServers: routing.localMcpServers,
      localSkills: routing.localSkills,
      remoteHome: machine.probe?.revision === machine.revision ? machine.probe.home : null,
    };
  }

  private async bridgeTurn(session: SessionToken): Promise<Record<string, unknown>> {
    const { machine, workspace, location } = await this.requireSshWorkspace(session.workspaceId);
    const override = this.store?.workspaceRouting[workspace.workspaceId] ?? null;
    const routing = effectiveRouting(machine.policy, override);
    // A turn only shows what is unresolved. Starting a turn is not proof a person decided;
    // system resumes, other agents and schedules start turns too.
    const unresolved = this.journal.unresolved(workspace.workspaceId);
    let instructions: Array<{ path: string; text: string }> = [];
    let instructionsError: string | null = null;
    if (!machine.disabled && !machine.removedAt) {
      try {
        instructions = await this.readProjectInstructions(machine, location.directory);
      } catch (error) {
        instructionsError = describeError(error);
      }
    }
    return {
      routingRevision: routingRevision(routing),
      localTools: routing.localTools,
      disabledTools: routing.disabledTools,
      localSkills: routing.localSkills,
      localMcpServers: routing.localMcpServers,
      machineDisplayName: machine.displayName,
      instructions,
      instructionsError,
      unknownOperations: unresolved.map((record) => ({
        kind: record.kind,
        path: record.path,
        detail: record.detail,
      })),
    };
  }

  private async readProjectInstructions(
    machine: StoredMachine,
    directory: string,
  ): Promise<Array<{ path: string; text: string }>> {
    const result = requireCompleted(
      await runRemote(
        buildSshArgv(machine.target, this.files),
        [
          `d=${shellQuote(directory)}`,
          "while :; do",
          '  for f in AGENTS.md CLAUDE.md; do if [ -f "$d/$f" ]; then',
          `    printf '\\036FILE %s\\036' "$d/$f"; head -c ${MAX_INSTRUCTION_BYTES} -- "$d/$f"; break`,
          "  fi; done",
          '  [ "$d" = / ] && break',
          '  d=$(dirname -- "$d")',
          "done",
        ].join("\n"),
        { timeoutMs: 30_000, maxStdoutBytes: MAX_INSTRUCTION_BYTES * 32 },
      ),
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "instructions failed");
    const files: Array<{ path: string; text: string }> = [];
    for (const part of result.stdout.toString("utf8").split("\u001eFILE ").slice(1)) {
      const end = part.indexOf("\u001e");
      if (end < 0) continue;
      files.push({ path: part.slice(0, end), text: part.slice(end + 1) });
    }
    // Outermost first, like Pi's own context file order.
    return files.toReversed();
  }

  private async decide(
    session: SessionToken,
    toolName: string,
    input: { turnRevision: string | null; userShell?: boolean; operationId?: string },
  ): Promise<Decision> {
    const workspace = await this.options.workspaceRegistry.get(session.workspaceId);
    const store = await this.load();
    const machine = store.machines.find((entry) => entry.machineId === session.machineId);
    if (!workspace || workspace.archivedAt) {
      return {
        kind: "deny",
        reason: "The workspace is archived; nothing was sent.",
        routingRevision: null,
      };
    }
    if (!machine || machine.removedAt || machine.disabled) {
      return {
        kind: "deny",
        reason: "The SSH machine is disabled or removed; nothing was sent.",
        routingRevision: null,
      };
    }
    if (machine.revision !== session.machineRevision) {
      return {
        kind: "deny",
        reason: "The SSH machine's connection changed; reload the agent. Nothing was sent.",
        routingRevision: null,
      };
    }
    const routing = effectiveRouting(
      machine.policy,
      store.workspaceRouting[workspace.workspaceId] ?? null,
    );
    const revision = routingRevision(routing);
    if (input.turnRevision !== null && input.turnRevision !== revision) {
      return {
        kind: "deny",
        reason:
          "Tool routing changed during this turn. Send a new message to use the updated routing; nothing was sent.",
        routingRevision: revision,
      };
    }
    if (routing.disabledTools.includes(toolName)) {
      return {
        kind: "deny",
        reason: `Tool "${toolName}" is disabled for this SSH workspace.`,
        routingRevision: revision,
      };
    }
    if (CONTROL_TOOLS.has(toolName)) return { kind: "control", routingRevision: revision };
    if ((SSH_REMOTE_TOOLS as readonly string[]).includes(toolName)) {
      if (SIDE_EFFECT_TOOLS.has(toolName) && !input.userShell) {
        const unknown = this.journal
          .unresolved(workspace.workspaceId)
          .filter((record) => record.operationId !== input.operationId);
        if (unknown.length > 0) {
          return {
            kind: "deny",
            reason: `An earlier operation on the SSH machine has an unknown outcome (${unknown[0]!.kind}${unknown[0]!.path ? ` ${unknown[0]!.path}` : ""}). Paseo stopped automatic changes until the user confirms it in Paseo (Files → Operations).`,
            routingRevision: revision,
          };
        }
      }
      return { kind: "remote", routingRevision: revision };
    }
    if (
      routing.localTools.includes(toolName) ||
      matchesLocalMcp(toolName, routing.localMcpServers)
    ) {
      return { kind: "local", routingRevision: revision };
    }
    return {
      kind: "deny",
      reason: `Tool "${toolName}" has no SSH implementation and is not routed to the owner computer for this workspace. Nothing was executed.`,
      routingRevision: revision,
    };
  }

  private async bridgeOperation(
    session: SessionToken,
    body: Record<string, unknown>,
    context: SshBridgeRequestContext,
  ): Promise<Record<string, unknown>> {
    const op = parseOperation(body);
    if ("error" in op) return { error: op.error };
    const decision = await this.decide(session, op.toolName, {
      turnRevision: op.turnRevision,
      userShell: op.userShell,
    });
    if (decision.kind !== "remote") {
      return {
        outcome: "not_sent",
        error: decision.kind === "deny" ? decision.reason : "Not a remote tool",
      };
    }
    const { machine } = await this.resolveWorkspaceForRemote(session.workspaceId);
    const argv = buildSshArgv(machine.target, this.files);
    const sideEffect = op.kind === "write" || op.kind === "mkdir" || op.kind === "exec";
    if (!sideEffect) {
      const result = await runRemote(argv, op.script, {
        signal: context.signal,
        stdin: op.stdin,
        timeoutMs: 120_000,
        maxStdoutBytes: 256 * 1024 * 1024,
      });
      return resultToBridge(result);
    }

    const base: SshOperationRecord = {
      operationId: op.operationId,
      kind: op.kind,
      state: "admitted",
      machineId: machine.machineId,
      machineRevision: machine.revision,
      routingRevision: decision.routingRevision,
      path: op.path,
      exitCode: null,
      detail: null,
      at: new Date().toISOString(),
      fingerprint: op.fingerprint,
    };
    // Claiming the id is synchronous, so two concurrent requests with one id send once.
    // Recording the intent comes first; if it fails, nothing is sent.
    let claim: Awaited<ReturnType<SshOperationJournal["reserve"]>>;
    try {
      claim = await this.journal.reserve(session.workspaceId, base);
    } catch (error) {
      return { outcome: "not_sent", error: `${describeError(error)} Nothing was sent.` };
    }
    if (!claim.reserved) {
      const existing = claim.existing;
      if (existing.fingerprint !== op.fingerprint) {
        return {
          outcome: "not_sent",
          error: "Operation id reused with different input; nothing was sent.",
        };
      }
      return {
        outcome: existing.state === "completed" ? "duplicate" : existing.state,
        exitCode: existing.exitCode,
        error: `Operation ${op.operationId} was already ${existing.state}; Paseo does not send it again.`,
      };
    }
    let sent = false;
    // Config changes run in the same queue. Re-checking there right before spawning means a
    // disable, policy change or removal that landed while the intent was persisted wins. Only
    // the spawn happens in the queue; the SSH run itself does not hold it.
    const started = await this.enqueue(async () => {
      const again = await this.decide(session, op.toolName, {
        turnRevision: op.turnRevision,
        userShell: op.userShell,
        operationId: op.operationId,
      });
      if (again.kind !== "remote") {
        return { refused: again.kind === "deny" ? again.reason : "Not a remote tool" };
      }
      const current = await this.resolveWorkspaceForRemote(session.workspaceId).catch(() => null);
      if (!current) return { refused: "The SSH machine is unavailable; nothing was sent." };
      if (current.machine.revision !== machine.revision) {
        return { refused: "The SSH machine changed; nothing was sent." };
      }
      // Archiving runs outside this queue; this is the last read before the spawn.
      const latest = await this.options.workspaceRegistry.get(session.workspaceId);
      if (!latest || latest.archivedAt) {
        return { refused: "The workspace is archived; nothing was sent." };
      }
      return {
        run: runRemote(argv, op.script, {
          signal: context.signal,
          stdin: op.stdin,
          timeoutMs: op.timeoutMs,
          onSent: () => {
            sent = true;
            void this.journal
              .write(session.workspaceId, { ...base, state: "sent", at: new Date().toISOString() })
              .catch(() => undefined);
          },
          ...(op.kind === "exec"
            ? {
                onStdout: (data: Buffer) =>
                  context.send({ type: "data", data: data.toString("base64") }),
                onStderr: (data: Buffer) =>
                  context.send({ type: "data", data: data.toString("base64") }),
              }
            : {}),
        }),
      };
    });
    if ("refused" in started) {
      await this.recordFinal(session.workspaceId, {
        ...base,
        state: "not_sent",
        detail: started.refused ?? null,
        at: new Date().toISOString(),
      });
      return { outcome: "not_sent", error: started.refused ?? "Refused; nothing was sent." };
    }
    const result = await started.run;
    const final: SshOperationRecord = {
      ...base,
      at: new Date().toISOString(),
      state: result.outcome.kind,
      exitCode: result.outcome.kind === "completed" ? result.outcome.exitCode : null,
      detail: result.outcome.kind === "completed" ? null : result.outcome.reason,
    };
    if (!sent && result.outcome.kind !== "not_sent") final.state = "unknown";
    const recorded = await this.recordFinal(session.workspaceId, final);
    const origin = {
      machineId: machine.machineId,
      machineRevision: machine.revision,
      routingRevision: decision.routingRevision,
      path: op.path,
    };
    if (!recorded) {
      // The client must not be told more than the journal holds. The operation stays
      // unresolved and blocks further automatic changes.
      return {
        outcome: "unknown",
        error:
          "The result could not be recorded, so Paseo treats this operation as unknown and stopped automatic changes.",
        origin,
      };
    }
    return { ...resultToBridge(result), origin };
  }

  // Persists a final state. On failure the in-memory record becomes unknown, which blocks
  // side effects, and the failure is logged rather than reported as a normal result.
  private async recordFinal(workspaceId: string, record: SshOperationRecord): Promise<boolean> {
    try {
      await this.journal.write(workspaceId, record);
      return true;
    } catch (error) {
      this.options.logger.error({ err: error }, "failed to record SSH operation result");
      this.journal.markUnrecorded(workspaceId, record.operationId);
      return false;
    }
  }

  async acknowledgeOperations(
    workspaceId: string,
    operations: ReadonlyArray<{ operationId: string; at: string }>,
  ): Promise<{ acknowledged: string[]; stale: string[] }> {
    await this.requireSshWorkspace(workspaceId);
    return this.journal.acknowledge(
      workspaceId,
      operations,
      "A person confirmed the outcome in Paseo.",
    );
  }

  // ---- store ----

  private async activeWorkspaceIds(machineId: string): Promise<string[]> {
    const workspaces = await this.options.workspaceRegistry.listActive();
    return workspaces
      .filter((workspace) => !workspace.archivedAt)
      .filter((workspace) => workspace.executionLocation?.machineId === machineId)
      .map((workspace) => workspace.workspaceId);
  }

  private async referencingWorkspaceIds(machineId: string): Promise<string[]> {
    const workspaces = await this.options.workspaceRegistry.listAll();
    return workspaces
      .filter((workspace) => workspace.executionLocation?.machineId === machineId)
      .map((workspace) => workspace.workspaceId);
  }

  private async toWire(machine: StoredMachine, access: SshRequestAccess): Promise<SshMachine> {
    const connection = this.connections.get(machine.machineId);
    let current: SshMachineConnection = { state: "not_checked", revision: machine.revision };
    if (machine.disabled || machine.removedAt) {
      current = { state: "disabled", revision: machine.revision };
    } else if (connection && connection.revision === machine.revision) {
      current = connection;
    }
    const base = {
      machineId: machine.machineId,
      serverId: this.options.serverId,
      displayName: machine.displayName,
      revision: machine.revision,
      disabled: machine.disabled,
      createdAt: machine.createdAt,
      updatedAt: machine.updatedAt,
      activeWorkspaceIds: await this.activeWorkspaceIds(machine.machineId),
    };
    if (!access.fullConfig) {
      return {
        ...base,
        access: "summary",
        connection: { state: current.state, revision: current.revision },
      };
    }
    return {
      ...base,
      access: "full",
      target: machine.target,
      connection: current,
      policy: machine.policy,
    };
  }

  private setConnection(machineId: string, connection: SshMachineConnection): void {
    const existing = this.connections.get(machineId);
    // Late results from an older revision never overwrite a newer observation.
    if (existing && existing.revision > connection.revision) return;
    this.connections.set(machineId, connection);
  }

  private async requireMachine(
    machineId: string,
    options?: { includeRemoved?: boolean },
  ): Promise<StoredMachine> {
    const machine = (await this.load()).machines.find((entry) => entry.machineId === machineId);
    if (!machine || (machine.removedAt && !options?.includeRemoved)) {
      throw new Error("SSH machine not found");
    }
    return machine;
  }

  private async load(): Promise<Store> {
    if (this.store) return this.store;
    try {
      const raw = await readFile(this.storeFile, "utf8");
      this.store = StoreSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      this.store = { version: 1, machines: [], workspaceRouting: {} };
    }
    return this.store;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // Applies a change to a copy and persists it before it becomes the daemon's state, so a
  // failed write never leaves the bridge deciding from unsaved rules.
  // `prepare` runs inside the queue first, so facts it reads (such as which workspaces use a
  // machine; workspace creation also runs in this queue) cannot change before `change`.
  private mutate<T, P = undefined>(
    change: (store: Store, prepared: P) => T,
    prepare?: () => Promise<P>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const prepared = (prepare ? await prepare() : undefined) as P;
      const store = structuredClone(await this.load());
      const result = change(store, prepared);
      await mkdir(this.options.paseoHome, { recursive: true });
      await writeFileAtomic(this.storeFile, `${JSON.stringify(store, null, 2)}\n`);
      this.store = store;
      return result;
    });
  }
}

function routingRevision(routing: SshEffectiveRouting): string {
  return `${routing.machineRevision}.${routing.workspaceRevision}`;
}

export function effectiveRouting(
  policy: z.infer<typeof PolicySchema>,
  override: StoredOverride | null,
): SshEffectiveRouting {
  const pick = <T>(value: T | null | undefined, fallback: T) =>
    value === null || value === undefined
      ? { value: fallback, source: "machine" as const }
      : { value, source: "workspace" as const };
  const localTools = pick(override?.localTools, policy.localTools);
  const disabledTools = pick(override?.disabledTools, policy.disabledTools);
  const localSkills = pick(override?.localSkills, policy.localSkills);
  const localMcpServers = pick(override?.localMcpServers, policy.localMcpServers);
  return {
    machineRevision: policy.revision,
    workspaceRevision: override?.revision ?? 0,
    localTools: localTools.value,
    disabledTools: disabledTools.value,
    localSkills: localSkills.value,
    localMcpServers: localMcpServers.value,
    sources: {
      localTools: localTools.source,
      disabledTools: disabledTools.source,
      localSkills: localSkills.source,
      localMcpServers: localMcpServers.source,
    },
  };
}

function toWireOverride(override: StoredOverride): SshWorkspaceRoutingOverride {
  return { ...override };
}

function matchesLocalMcp(toolName: string, servers: string[]): boolean {
  if (!toolName.startsWith("mcp__")) return false;
  const normalized = toolName.slice(5);
  return servers.some((server) =>
    normalized.startsWith(`${server.replace(/[^A-Za-z0-9_]/g, "_")}__`),
  );
}

interface ParsedOperation {
  operationId: string;
  fingerprint: string;
  toolName: string;
  turnRevision: string | null;
  userShell: boolean;
  kind: string;
  path: string | null;
  script: string;
  stdin?: Buffer;
  timeoutMs?: number;
}

interface OperationScript {
  fingerprint: string[];
  script: string;
  stdin?: Buffer;
  timeoutMs?: number;
  path?: string;
}

// Builds the remote script for a bridge operation. Paths are absolute remote paths the
// extension resolved; nothing reaches a shell except through quoting.
function parseOperation(body: Record<string, unknown>): ParsedOperation | { error: string } {
  const kind = typeof body.kind === "string" ? body.kind : "";
  const operationId = typeof body.operationId === "string" ? body.operationId : "";
  const toolName = typeof body.toolName === "string" ? body.toolName : "";
  const path = typeof body.path === "string" ? body.path : null;
  if (!operationId || !toolName) return { error: "Invalid operation" };
  if (path !== null && !path.startsWith("/")) return { error: "Remote paths must be absolute" };
  const quoted = path === null ? "" : shellQuote(path);
  const built = readOnlyScript(kind, quoted, body) ?? sideEffectScript(kind, quoted, body);
  if (!built) return { error: `Unknown operation ${kind}` };
  if ("error" in built) return built;
  return {
    operationId,
    toolName,
    turnRevision: typeof body.turnRevision === "string" ? body.turnRevision : null,
    userShell: body.userShell === true,
    kind,
    path: built.path ?? path,
    fingerprint: createHash("sha256")
      .update([kind, ...built.fingerprint].join("\0"))
      .digest("hex"),
    script: built.script,
    ...(built.stdin ? { stdin: built.stdin } : {}),
    ...(built.timeoutMs ? { timeoutMs: built.timeoutMs } : {}),
  };
}

function readOnlyScript(
  kind: string,
  p: string,
  body: Record<string, unknown>,
): OperationScript | null {
  switch (kind) {
    case "read":
      return { fingerprint: [p], script: `cat -- ${p}` };
    case "access":
      return {
        fingerprint: [p],
        script: body.write === true ? `test -r ${p} && test -w ${p}` : `test -r ${p}`,
      };
    case "exists":
      return { fingerprint: [p], script: `test -e ${p} || test -L ${p}` };
    case "stat":
      return {
        fingerprint: [p],
        script: `if [ -d ${p} ]; then echo d; elif [ -e ${p} ] || [ -L ${p} ]; then echo f; else exit 3; fi`,
      };
    case "readdir":
      return {
        fingerprint: [p],
        script: `cd -- ${p} || exit 3\nfor f in .* *; do [ "$f" = . ] || [ "$f" = .. ] && continue; [ -e "$f" ] || [ -L "$f" ] || continue; printf '%s\\0' "$f"; done`,
      };
    case "find":
      return {
        fingerprint: [p],
        script: `cd -- ${p} || exit 3\nfind . \\( -name .git -o -name node_modules \\) -prune -o -print0`,
      };
    case "grep":
      return grepScript(p, body);
    default:
      return null;
  }
}

const GREP_FLAG = /^-[A-Za-z]+$|^-C\d+$/;

function grepScript(p: string, body: Record<string, unknown>): OperationScript {
  const flags = Array.isArray(body.flags)
    ? body.flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const plain = flags.filter((flag) => GREP_FLAG.test(flag));
  const include = flags
    .filter((flag) => flag.startsWith("--include="))
    .map((flag) => shellQuote(flag));
  const pattern = typeof body.pattern === "string" ? body.pattern : "";
  return {
    fingerprint: [p, pattern],
    script: `grep ${[...plain, ...include].join(" ")} --exclude-dir=.git --exclude-dir=node_modules -e ${shellQuote(pattern)} -- ${p}`,
  };
}

function sideEffectScript(
  kind: string,
  p: string,
  body: Record<string, unknown>,
): OperationScript | { error: string } | null {
  switch (kind) {
    case "write": {
      const content = typeof body.content === "string" ? Buffer.from(body.content, "base64") : null;
      if (!content) return { error: "write needs content" };
      return {
        fingerprint: [p, createHash("sha256").update(content).digest("hex")],
        script: `cat > ${p}`,
        stdin: content,
      };
    }
    case "mkdir":
      return { fingerprint: [p], script: `mkdir -p -- ${p}` };
    case "exec":
      return execScript(body);
    default:
      return null;
  }
}

function execScript(body: Record<string, unknown>): OperationScript | { error: string } {
  const command = typeof body.command === "string" ? body.command : "";
  const cwd = typeof body.cwd === "string" && body.cwd.startsWith("/") ? body.cwd : null;
  if (!cwd) return { error: "exec needs an absolute cwd" };
  const encoded = Buffer.from(command, "utf8").toString("base64");
  const timeoutSec =
    typeof body.timeoutSec === "number" && body.timeoutSec > 0 ? body.timeoutSec : undefined;
  return {
    path: cwd,
    fingerprint: [cwd, command],
    ...(timeoutSec ? { timeoutMs: timeoutSec * 1000 } : {}),
    script: [
      `cd -- ${shellQuote(cwd)} || exit 254`,
      `__paseo_cmd=$(printf %s ${encoded} | (base64 -d 2>/dev/null || base64 -D))`,
      'if command -v bash >/dev/null 2>&1; then bash -c "$__paseo_cmd"; else sh -c "$__paseo_cmd"; fi',
    ].join("\n"),
  };
}

function resultToBridge(result: RemoteRunResult): Record<string, unknown> {
  if (result.outcome.kind === "completed") {
    return {
      outcome: "completed",
      exitCode: result.outcome.exitCode,
      stdout: result.stdout.toString("base64"),
      stderr: result.stderr,
    };
  }
  return { outcome: result.outcome.kind, error: new RemoteOutcomeError(result.outcome).message };
}

function normalizeTarget(target: SshMachineTarget): SshMachineTarget {
  return {
    host: target.host.trim(),
    user: target.user?.trim() || null,
    port: target.port ?? null,
  };
}

function sameTarget(a: SshMachineTarget, b: SshMachineTarget): boolean {
  return (
    a.host === b.host &&
    (a.user ?? null) === (b.user ?? null) &&
    (a.port ?? null) === (b.port ?? null)
  );
}

function uniqueToolNames(names: string[]): string[] {
  const result = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!TOOL_NAME.test(trimmed)) throw new Error(`Invalid tool name: ${trimmed}`);
    result.add(trimmed);
  }
  return [...result];
}

// Tools with an SSH implementation cannot be local: their local handlers would act on the
// owner's files while the model believes it is working on the machine.
function validateLocalTools(names: string[]): string[] {
  const tools = uniqueToolNames(names);
  const remote = tools.find((name) => (SSH_REMOTE_TOOLS as readonly string[]).includes(name));
  if (remote) {
    throw new Error(
      `"${remote}" always runs on the SSH machine and cannot be routed to the owner computer`,
    );
  }
  const control = tools.find((name) => CONTROL_TOOLS.has(name));
  if (control)
    throw new Error(`"${control}" is Pi control flow; the tools it calls are routed one by one`);
  return tools;
}

function uniqueMcpServers(names: string[]): string[] {
  const result = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!MCP_SERVER_NAME.test(trimmed)) throw new Error(`Invalid MCP server name: ${trimmed}`);
    result.add(trimmed);
  }
  return [...result];
}

function assertNoConflict(localTools: string[], disabledTools: string[]): void {
  const conflict = localTools.find((name) => disabledTools.includes(name));
  if (conflict) throw new Error(`Tool "${conflict}" cannot be both local and disabled`);
}

function isValidUtf8(data: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    // A preview cut in the middle of a character is still text.
    if (data.length < 4) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, data.length - 3));
      return true;
    } catch {
      return false;
    }
  }
}

function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 20_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) reject(error);
      else resolve(String(stdout));
    });
  });
}

function describeError(error: unknown): string {
  if (error instanceof SshTransportError) return `${error.problem}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function errorResponse(msg: SshInboundMessage, error: string): SshOutboundMessage {
  const requestId = msg.requestId;
  switch (msg.type) {
    case "ssh.machine.list.request":
      return { type: "ssh.machine.list.response", payload: { requestId, error, machines: [] } };
    case "ssh.machine.save.request":
      return { type: "ssh.machine.save.response", payload: { requestId, error, machine: null } };
    case "ssh.machine.remove.request":
      return {
        type: "ssh.machine.remove.response",
        payload: {
          requestId,
          error,
          machineId: msg.machineId,
          removed: false,
          blockingWorkspaceIds: [],
        },
      };
    case "ssh.machine.check.request":
      return { type: "ssh.machine.check.response", payload: { requestId, error, machine: null } };
    case "ssh.machine.trust.request":
      return { type: "ssh.machine.trust.response", payload: { requestId, error, machine: null } };
    case "ssh.machine.policy.set.request":
      return {
        type: "ssh.machine.policy.set.response",
        payload: { requestId, error, machine: null },
      };
    case "ssh.workspace.create.request":
      return {
        type: "ssh.workspace.create.response",
        payload: { requestId, error, workspaceId: null, directory: null },
      };
    case "ssh.workspace.files.list.request":
      return {
        type: "ssh.workspace.files.list.response",
        payload: {
          requestId,
          error,
          workspaceId: msg.workspaceId,
          machineId: null,
          path: null,
          entries: [],
        },
      };
    case "ssh.workspace.files.read.request":
      return {
        type: "ssh.workspace.files.read.response",
        payload: {
          requestId,
          error,
          workspaceId: msg.workspaceId,
          machineId: null,
          path: null,
          text: null,
          binary: false,
          size: null,
          truncated: false,
        },
      };
    case "ssh.workspace.routing.get.request":
      return {
        type: "ssh.workspace.routing.get.response",
        payload: {
          requestId,
          error,
          workspaceId: msg.workspaceId,
          override: null,
          effective: null,
        },
      };
    case "ssh.workspace.routing.set.request":
      return {
        type: "ssh.workspace.routing.set.response",
        payload: {
          requestId,
          error,
          workspaceId: msg.workspaceId,
          override: null,
          effective: null,
        },
      };
    case "ssh.workspace.operations.list.request":
      return {
        type: "ssh.workspace.operations.list.response",
        payload: { requestId, error, workspaceId: msg.workspaceId, operations: [] },
      };
    case "ssh.workspace.operations.acknowledge.request":
      return {
        type: "ssh.workspace.operations.acknowledge.response",
        payload: { requestId, error, workspaceId: msg.workspaceId, acknowledged: [], stale: [] },
      };
  }
}

export type { SshToolRoutingPolicy };
