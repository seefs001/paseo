import { z } from "zod";

// SSH machines are execution targets owned by one daemon. They are not Paseo hosts:
// serverId keeps naming the daemon, machineId only names where tools execute.

export const SshMachineTargetSchema = z.object({
  // OpenSSH alias or hostname, resolved by the owner daemon's OpenSSH config.
  host: z.string(),
  user: z.string().nullable().optional(),
  port: z.number().int().nullable().optional(),
});
export type SshMachineTarget = z.infer<typeof SshMachineTargetSchema>;

export const SshMachineConnectionStateSchema = z.enum([
  "not_checked",
  "checking",
  "needs_trust",
  "ready",
  "needs_attention",
  "disabled",
]);
export type SshMachineConnectionState = z.infer<typeof SshMachineConnectionStateSchema>;

export const SshMachineProblemSchema = z.enum([
  "ssh_missing",
  "host_key_unknown",
  "host_key_changed",
  "auth_failed",
  "unreachable",
  "remote_command_missing",
  "unsupported_remote",
  "failed",
]);
export type SshMachineProblem = z.infer<typeof SshMachineProblemSchema>;

export const SshMachineProbeSchema = z.object({
  os: z.string(),
  shell: z.string(),
  home: z.string(),
  user: z.string(),
  hasGit: z.boolean(),
});
export type SshMachineProbe = z.infer<typeof SshMachineProbeSchema>;

export const SshHostKeyCandidateSchema = z.object({
  fingerprints: z.array(z.string()),
  // Identifies this candidate; trust requests must echo it.
  candidateId: z.string(),
});

export const SshMachineConnectionSchema = z.object({
  state: SshMachineConnectionStateSchema,
  problem: SshMachineProblemSchema.nullable().optional(),
  detail: z.string().nullable().optional(),
  checkedAt: z.string().nullable().optional(),
  // Revision of the connection settings this observation belongs to.
  revision: z.number().int(),
  probe: SshMachineProbeSchema.nullable().optional(),
  hostKey: SshHostKeyCandidateSchema.nullable().optional(),
});
export type SshMachineConnection = z.infer<typeof SshMachineConnectionSchema>;

// Tool routing: every task tool runs on the machine unless a rule names it.
export const SshToolRoutingPolicySchema = z.object({
  revision: z.number().int(),
  // Tools executed by their original owner-side implementation. Tools that have an SSH
  // implementation (read, write, edit, bash, ls, find, grep) cannot be listed here.
  localTools: z.array(z.string()),
  // Tools refused in every location.
  disabledTools: z.array(z.string()),
  // Loaded Pi skills and their reference files are read from the owner computer, read-only.
  localSkills: z.boolean(),
  // MCP servers from the owner's Pi config that connect for SSH sessions and whose tools run
  // from the owner computer. Other configured servers are not started.
  localMcpServers: z.array(z.string()).optional(),
});
export type SshToolRoutingPolicy = z.infer<typeof SshToolRoutingPolicySchema>;

// A workspace override replaces single fields of the machine default. Null keeps the default.
export const SshWorkspaceRoutingOverrideSchema = z.object({
  revision: z.number().int(),
  localTools: z.array(z.string()).nullable(),
  disabledTools: z.array(z.string()).nullable(),
  localSkills: z.boolean().nullable(),
  localMcpServers: z.array(z.string()).nullable().optional(),
});
export type SshWorkspaceRoutingOverride = z.infer<typeof SshWorkspaceRoutingOverrideSchema>;

export const SshRoutingSourceSchema = z.enum(["machine", "workspace"]);

export const SshEffectiveRoutingSchema = z.object({
  machineRevision: z.number().int(),
  workspaceRevision: z.number().int(),
  localTools: z.array(z.string()),
  disabledTools: z.array(z.string()),
  localSkills: z.boolean(),
  localMcpServers: z.array(z.string()),
  sources: z.object({
    localTools: SshRoutingSourceSchema,
    disabledTools: SshRoutingSourceSchema,
    localSkills: SshRoutingSourceSchema,
    localMcpServers: SshRoutingSourceSchema,
  }),
});
export type SshEffectiveRouting = z.infer<typeof SshEffectiveRoutingSchema>;

export const SshMachineSchema = z.object({
  machineId: z.string(),
  serverId: z.string(),
  displayName: z.string(),
  // "summary" omits the connection target and routing policy; they need daemon.read.
  access: z.enum(["summary", "full"]).optional(),
  target: SshMachineTargetSchema.optional(),
  revision: z.number().int(),
  disabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  connection: SshMachineConnectionSchema,
  policy: SshToolRoutingPolicySchema.optional(),
  // Workspaces that still reference the machine.
  activeWorkspaceIds: z.array(z.string()),
});
export type SshMachine = z.infer<typeof SshMachineSchema>;

export const WorkspaceExecutionLocationSchema = z.object({
  kind: z.literal("ssh"),
  machineId: z.string(),
  machineDisplayName: z.string().optional(),
  // Absolute POSIX directory on the machine.
  directory: z.string(),
  // Directory identity shared by every workspace on the same machine directory. The
  // descriptor's workspaceDirectory and projectRootPath carry it too; it is not a local path.
  key: z.string().optional(),
  // Git as last observed on the machine. "unobserved" is not a claim that it is not Git.
  gitObservation: z.enum(["unobserved", "git", "not_git", "failed"]).optional(),
});
export type WorkspaceExecutionLocation = z.infer<typeof WorkspaceExecutionLocationSchema>;

export const SshRemoteEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory", "symlink", "other"]),
  size: z.number().nullable(),
});
export type SshRemoteEntry = z.infer<typeof SshRemoteEntrySchema>;

const RequestBase = { requestId: z.string() };
const ResponseBase = { requestId: z.string(), error: z.string().nullable() };

export const SshMachineListRequestSchema = z.object({
  type: z.literal("ssh.machine.list.request"),
  ...RequestBase,
});
export const SshMachineListResponseSchema = z.object({
  type: z.literal("ssh.machine.list.response"),
  payload: z.object({ ...ResponseBase, machines: z.array(SshMachineSchema) }),
});

export const SshMachineSaveRequestSchema = z.object({
  type: z.literal("ssh.machine.save.request"),
  ...RequestBase,
  // Absent creates a machine.
  machineId: z.string().optional(),
  expectedRevision: z.number().int().optional(),
  displayName: z.string(),
  target: SshMachineTargetSchema,
  disabled: z.boolean().optional(),
});
export const SshMachineRemoveRequestSchema = z.object({
  type: z.literal("ssh.machine.remove.request"),
  ...RequestBase,
  machineId: z.string(),
});
export const SshMachineCheckRequestSchema = z.object({
  type: z.literal("ssh.machine.check.request"),
  ...RequestBase,
  machineId: z.string(),
});
export const SshMachineTrustRequestSchema = z.object({
  type: z.literal("ssh.machine.trust.request"),
  ...RequestBase,
  machineId: z.string(),
  revision: z.number().int(),
  candidateId: z.string(),
});
export const SshMachinePolicySetRequestSchema = z.object({
  type: z.literal("ssh.machine.policy.set.request"),
  ...RequestBase,
  machineId: z.string(),
  expectedRevision: z.number().int(),
  localTools: z.array(z.string()),
  disabledTools: z.array(z.string()),
  localSkills: z.boolean(),
  localMcpServers: z.array(z.string()).optional(),
});

const SshMachineMutationPayload = z.object({
  ...ResponseBase,
  machine: SshMachineSchema.nullable(),
});
export const SshMachineSaveResponseSchema = z.object({
  type: z.literal("ssh.machine.save.response"),
  payload: SshMachineMutationPayload,
});
export const SshMachineRemoveResponseSchema = z.object({
  type: z.literal("ssh.machine.remove.response"),
  payload: z.object({
    ...ResponseBase,
    machineId: z.string(),
    removed: z.boolean(),
    blockingWorkspaceIds: z.array(z.string()),
  }),
});
export const SshMachineCheckResponseSchema = z.object({
  type: z.literal("ssh.machine.check.response"),
  payload: SshMachineMutationPayload,
});
export const SshMachineTrustResponseSchema = z.object({
  type: z.literal("ssh.machine.trust.response"),
  payload: SshMachineMutationPayload,
});
export const SshMachinePolicySetResponseSchema = z.object({
  type: z.literal("ssh.machine.policy.set.response"),
  payload: SshMachineMutationPayload,
});

export const SshWorkspaceCreateRequestSchema = z.object({
  type: z.literal("ssh.workspace.create.request"),
  ...RequestBase,
  machineId: z.string(),
  directory: z.string(),
  title: z.string().optional(),
});
export const SshWorkspaceCreateResponseSchema = z.object({
  type: z.literal("ssh.workspace.create.response"),
  payload: z.object({
    ...ResponseBase,
    workspaceId: z.string().nullable(),
    directory: z.string().nullable(),
  }),
});

export const SshWorkspaceFilesListRequestSchema = z.object({
  type: z.literal("ssh.workspace.files.list.request"),
  ...RequestBase,
  workspaceId: z.string(),
  // Relative to the workspace directory, or absolute on the machine.
  path: z.string(),
});
export const SshWorkspaceFilesListResponseSchema = z.object({
  type: z.literal("ssh.workspace.files.list.response"),
  payload: z.object({
    ...ResponseBase,
    workspaceId: z.string(),
    machineId: z.string().nullable(),
    path: z.string().nullable(),
    entries: z.array(SshRemoteEntrySchema),
  }),
});

export const SshWorkspaceFilesReadRequestSchema = z.object({
  type: z.literal("ssh.workspace.files.read.request"),
  ...RequestBase,
  workspaceId: z.string(),
  path: z.string(),
});
export const SshWorkspaceFilesReadResponseSchema = z.object({
  type: z.literal("ssh.workspace.files.read.response"),
  payload: z.object({
    ...ResponseBase,
    workspaceId: z.string(),
    machineId: z.string().nullable(),
    path: z.string().nullable(),
    // Null when the file is binary; only UTF-8 text previews are supported.
    text: z.string().nullable(),
    binary: z.boolean(),
    size: z.number().nullable(),
    truncated: z.boolean(),
  }),
});

export const SshWorkspaceRoutingGetRequestSchema = z.object({
  type: z.literal("ssh.workspace.routing.get.request"),
  ...RequestBase,
  workspaceId: z.string(),
});
export const SshWorkspaceRoutingSetRequestSchema = z.object({
  type: z.literal("ssh.workspace.routing.set.request"),
  ...RequestBase,
  workspaceId: z.string(),
  expectedRevision: z.number().int(),
  localTools: z.array(z.string()).nullable(),
  disabledTools: z.array(z.string()).nullable(),
  localSkills: z.boolean().nullable(),
  localMcpServers: z.array(z.string()).nullable().optional(),
});
const SshWorkspaceRoutingPayload = z.object({
  ...ResponseBase,
  workspaceId: z.string(),
  override: SshWorkspaceRoutingOverrideSchema.nullable(),
  effective: SshEffectiveRoutingSchema.nullable(),
});
export const SshWorkspaceRoutingGetResponseSchema = z.object({
  type: z.literal("ssh.workspace.routing.get.response"),
  payload: SshWorkspaceRoutingPayload,
});
export const SshWorkspaceRoutingSetResponseSchema = z.object({
  type: z.literal("ssh.workspace.routing.set.response"),
  payload: SshWorkspaceRoutingPayload,
});

export const SshOperationSchema = z.object({
  operationId: z.string(),
  kind: z.string(),
  state: z.enum(["admitted", "sent", "completed", "not_sent", "unknown", "acknowledged"]),
  machineId: z.string(),
  machineRevision: z.number().int(),
  routingRevision: z.string(),
  path: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  detail: z.string().nullable(),
  at: z.string(),
});
export type SshOperation = z.infer<typeof SshOperationSchema>;

export const SshWorkspaceOperationsListRequestSchema = z.object({
  type: z.literal("ssh.workspace.operations.list.request"),
  ...RequestBase,
  workspaceId: z.string(),
});
export const SshWorkspaceOperationsListResponseSchema = z.object({
  type: z.literal("ssh.workspace.operations.list.response"),
  payload: z.object({
    ...ResponseBase,
    workspaceId: z.string(),
    operations: z.array(SshOperationSchema),
  }),
});

// A person confirms unknown outcomes they saw. Each entry carries the `at` of the state
// shown; entries that changed since are reported as stale and left unresolved.
export const SshWorkspaceOperationsAcknowledgeRequestSchema = z.object({
  type: z.literal("ssh.workspace.operations.acknowledge.request"),
  ...RequestBase,
  workspaceId: z.string(),
  operations: z.array(z.object({ operationId: z.string(), at: z.string() })),
});
export const SshWorkspaceOperationsAcknowledgeResponseSchema = z.object({
  type: z.literal("ssh.workspace.operations.acknowledge.response"),
  payload: z.object({
    ...ResponseBase,
    workspaceId: z.string(),
    acknowledged: z.array(z.string()),
    stale: z.array(z.string()),
  }),
});

export const SshInboundMessageSchemas = [
  SshMachineListRequestSchema,
  SshMachineSaveRequestSchema,
  SshMachineRemoveRequestSchema,
  SshMachineCheckRequestSchema,
  SshMachineTrustRequestSchema,
  SshMachinePolicySetRequestSchema,
  SshWorkspaceCreateRequestSchema,
  SshWorkspaceFilesListRequestSchema,
  SshWorkspaceFilesReadRequestSchema,
  SshWorkspaceRoutingGetRequestSchema,
  SshWorkspaceRoutingSetRequestSchema,
  SshWorkspaceOperationsListRequestSchema,
  SshWorkspaceOperationsAcknowledgeRequestSchema,
] as const;

export type SshInboundMessage =
  | z.infer<typeof SshMachineListRequestSchema>
  | z.infer<typeof SshMachineSaveRequestSchema>
  | z.infer<typeof SshMachineRemoveRequestSchema>
  | z.infer<typeof SshMachineCheckRequestSchema>
  | z.infer<typeof SshMachineTrustRequestSchema>
  | z.infer<typeof SshMachinePolicySetRequestSchema>
  | z.infer<typeof SshWorkspaceCreateRequestSchema>
  | z.infer<typeof SshWorkspaceFilesListRequestSchema>
  | z.infer<typeof SshWorkspaceFilesReadRequestSchema>
  | z.infer<typeof SshWorkspaceRoutingGetRequestSchema>
  | z.infer<typeof SshWorkspaceRoutingSetRequestSchema>
  | z.infer<typeof SshWorkspaceOperationsListRequestSchema>
  | z.infer<typeof SshWorkspaceOperationsAcknowledgeRequestSchema>;

export type SshOutboundMessage =
  | z.infer<typeof SshMachineListResponseSchema>
  | z.infer<typeof SshMachineSaveResponseSchema>
  | z.infer<typeof SshMachineRemoveResponseSchema>
  | z.infer<typeof SshMachineCheckResponseSchema>
  | z.infer<typeof SshMachineTrustResponseSchema>
  | z.infer<typeof SshMachinePolicySetResponseSchema>
  | z.infer<typeof SshWorkspaceCreateResponseSchema>
  | z.infer<typeof SshWorkspaceFilesListResponseSchema>
  | z.infer<typeof SshWorkspaceFilesReadResponseSchema>
  | z.infer<typeof SshWorkspaceRoutingGetResponseSchema>
  | z.infer<typeof SshWorkspaceRoutingSetResponseSchema>
  | z.infer<typeof SshWorkspaceOperationsListResponseSchema>
  | z.infer<typeof SshWorkspaceOperationsAcknowledgeResponseSchema>;
