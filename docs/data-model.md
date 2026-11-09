# Data Model

## Project identity

Projects are allocated for the exact root selected by the caller, normalized lexically with `path.resolve` (never `realpath`). New project IDs are opaque `prj_<16 hex>` values. Existing remote-shaped or path-shaped IDs are retained as readable compatibility records and are never rekeyed. An active exact root is idempotent; archived-only matches do not resurrect an old project. Workspace `projectId` is stable membership: reconciliation may update git-derived kind and branch metadata, but never rehomes a workspace or changes a project's root, ID, or default name.

`projectKey` is a persisted, opaque equivalence key used only to group the same logical project
across hosts. It is separate from the host-local `projectId`; today's producer prefers a normalized
Git remote and otherwise uses the local project root. Consumers never derive it from live Git.
Creation persists it with the project, and normal boot reconciliation fills it for
older records where the field is absent—there is no migration.

`kind` and `projectKey` are mutable metadata, not identity. Workspace reconciliation watches active project roots and
updates those fields and `updatedAt` when Git facts change, preserving the project's ID, root path,
names, and workspace foreign keys. Attached workspaces are independently refreshed
from their own cwd, so an explicit project root never implies a workspace checkout. Empty projects
are observed too.

The workspace registry model defines placement once: initial directory/worktree construction,
mutable reconciliation fields, and the persisted-to-wire checkout projection. Its update policy
preserves `displayName` and `baseBranch`. `WorkspaceProvisioningService` owns the corresponding
registry writes, so directory opens, agent imports, and worktree creation all enter through that
service instead of constructing records independently. The workspace record is then the durable
placement authority: `cwd` is the exact execution directory, while `worktreeRoot` is the backing
checkout root. They intentionally differ for an exact subproject inside a worktree. Archive,
restore, branch auto-name, and descriptor flows consume those persisted facts rather than
rediscovering ownership from a directory that may already be gone. Reconciliation may refresh
mutable placement facts, but never changes `projectId`, `cwd`, `displayName`, or `baseBranch`.
An explicit base selection is stored in the checkout's Git-directory Paseo metadata and
mirrored to `baseBranch` in every workspace record sharing that checkout. The record keeps
recovery possible after the checkout metadata is deleted. A newly opened workspace inherits
the checkout's selected base; separate worktrees keep separate bases.
An explicit **Change project** operation may replace one active workspace's `projectId` with
another active project on the same host, or with `null` for **No project**. Explicit `null`
is durable membership, not missing data to infer from the directory. You can also create an
[unassigned workspace](../public-docs/workspaces.md#creating-a-workspace) directly. A missing referenced project
remains an error; it is not treated as user-requested unassignment. This changes grouping, not the filesystem: execution
directory, checkout ownership, workspace identity, conversations, terminals, tabs, pins and
resident status stay unchanged. Same-directory siblings keep their membership. Schedules retain
their workspace and conversation references; independent Board task and Goal project links do
not move. Reconciliation and restart preserve the selected membership.

Project settings refer to the newly selected project's root. Workspace scripts and process
environment still come from the workspace's original directory. Running services keep their
registered addresses; services started afterward use the selected project's address prefix,
or the directory-based fallback when unassigned. Project settings and project-scoped creation
actions require selecting a project. The operation requires `workspace.manage`, like other
workspace metadata changes.

Unassigned workspaces remain visible in the **No project** group with a chat icon. This group
is a client view, not a Project record. Changing membership requires the
`workspaceProjectChange` host capability. Both app and host need updating for unassigned-workspace
support; older clients can parse messages but need not display unassigned workspaces correctly.
See [protocol compatibility](protocol-compatibility.md) for the wire contract.

Workspace archive runs lifecycle teardown from the exact `cwd` but removes only the backing
`worktreeRoot` after its last active reference disappears. Worktree recovery recreates that backing
checkout from `mainRepoRoot`, then restores the relative path from `worktreeRoot` to `cwd`.

Paseo uses **file-based JSON persistence** instead of a traditional database. All data is validated at runtime with Zod schemas. Most stores write atomically (write to temp file, then rename); a few still use plain `writeFile` — see each section. There is no schema-versioning/migration framework — schemas rely on optional fields with defaults for forward compatibility, with a small amount of inline normalization in `persisted-config.ts` for legacy provider/speech entries.

All server-side stores live under `$PASEO_HOME` (defaults to `~/.paseo`).

## Store Surface Rules

Store APIs own persistence atomicity and should not make services coordinate raw reads and writes. A good store method maps cleanly to one SQL statement or one SQL transaction, even when the current implementation is JSON files. If a caller needs a queue, lock, read-merge-write loop, or uniqueness race workaround, that behavior belongs behind the store surface.

---

## Directory layout

```
$PASEO_HOME/
├── config.json                          # Daemon configuration
├── server-id                            # Stable daemon identifier (plain text, "srv_<base64url>")
├── daemon-keypair.json                  # E2EE keypair for relay (mode 0600)
├── paseo.pid                            # Daemon PID lock file
├── local-credential                     # Per-run local client credential (mode 0600)
├── daemon.log                           # Default log file (path configurable)
├── agents/
│   └── {sanitized-cwd}/
│       └── {agentId}.json               # One file per agent
├── schedules/
│   └── {scheduleId}.json                # One file per schedule
├── workspace-trace.jsonl                # Current bounded causal-metadata segment
├── workspace-trace.jsonl.previous       # Previous segment, replaced on rotation
├── artifacts/
│   ├── index.json                       # Artifacts collection, every workspace on the host
│   └── files/{artifactId}/{fileName}    # The daemon's copy of each artifact's content
├── board/
│   ├── tasks.json                       # Host-local Desk tasks
│   ├── goals.json                       # Goals with their Autopilot settings
│   ├── decisions.json                   # Open and recently answered decisions
│   └── desk.json                        # Desk settings and snoozes
├── projects/
│   ├── projects.json                    # Project registry
│   ├── workspaces.json                  # Workspace registry
│   ├── workspace-labels.json            # Shared host-local label catalog
│   ├── workspace-labels.transaction.json # Recoverable catalog/assignment compound commit
│   └── icons/                           # Host-local custom project icon images
├── runtime/
│   └── managed-processes/
│       └── {recordId}.json              # Helper processes owned by Paseo; reconciled on daemon bootstrap
├── plugins/
│   ├── sources.json                      # Managed kind and Git acquisition remote
│   └── {pluginId}/{uuid}/                # Git checkout or npm package/lockfile/dependency tree
└── push-tokens.json                     # Expo push notification tokens
```

The `agents/{sanitized-cwd}/` directory name is derived from the agent's `cwd` by stripping the filesystem root and replacing path separators with `-` (Windows drive letters become a `C-` style prefix). Persistent server stores write atomically by writing a temp file in the target directory and then renaming it into place.

---

## Workspace Trace

Workspace Trace records causal metadata, not transcripts or task ownership. Provider history remains
the transcript authority. Prompt XML and tool-result text cannot establish trusted sender identity:
users can quote envelopes, and nested tool calls need not print their receipts. The daemon records
agent-tool admission, delegation, delivery batches and finish-watch origins at their owning boundaries.
Client-supplied source fields do not become trusted sender records.

The journal retains two segments of at most 2 MiB each. Writes are serialized asynchronously;
Trace reads and graceful shutdown drain the writer. A crash can lose an unwritten tail or an in-memory
message queue. Missing acknowledgment means unknown dispatch, not failure or success. Recording
failure does not fail message delivery. The view reports history, retention, recording and pending
coverage gaps; it never claims complete older history. No message bodies, tool arguments or exception
text are copied into this journal.

A dispatch records all admitted message IDs and the actual steer/interruption outcome. It does not
prove the provider completed the work. Finish-watch origins associate a notification with a creation
or send subscription, not with a particular completed turn. Recovered notifications can repeat.
Current parent labels remain ownership metadata after detach; they never reconstruct delegation.

Queries stay inside one workspace, including workspaces without a project. Cross-workspace and
cross-host endpoints do not recursively load history or expose external titles. `workspace.read`
authorizes the read through the ordinary direct or routed session. The result contains at most 200
nodes; a batch that cannot fit all its source nodes retains its full message-ID list and reports a
window gap. Focus views preserve multiple inputs instead of choosing a task root.

The IDs of recorded events survive restart. Received-message navigation uses the deterministic
`paseo-agent-message:<deliveryId>` call ID, not a provider message ID or a timeline cursor. With no
exact anchor, open the conversation without claiming to locate a source. Event timestamps and
runtime source-turn observations do not establish historical turn durations.

## 1. Agent Record

**Path:** `$PASEO_HOME/agents/{project-dir}/{agentId}.json`

Each agent is stored as a separate JSON file, grouped by project directory.

| Field                | Type                                     | Description                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `string`                                 | UUID, primary key                                                                                                                                                                                                                                                                                                                                                                   |
| `provider`           | `string`                                 | Agent provider (`"claude"`, `"codex"`, `"opencode"`, etc.)                                                                                                                                                                                                                                                                                                                          |
| `cwd`                | `string`                                 | Working directory the agent operates in                                                                                                                                                                                                                                                                                                                                             |
| `workspaceId`        | `string?`                                | Owning workspace id — the single source of ownership. Every agent is stamped with one at create time; legacy cwd-only records are backfilled once by `migrations/backfill-workspace-id.migration.ts` (the only place a cwd→id mapping exists). Runtime code never infers ownership or status from cwd: status is computed per `workspaceId`, and same-cwd siblings are independent. |
| `createdAt`          | `string` (ISO 8601)                      | Creation timestamp                                                                                                                                                                                                                                                                                                                                                                  |
| `updatedAt`          | `string` (ISO 8601)                      | Last update timestamp                                                                                                                                                                                                                                                                                                                                                               |
| `lastActivityAt`     | `string?` (ISO 8601)                     | Last activity timestamp                                                                                                                                                                                                                                                                                                                                                             |
| `lastUserMessageAt`  | `string?` (ISO 8601)                     | Last user message timestamp                                                                                                                                                                                                                                                                                                                                                         |
| `title`              | `string?`                                | User-visible title                                                                                                                                                                                                                                                                                                                                                                  |
| `labels`             | `Record<string, string>`                 | Key-value labels (default `{}`). Paseo uses `paseo.parent-agent-id` for parentage and client-scoped `paseo.open-agent-tab.*` labels while managed subagent tabs are open — see [agent-lifecycle.md](./agent-lifecycle.md)                                                                                                                                                           |
| `lastStatus`         | `AgentStatus`                            | One of: `"initializing"`, `"idle"`, `"running"`, `"error"`, `"closed"`. `closed` means the record is resumable but has no live provider runtime; archive remains represented separately by `archivedAt`.                                                                                                                                                                            |
| `lastModeId`         | `string?`                                | Last active mode ID                                                                                                                                                                                                                                                                                                                                                                 |
| `config`             | `SerializableConfig?`                    | Agent session configuration (see below)                                                                                                                                                                                                                                                                                                                                             |
| `runtimeInfo`        | `RuntimeInfo?`                           | Live runtime state (see below)                                                                                                                                                                                                                                                                                                                                                      |
| `features`           | `AgentFeature[]?`                        | Provider-reported features (toggles/selects)                                                                                                                                                                                                                                                                                                                                        |
| `persistence`        | `PersistenceHandle?`                     | Handle for resuming sessions                                                                                                                                                                                                                                                                                                                                                        |
| `lastError`          | `string?` (nullable)                     | Last error message, if any                                                                                                                                                                                                                                                                                                                                                          |
| `requiresAttention`  | `boolean?`                               | Whether the agent needs user attention                                                                                                                                                                                                                                                                                                                                              |
| `attentionReason`    | `"finished" \| "error" \| "permission"?` | Why attention is needed                                                                                                                                                                                                                                                                                                                                                             |
| `attentionTimestamp` | `string?` (ISO 8601)                     | When attention was flagged                                                                                                                                                                                                                                                                                                                                                          |
| `internal`           | `boolean?`                               | Whether this is a system-internal agent                                                                                                                                                                                                                                                                                                                                             |
| `archivedAt`         | `string?` (ISO 8601)                     | Soft-delete timestamp                                                                                                                                                                                                                                                                                                                                                               |

Agent records also accept optional `metadata`, separate from the provider persistence handle.
Its side-conversation contract is described in [Agent lifecycle](agent-lifecycle.md#side-conversations).

### Nested: SerializableConfig

| Field              | Type                       | Description                  |
| ------------------ | -------------------------- | ---------------------------- |
| `title`            | `string?`                  | Configured title             |
| `modeId`           | `string?`                  | Configured mode              |
| `model`            | `string?`                  | Configured model             |
| `thinkingOptionId` | `string?`                  | Thinking/reasoning level     |
| `featureValues`    | `Record<string, unknown>?` | Feature preference overrides |
| `extra`            | `Record<string, any>?`     | Provider-specific config     |
| `systemPrompt`     | `string?`                  | Custom system prompt         |
| `mcpServers`       | `Record<string, any>?`     | MCP server configurations    |

### Nested: RuntimeInfo

| Field              | Type                       | Description                    |
| ------------------ | -------------------------- | ------------------------------ |
| `provider`         | `string`                   | Active provider                |
| `sessionId`        | `string?`                  | Active session ID              |
| `model`            | `string?`                  | Active model                   |
| `thinkingOptionId` | `string?`                  | Active thinking option         |
| `modeId`           | `string?`                  | Active mode                    |
| `extra`            | `Record<string, unknown>?` | Provider-specific runtime data |

### Nested: PersistenceHandle

| Field          | Type                   | Description                                                           |
| -------------- | ---------------------- | --------------------------------------------------------------------- |
| `provider`     | `string`               | Provider that owns the session                                        |
| `sessionId`    | `string`               | Session ID for resumption                                             |
| `nativeHandle` | `any?`                 | Provider-specific handle (Codex thread ID, Claude resume token, etc.) |
| `metadata`     | `Record<string, any>?` | Extra metadata                                                        |

### Nested: AgentFeature (discriminated union on `type`)

**Toggle:**

| Field         | Type       |
| ------------- | ---------- |
| `type`        | `"toggle"` |
| `id`          | `string`   |
| `label`       | `string`   |
| `description` | `string?`  |
| `tooltip`     | `string?`  |
| `icon`        | `string?`  |
| `value`       | `boolean`  |

**Select:**

| Field         | Type                  |
| ------------- | --------------------- |
| `type`        | `"select"`            |
| `id`          | `string`              |
| `label`       | `string`              |
| `description` | `string?`             |
| `tooltip`     | `string?`             |
| `icon`        | `string?`             |
| `value`       | `string \| null`      |
| `options`     | `AgentSelectOption[]` |

---

## Runtime-only Terminal Sessions

Terminals are live daemon state, not persisted JSON records. A terminal carries a `workspaceId` while it is running; workspace-scoped terminal lists include only terminals with the matching `workspaceId`. Legacy live terminals without an owner remain visible to unscoped terminal reads but contribute to no workspace status.

Terminal activity contributes to the workspace status bucket **per `workspaceId`**: a working terminal drives `running` onto the workspace it carries only. Same-`cwd` siblings are untouched; terminal visibility is likewise `workspaceId`-scoped.

---

## 2. Daemon Configuration

**Path:** `$PASEO_HOME/config.json`

Single file, validated with `PersistedConfigSchema`.

`agents.skills.selection` is the daemon host's orchestration-skill preference. Missing means
`{ mode: "all" }`. Installed state is not persisted; the daemon derives it from the shared
`~/.agents/skills` and Claude skill directories and keeps config plus filesystem convergence behind
one serialized owner. Codex discovers the shared directory. Updates retire unchanged files from
Paseo-managed copies in `~/.codex/skills`, preserving user edits and untracked files.

`paseo reload` reads and validates this file once inside the daemon. That snapshot drives resolution,
classification, application, and reload bookkeeping. `DaemonConfigStore` owns applying runtime-safe
fields and their removal/default semantics; session handlers and the CLI only relay the structured
result. Normal config patches persist only the requested fields, so launch overrides and resolved
defaults never leak into the file. Startup-only fields remain compared with the daemon's launch
snapshot so a mixed edit can apply its live subset and still name the paths that require restart.

```
{
  version: 1,
  daemon: {
    listen: "127.0.0.1:6767",
    hostnames: true | string[],   // legacy alias `allowedHosts` is migrated on load
    trustedProxies: true | string[], // defaults to ["loopback"]; Express proxy names/CIDRs
    mcp: { enabled: boolean, injectIntoAgents: boolean },
    git: { maxProcessesPerSecond: number, maxProcessConcurrency: number },
    appendSystemPrompt: string,    // appended to supported provider system/developer prompts
    terminalProfiles: TerminalProfile[],  // named shell commands; omitted means DEFAULT_TERMINAL_PROFILES
    agentProfiles: AgentProfile[],        // named agent launch bundles; omitted means none
    agentRoles: AgentRole[],              // named ways of working; omitted means DEFAULT_AGENT_ROLES
    cors: { allowedOrigins: string[] },
    relay: { enabled: boolean, endpoint: string, publicEndpoint: string, useTls: boolean, publicUseTls: boolean }, // new homes materialize enabled: false
    auth: { password: string }    // bcrypt hash, optional
  },
  app: {
    baseUrl: string
  },
  worktrees?: {
    root?: string            // optional root for new worktrees; defaults to $PASEO_HOME/worktrees
    servicePorts?: {         // optional dynamic service port allocation policy
      range?: string         // inclusive range, e.g. "3000-4000"
      portScript?: string    // executable that receives service/workspace context and prints one TCP port
    }
  },
  providers: {
    local: { modelsDir: string }
  },
  agents: {
    skills?: {
      selection?: { mode: "all" } | { mode: "custom", skills: string[] }
    },
    // ProviderOverrideSchema; legacy entries with `command: { mode, ... }` are migrated to the
    // current shape on load via `migrateProviderSettings`. Custom provider IDs must declare
    // `extends` (one of the built-ins or `"acp"`) and `label`. See `provider-launch-config.ts`.
    providers: Record<providerId, ProviderOverride>,
    metadataGeneration: {
      providers: [{ provider, model?, thinkingOptionId? }]
    }
  },
  pluginsEnabled: boolean,
  plugins: Record<pluginId, { source: "directory", path: string, enabled?: boolean }>,
  features: {
    dictation: { enabled, stt: SpeechSttConfig },
    voiceMode: { enabled, llm, stt: SpeechSttConfig, turnDetection, tts: SpeechTtsConfig }
  },
  log: {
    level, format,
    console: { level, format },
    file: { level, path, rotate: { maxSize, maxFiles } }
  }
}
```

All fields are optional with sensible defaults.

Managed plugins appear as directory sources in `config.json`; it owns the active path and enabled
state. `plugins/sources.json` is written atomically and stores only managed kind and the Git acquisition
remote. Installed revision, package/subdirectory identity and ownership root come from retained
artifacts and the fixed managed layout; [managed source ownership](plugins.md#managed-source-ownership)
explains their authority. An update prepares a new directory before replacing the active path and
removing the previous version. Old record fields are accepted at the store boundary and ignored;
there is no startup migration or persistent update policy.

### Profile lists

`terminalProfiles`, `agentProfiles` and `agentRoles` are whole-list fields: a config patch replaces
the array, never merges entries, so a client sends the complete next list on every add, edit,
reorder and remove. List order is the display order.

Absent and empty mean different things for terminal profiles and agent roles — omitting the key
falls back to `DEFAULT_TERMINAL_PROFILES` or `DEFAULT_AGENT_ROLES`, while `[]` means the user
removed them all. A patch cannot remove a key, so the first edit writes the defaults into the file
and later changes to the built-in roles no longer reach that host; "Restore default roles" writes
the current defaults again. Agent profiles have no defaults, so both mean none.

`PersistedConfigSchema` parses strictly, so a daemon that predates a field drops it on write
rather than storing something it cannot describe. That is why the client gates the agent profiles
UI on `server_info.features.agentProfiles` instead of letting a save appear to succeed against an
older daemon.

### Agent provider Paseo tools

`agents.providers` is keyed by the exact provider ID used to launch the agent. The built-in IDs are
`claude`, `codex`, `copilot`, `opencode`, `pi`, and `omp`. Custom provider IDs are their literal
configuration keys, such as `my-claude` or `zai`, not the provider named by `extends`.

Each entry may include a Paseo-tool policy:

```json
{
  "agents": {
    "providers": {
      "my-claude": {
        "extends": "claude",
        "label": "My Claude",
        "paseoTools": {
          "enabled": true,
          "disabledTools": ["browser_evaluate"]
        }
      }
    }
  }
}
```

Absent `paseoTools`, or absent fields within it, means Paseo tools are enabled and all tools are
allowed. `enabled: false` disables the provider's Paseo catalog; `disabledTools` lists exact tool
IDs to omit. The policy covers the core and browser catalog, not the voice-only `speak` tool.
Browser tools also require `daemon.browserTools.enabled` and a connected browser host.
This policy controls the catalog presented to an agent. It is not an authorization boundary for
agents that can access the host through a shell.

`daemon.mcp.injectIntoAgents` is the global override. When it is `false`, no provider receives
Paseo tools; otherwise the provider policy applies. Provider and global policy are resolved when a
session is created, resumed, imported, or reloaded, so configuration changes affect the next
session rather than an already-running one.

`agents.metadataGeneration.providers` selects the models for daemon-side metadata tasks: commit messages, PR text, branch names, and generated titles. An empty list is Automatic; a non-empty list is Manual and only those models are tried. See [public-docs/metadata-generation.md](../public-docs/metadata-generation.md#how-a-model-is-chosen).

### Git process limits

Git process limits are global to one daemon. The start-rate limit defaults to `64` processes per
second, and the concurrency limit defaults to `8`:

```json
{
  "daemon": {
    "git": {
      "maxProcessesPerSecond": 64,
      "maxProcessConcurrency": 8
    }
  }
}
```

`maxProcessesPerSecond` limits Git process starts in any one-second interval. The allowance can
start as a burst; it does not wait for earlier processes to exit. `maxProcessConcurrency` limits
the number of Git processes that have started but not exited. Every Git command uses both limits,
including initial workspace reads, filesystem-triggered refreshes, background checks, and explicit
requests.

Environment variables override `config.json`:

| Environment variable                 | Setting                  |
| ------------------------------------ | ------------------------ |
| `PASEO_GIT_MAX_PROCESSES_PER_SECOND` | `maxProcessesPerSecond`  |
| `PASEO_GIT_MAX_PROCESS_CONCURRENCY`  | `maxProcessConcurrency`  |
| `PASEO_GIT_CONCURRENCY`              | Legacy concurrency alias |

`PASEO_GIT_MAX_PROCESS_CONCURRENCY` wins when it and the legacy alias are both set. Run `paseo reload`
after changing `config.json`. Environment changes require a daemon restart; the launch environment
remains authoritative during reload.

### Speech configuration

Each use site owns its provider settings: `features.dictation.stt`,
`features.voiceMode.stt`, and `features.voiceMode.tts`. `provider` selects a strict
`local` or `openai` variant. Both STT variants carry `language`; normalization preserves
it regardless of provider. `providers.local.modelsDir` remains shared storage.
See [Voice configuration](../public-docs/voice.md) for fields, examples and env precedence.

On load, `persisted-config.ts` folds legacy `providers.openai` credentials and URLs
into OpenAI sites that lack their own values, using endpoint settings before shared
settings. A provider-less site becomes local; provider names are lower-cased, and
fields ignored by the selected speech provider are discarded. The next save writes only the
inline shape. A legacy key with no site to receive it is discarded with a warning
that names its path, without logging its value.

`speech-settings.ts` owns mutable config reads and patches. The wire uses the same
`features` structure. Reads replace OpenAI keys with `hasApiKey` (saved in config)
and report effective env sources in `envOverrides`. A site patch that changes
`provider` replaces the entire object. The same or omitted `provider` merges fields
into the current variant, preserving the write-only key when a form re-saves it. `null` clears a value. Switching providers discards credentials and
options from the previous variant.

---

## 3. Schedule

**Path:** `$PASEO_HOME/schedules/{id}.json`

One file per schedule. ID is 8 hex characters.

| Field       | Type                                  | Description                      |
| ----------- | ------------------------------------- | -------------------------------- |
| `id`        | `string`                              | 8-char hex ID                    |
| `name`      | `string?`                             | Human-readable name              |
| `prompt`    | `string`                              | The prompt to send               |
| `cadence`   | `ScheduleCadence`                     | Timing (see below)               |
| `target`    | `ScheduleTarget`                      | What to run (see below)          |
| `status`    | `"active" \| "paused" \| "completed"` | Current state                    |
| `createdAt` | `string` (ISO 8601)                   |                                  |
| `updatedAt` | `string` (ISO 8601)                   |                                  |
| `nextRunAt` | `string?` (ISO 8601)                  | Next scheduled execution         |
| `lastRunAt` | `string?` (ISO 8601)                  | Last execution time              |
| `pausedAt`  | `string?` (ISO 8601)                  | When paused                      |
| `expiresAt` | `string?` (ISO 8601)                  | Auto-expire time                 |
| `maxRuns`   | `number?`                             | Max executions before completing |
| `runs`      | `ScheduleRun[]`                       | Execution history                |

### Nested: ScheduleCadence (discriminated union on `type`)

- `{ type: "cron", expression: string, timezone?: string }` — canonical cadence for new writes; absent `timezone` means UTC
- `{ type: "every", everyMs: number }` — legacy rolling interval, still readable and executable during the compatibility window

### Nested: ScheduleTarget (discriminated union on `type`)

- `{ type: "agent", agentId: string, workspaceId?: string }` — send to an existing agent. A workspace-scoped target is a managed schedule; an unscoped target keeps the lightweight heartbeat surface.
- `{ type: "new-agent", workspaceId?: string, config: { provider, cwd, modeId?, model?, thinkingOptionId?, title?, providerOptions?, featureValues?, systemPrompt?, mcpServers? } }` — create a new agent. An explicit workspace ID selects an existing workspace; the registry supplies its directory. Without it, each run creates a workspace.

Workspace ownership belongs to the run, not to the current schedule target. `ScheduleRun.ownsWorkspace` records that authority so editing a schedule cannot authorize cleanup of a user-owned workspace. Missing ownership on legacy runs retains their original new-workspace cleanup policy. Client target selection requires `server_info.features.scheduleWorkspaceTargets`; existing requests without a target change remain supported on older hosts.

### Nested: ScheduleRun

| Field          | Type                                   | Description             |
| -------------- | -------------------------------------- | ----------------------- |
| `id`           | `string`                               | Run ID                  |
| `scheduledFor` | `string` (ISO 8601)                    | Intended execution time |
| `startedAt`    | `string` (ISO 8601)                    |                         |
| `endedAt`      | `string?` (ISO 8601)                   |                         |
| `status`       | `"running" \| "succeeded" \| "failed"` |                         |
| `agentId`      | `string?` (UUID)                       | Agent used for this run |
| `output`       | `string?`                              | Agent output text       |
| `error`        | `string?`                              | Error message if failed |

---

## 4. Project Registry

**Path:** `$PASEO_HOME/projects/projects.json`

Array of project records.

| Field                | Type                        | Description                                                                                                                                |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `projectId`          | `string`                    | Host-local primary key; new records use opaque `prj_<16 hex>` IDs                                                                          |
| `projectKey`         | `string \| null`            | Persisted opaque cross-host grouping key; reconciliation backfills absent values                                                           |
| `rootPath`           | `string`                    | Exact lexically normalized selected root; never realpathed                                                                                 |
| `kind`               | `"git" \| "non_git"`        | Mutable Git observation about `rootPath`, never a membership key                                                                           |
| `displayName`        | `string`                    | Selected-root basename, stable across remote and Git changes                                                                               |
| `customName`         | `string \| null`            | User-set override layered over `displayName`. Null means "use the derived name".                                                           |
| `customIconRevision` | `string \| null`            | Identifies the host-local custom icon stored under `projects/icons/`. Null means the icon is discovered by scanning the project directory. |
| `createdAt`          | `string` (ISO 8601)         |                                                                                                                                            |
| `updatedAt`          | `string` (ISO 8601)         |                                                                                                                                            |
| `archivedAt`         | `string \| null` (ISO 8601) | Soft-delete timestamp; required nullable                                                                                                   |

Uploading a file and pasting a website or image URL are two ways of _acquiring_ the same custom
icon. The client fetches URL imports and sends their bytes through the upload RPC. The daemon never
receives or fetches the URL; it validates the uploaded bytes, stores them, and records a new
`customIconRevision`. Going back to automatic deletes the stored image, as does removing the
project.

Active exact roots are idempotent using lexical platform-equivalence semantics. Existing legacy
remote-shaped and path-shaped IDs remain readable, including duplicate roots; reconciliation never
merges them, transfers names, archives them, or moves workspace foreign keys. An explicit
workspace `projectId` is authoritative when it names an active project, regardless of cwd
containment. Archived-only exact-root records are not resurrected by explicit add/open; a fresh
opaque project is allocated instead. Agent restore is separate and restores the agent's existing
workspace together with its owning project.

---

## 5. Workspace Registry

**Path:** `$PASEO_HOME/projects/workspaces.json`

Array of workspace records. A workspace is a specific working directory within a project.

| Field                          | Type                                                         | Description                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceId`                  | `string`                                                     | Opaque stable identifier (`wks_<hex>`), generated independently of the directory. MUST NOT be treated as a path; compare by exact equality. Use the `cwd` field for directory access.         |
| `projectId`                    | `string`                                                     | FK to Project.projectId; the workspace's stable project membership                                                                                                                            |
| `cwd`                          | `string`                                                     | Exact execution directory selected for agents, files, scripts, and setup                                                                                                                      |
| `kind`                         | `"local_checkout" \| "worktree" \| "directory"`              | Mutable checkout classification                                                                                                                                                               |
| `displayName`                  | `string`                                                     | The human name (the generated/derived title). Decoupled from `branch` by construction.                                                                                                        |
| `title`                        | `string \| null`                                             | User-set name override layered over `displayName`. Null means "use `displayName`".                                                                                                            |
| `branch`                       | `string \| null`                                             | The current Git branch for git-backed workspaces. Separate from `displayName`/`title`; a background branch refresh never rewrites the name.                                                   |
| `worktreeRoot`                 | `string \| null`                                             | Backing checkout/worktree root. May differ from `cwd` for exact subprojects and remains persisted after the worktree is deleted so restore can reproduce the placement.                       |
| `baseBranch`                   | `string \| null`                                             | Current base retained across archive and restore. Explicit selections and branch-off creation store exact refs; older records may store branch names. Null means no recorded base.            |
| `isPaseoOwnedWorktree`         | `boolean`                                                    | Whether Paseo owns and may remove/recreate the backing `worktreeRoot`                                                                                                                         |
| `mainRepoRoot`                 | `string \| null`                                             | Main repository root for worktree checkouts, independent of both exact `cwd` and backing `worktreeRoot`                                                                                       |
| `createdAt`                    | `string` (ISO 8601)                                          |                                                                                                                                                                                               |
| `updatedAt`                    | `string` (ISO 8601)                                          |                                                                                                                                                                                               |
| `archivedAt`                   | `string \| null` (ISO 8601)                                  | Soft-delete; required nullable                                                                                                                                                                |
| `autoArchivedChangeRequestUrl` | `string \| null`                                             | Change request whose merged state triggered auto-archive. Restore replaces it with the current merged change request, when present, so repeated snapshots cannot archive the workspace again. |
| `labels`                       | `string[]?`                                                  | Normalized display names assigned from this host's shared label catalog. Missing means unlabelled.                                                                                            |
| `pinnedAt`                     | `string \| null` (ISO 8601)                                  | Pinned-to-top-of-sidebar timestamp; null means "not pinned"                                                                                                                                   |
| `untrustedSource`              | `{ kind: "change_request", forge, number, headRepository }?` | Provenance captured when a cross-repository change request creates the workspace. Missing means repository automation is allowed; explicit setup removes the field.                           |

> **Opaque-ID invariant:** `workspaceId` is opaque identity, never a filesystem path. Filesystem and git operations take `cwd`/`workspaceDirectory` only — never the id. A compatibility-only first-materialization bootstrap still groups pre-registry agent records by path and Git remote so existing installs retain their legacy records. That grouping never runs against a live registry, and its keys are not runtime project or workspace identity.

### Workspace label catalog

**Path:** `$PASEO_HOME/projects/workspace-labels.json`

The catalog is shared by every workspace on one host. A definition contains a display name and one
of the ten identity colour names (`WORKSPACE_LABEL_COLORS` in
`packages/protocol/src/workspace-labels.ts`); trimmed, collapsed, case-insensitive name identity is
unique within that file. Definitions have no portable ID or principal owner and remain after their
last assignment. Editing a label takes a new name, a new colour, or both in one commit, so the two
fields cannot land half-applied. Workspaces store label names, so a rename and a delete rewrite
workspace assignments through one serialized compound commit while a recolour is catalog-only; a
rename onto a name the host already has is refused rather than merged. A prepared
`workspace-labels.transaction.json` contains both before and after images. The daemon writes the
catalog and workspace files, then atomically changes the transaction to committed; that phase
change is the durable commit point. Recovery rolls prepared transactions back before either
directory is served. A committed marker proves both data files were already written, so recovery
only loads the current catalog and retries marker cleanup; it never reapplies stale workspace
after-images over later registry mutations. A request rejected before the commit point therefore
cannot take effect after restart. If the live daemon cannot determine or restore the durable state,
the workspace registry freezes every write and later label mutations fail with
`workspace_label_storage_uncertain` until daemon restart performs recovery. Reads remain available,
but may reflect the last acknowledged cache until restart. Workspace directory and catalog updates
publish only after the commit point; publication failure does not roll durable state back.

`projectId` is still a real FK: workspace records should have a matching project record. Read-only
history surfaces tolerate transient orphaned workspaces by omitting those rows so one bad FK cannot
blank the whole History screen, but mutation paths should repair or remove the orphaned state rather
than treating it as valid.

---

## 6. Push Token Store

**Path:** `$PASEO_HOME/push-tokens.json`

```json
{
  "tokens": ["ExponentPushToken[...]", ...]
}
```

Simple set of Expo push notification tokens. Loaded with permissive parsing (filters non-string entries). Persisted with atomic temp-file rename.

---

## 7. Daemon meta files

These small files are not validated as full Zod schemas but are persisted under `$PASEO_HOME` for daemon identity and runtime coordination.

| Path                  | Format                                                         | Notes                                                                             |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `server-id`           | Plain text, e.g. `srv_<base64url>`                             | Stable per-`$PASEO_HOME` daemon ID. Overridable via `PASEO_SERVER_ID` env.        |
| `daemon-keypair.json` | `{ v: 2, publicKeyB64, secretKeyB64 }` (libsodium box keypair) | E2EE relay identity. Written with mode `0600`. Regenerated if file is unreadable. |
| `paseo.pid`           | JSON `{ pid, startedAt, ... }`                                 | PID lock; prevents two daemons sharing one `$PASEO_HOME`.                         |
| `local-credential`    | 32 random bytes encoded as base64url text                      | Rotated before each listen and deleted on shutdown; mode `0600`.                  |
| `daemon.log`          | Pino log output                                                | Default location; path/rotation configurable via `log.file` in `config.json`.     |

---

## 8. Board tasks

Tasks, Goals, Decisions and task-view settings use four host-local files under
`$PASEO_HOME/board/`. Each is written atomically with a `version: 1` envelope. Every service keeps
its data in memory, serializes mutations, and pushes a `board.task.update` change to subscribers
after each write. Nothing syncs between hosts. `createBoardServices` (`server/board/services.ts`)
builds the four together.

The default [Desk](glossary.md) projects existing sessions, requests, Decisions and Artifacts.
It has no separate persisted lifecycle. Tasks & Goals retains these files and their completion
semantics; opening Desk does not migrate them or change conversation state.

### Tasks

**Path:** `$PASEO_HOME/board/tasks.json`, written as `{ version: 1, tasks: BoardTask[] }`.

Deleting a task removes it from other tasks' `blockedBy` and detaches its subtasks. Fields added
after the first release default on load, so older files still parse: tasks without `stage` load as
`ready` because they were already committed work, the pre-Desk stages `backlog` and `todo` load
as `fog` and `ready`, tasks without `goalId` are loose work, and tasks without `number` are
numbered in creation order after the highest existing number.

| Field                | Type                  | Description                                                                      |
| -------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `id`                 | `string`              | `tsk_<16 hex>`                                                                   |
| `number`             | `number`              | Host-local sequence shown as `T-<number>`; one above the highest existing number |
| `title`              | `string`              | Whitespace-collapsed, 1 to 200 characters                                        |
| `notes`              | `string`              | Up to 20,000 characters; the start prompt below the title                        |
| `projectId`          | `string \| null`      | Host-local project; set to the workspace's project when linked                   |
| `workspaceId`        | `string \| null`      | Linked workspace. Must be active at link time                                    |
| `goalId`             | `string \| null`      | Goal the task serves; must exist. Deleting the goal sets it to `null`            |
| `attachments`        | forge issue / PR refs | Added to the first prompt on start. Forge kinds only, so the wire stays pure     |
| `rank`               | `number`              | Order in Ahead, lower first. New tasks go to the top                             |
| `summary`            | `string \| null`      | What happened, usually written by the agent when it finishes                     |
| `parentId`           | `string \| null`      | Parent task on the same host; ancestor cycles are rejected                       |
| `blockedBy`          | `string[]`            | Same-host tasks that must be done first; cycles are rejected                     |
| `acceptanceCriteria` | `{ text, met }[]`     | Checklist the finishing agent ticks; empty when unset                            |
| `readyFor`           | `"agent" \| "human"`  | Who takes it next. Agents and Autopilot only take `agent` tasks                  |
| `stage`              | `"fog" \| "ready"`    | New tasks default to `fog`; only `ready` tasks are on the frontier               |
| `claimedBy`          | `string \| null`      | Agent id working it in its own session; cleared by start, link or completion     |
| `createdAt`          | `string` (ISO 8601)   |                                                                                  |
| `updatedAt`          | `string` (ISO 8601)   |                                                                                  |
| `completedAt`        | `string \| null`      | Set by **Mark done**, or when the linked workspace is archived                   |

The zone is never stored. See **Tasks & Goals** and **Zone** in [glossary.md](glossary.md).
Agent items are not stored here either: the app builds them from each host's live agents and
workspaces.

`BoardTaskService.find` resolves an id or a `T-<number>` reference, and `BoardGoalService.find`
an id or a `G-<number>`. MCP tools resolve every reference through them; `paseo task` and
`paseo goal` resolve against the lists they load. The WebSocket RPCs take ids only.

### Goals

**Path:** `$PASEO_HOME/board/goals.json`, written as `{ version: 1, goals: BoardGoal[] }`. A goal
carries its own Autopilot settings; there is no per-project Autopilot.

| Field                | Type                         | Description                                                       |
| -------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `id`                 | `string`                     | `gol_<16 hex>`                                                    |
| `number`             | `number`                     | Host-local sequence shown as `G-<number>`                         |
| `title`, `notes`     | `string`                     | Same limits as task title and notes                               |
| `ownerAgentId`       | `string \| null`             | Owner agent that plans and dispatches the goal's work             |
| `autopilot`          | `BoardGoalAutopilot \| null` | `null` means never set up; see below                              |
| `startsToday`        | `number`                     | Counted against `startsDate`; reads as 0 once the date has passed |
| `startsDate`         | `string \| null`             | Daemon-local `YYYY-MM-DD`. Stored only; never sent to clients     |
| `lastAutopilotError` | `string \| null`             | Last failed automatic start; cleared by a success or new settings |
| `rank`               | `number`                     | Goal order, lower first. New goals go to the end                  |
| `createdAt`          | `string` (ISO 8601)          |                                                                   |
| `updatedAt`          | `string` (ISO 8601)          | Also changes on every recorded start                              |
| `landedAt`           | `string \| null`             | Set when the goal lands; Autopilot does nothing for a landed goal |

`BoardGoalAutopilot` is `{ enabled, agent, isolation, maxActive (1..20), dailyStartLimit (1..200),
confirmStarts }`, where `agent` is the same profile or config selection as
`board.task.start.request`.

`BoardAutopilotRunner` (`server/board/autopilot-runner.ts`) decides what to start. It
re-evaluates goals on every task, goal or decision change and once a minute for the date rollover,
one pass at a time. While the goal has fewer than `maxActive` started, unfinished tasks and
`startsToday` is below the limit, it takes the lowest-`rank` task of the goal on the frontier
(`isOnFrontier`: ready, not started, unclaimed, ready for an agent, blockers done). Fog tasks
wait until someone specifies them. Without `confirmStarts` it calls the same start path as
`start_board_task`, keyed on the task's id and `updatedAt` so a retry reuses the start. After a
failed start the goal pauses until the failed task changes, the settings change, or the day
changes; the pause is in memory, so a daemon restart retries once. With `confirmStarts` it posts
an `autopilot_start` decision instead, and open questions count against both limits.

### Decisions

**Path:** `$PASEO_HOME/board/decisions.json`, written as
`{ version: 1, decisions: BoardDecision[], skips: { taskId, taskUpdatedAt }[] }`.

| Field           | Type                           | Description                                                            |
| --------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `id`            | `string`                       | `dec_<16 hex>`                                                         |
| `kind`          | `"agent" \| "autopilot_start"` | Who asks: an agent through `request_decision`, or goal Autopilot       |
| `goalId`        | `string \| null`               | Goal the question is about                                             |
| `taskId`        | `string \| null`               | Task the question is about                                             |
| `agentId`       | `string \| null`               | Agent that asked; it gets the answer as a prompt                       |
| `title`         | `string`                       | The question, 1 to 200 characters                                      |
| `brief`         | `string`                       | Markdown, up to 20,000 characters                                      |
| `options`       | `{ id, label }[]`              | 1 to 8, unique ids, labels up to 100 characters                        |
| `createdAt`     | `string` (ISO 8601)            |                                                                        |
| `resolvedAt`    | `string \| null`               | Set by an answer, or when the daemon closes a stale question           |
| `choiceId`      | `string \| null`               | `null` with `resolvedAt` set means closed without an answer            |
| `note`          | `string \| null`               | The user's text added to the choice                                    |
| `taskUpdatedAt` | `string \| null`               | Stored only: the task version an `autopilot_start` question asks about |

Resolving runs the answer's effect first and records the answer only when the effect succeeds, so
a failed start keeps the question open. An `agent` answer is sent to the asking agent as a prompt;
`start` on an `autopilot_start` question starts the task with the goal's Autopilot settings and
counts against today's limit. `skip` records the task version in `skips`, so Autopilot does not
ask again until the task changes. The runner closes `autopilot_start` questions whose task changed
or left the frontier, or whose goal stopped asking. Answered decisions stay listed for a day, then the next write drops them.

### Artifacts

**Path:** `$PASEO_HOME/artifacts/index.json`, written as `{ version: 1, artifacts: Artifact[] }`,
with each artifact's content under `files/<id>/`. `ArtifactStore` (`server/artifacts/store.ts`)
ships inside `BoardServices` because artifacts reference goals and tasks.

The daemon copies the content when an agent registers it. That copy is the deliverable: archiving
the workspace removes a Paseo-owned worktree with the file it came from, and the artifact still
opens from its goal. An artifact never stores task state; `goalId` and `taskIds` are references,
and a deleted goal or task shows as gone rather than being cleaned up.

Entries are workspace-owned: `workspaceId` is the caller's workspace, and the Artifacts tab shows
only that workspace's entries, so two workspaces on one folder never see each other's
([architecture.md](architecture.md#right-sidebar-boundary-directory-backed-vs-workspace-owned)).
Re-registering keeps the id and raises `revision` when the caller passes `artifactId` or the same
`sourcePath` in the same workspace. Removing takes the entry out of the collection and keeps every file: the daemon's copy may be the only one left after an archive. Content is capped at 10 MiB.

### Desk settings and snoozes

**Path:** `$PASEO_HOME/board/desk.json`, written as
`{ version: 1, settings: BoardDeskSettings, snoozes: { key, until }[] }`. A missing file means the
defaults.

| Field                          | Default                                        | Description                                                  |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| `settings.zones`               | Decide, Flight, Ahead, Landed; visible         | Kept for old clients; the app ignores it and fixes the order |
| `settings.decideKinds`         | every checkpoint kind                          | Checkpoint kinds shown in Decide                             |
| `settings.grouping`            | `goal`                                         | Kept for old clients; the app always groups by goal          |
| `settings.landedRetentionDays` | `7`                                            | How long Landed keeps finished work, 1 to 365                |
| `settings.notifyKinds`         | `permission`, `question`, `failed`, `decision` | Checkpoint kinds that send a push notification               |
| `snoozes[].key`                | —                                              | Opaque to the daemon; the app derives it per checkpoint      |
| `snoozes[].until`              | —                                              | ISO 8601. Woken snoozes are dropped on the next write        |

These settings and snoozes govern Tasks & Goals on every device, not the default Desk view.
`notifyKinds` also controls daemon notifications. Zone widths and the last
[Desk mode](glossary.md) are device-local in the app.

---

]
