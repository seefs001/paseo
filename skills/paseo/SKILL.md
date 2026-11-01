---
name: paseo
description: Paseo reference for managing hosts, projects, workspaces, Desk goals and tasks, decisions, workspace scripts, agents, schedules, and heartbeats.
---

Paseo is a remote daemon that manages coding agents, terminals. Control it through MCP tools or the CLI.

## Connected hosts

Call `list_hosts` to discover the calling daemon (`self`) and its registered destinations (`hosts`). Use a destination's `serverId` for tool calls; labels are display names.

`create_workspace`, `list_workspaces`, `create_agent`, `send_agent_prompt`, `get_agent_status`, `get_agent_activity`, and `list_agents` accept `serverId`. Omit it for the calling daemon. Other MCP tools operate on the calling daemon.

Keep an agent's `{ serverId, agentId }` together. For example, call `send_agent_prompt` with:

```json
{ "serverId": "srv_build", "agentId": "agent_123", "prompt": "Continue", "notifyOnFinish": true }
```

Remote paths and workspace IDs belong to the destination. Remote `list_agents` has no caller-directory default; pass `cwd` to filter it.

Manage registrations through the CLI; use the returned `registrationId` for updates and removal:

```bash
paseo --host localhost:6768 host add localhost:6779 --label build
paseo --host localhost:6768 host ls --json
```

## Projects

Manage the daemon's project registry through the CLI:

```bash
paseo project create [path]
paseo project ls
paseo project rename <project-id> <name>
paseo project rename <project-id> --reset
paseo project delete <project-id>
```

For a local daemon, `project create` defaults to the current directory and resolves relative paths on the CLI machine. With `--host` or `PASEO_HOST`, always provide a path; the target daemon interprets it on its own machine. Deleting a project archives its active workspaces and removes the project from Paseo without deleting the project directory.

## Workspaces

**`create_workspace`** — create a workspace independently of any agent. Required: `isolation` (`local` or `worktree`). Worktree isolation supports `mode: "branch-off" | "checkout-branch" | "checkout-pr"`: use `branchName`/`baseBranch` for a new branch, `branch` for an existing branch, or `prNumber` plus optional `forge` for a change request. Use `path` for a local directory or source checkout and `projectId` for the owning project; when no path is supplied, a worktree may resolve its source from `projectId`. `worktreeSlug` controls the managed path. Returns the workspace descriptor centered on `workspaceId`.

`background: true` hides a workspace from default lists and the sidebar while its contents remain durable and accessible; omit `background` to inherit your current workspace’s value (false without a caller), and override it only when the user explicitly asks.

Choose `baseBranch` explicitly: `origin/main` selects the remote-tracking branch; `refs/heads/main` selects local main. Bare `main` prefers local main when it exists, otherwise origin/main. Paseo retains the resolved ref for workspace comparisons, even after rebasing the branch or changing its PR target.

**`list_workspaces`** — list active workspaces, excluding background workspaces unless `includeBackground: true`.

**`archive_workspace`** — `{ workspaceId }`. Archives the workspace, its agents, and its terminals. Local directories remain; Paseo removes an owned worktree only after its final active workspace reference is archived.

**`rename_workspace`** — `{ workspaceId, name }`. Rename workspace.

## Desk goals, tasks and decisions

The Desk shows the user's work by whose move it is. These tools manage its goals, tasks and decisions on the calling host; live agents show on the Desk without them.

Push right. Do as much as you can, then bring the user a prepared brief. Do not stop at every step, and do not report status through the Desk.

- Record ideas and follow-ups as fog tasks with `create_board_task`. Do not start them unless the user asks or you own their goal.
- Ask with `request_decision` only for a real choice: a direction, a trade-off, an approval.
- When you own a goal, split it into ready, thin, end-to-end tasks with acceptance criteria, dispatch them, and land the goal when its work is done.

**Concepts.** A goal (`G-<number>`) is a long-running aim; tasks serve it through `goalId`. Work without a goal is loose work. A goal's owner agent (`ownerAgentId`) plans it, dispatches subagents and brings decisions back. A task (`T-<number>`) that has not started is in stage `fog` (an idea, not specified; never claimed or started automatically) or `ready` (specified). Any task or goal ID argument also accepts its reference; outputs carry `ref`.

The frontier is the set of tasks an agent may take now: `ready`, not started, unclaimed, `readyFor: "agent"`, and every blocker done. Never work a `readyFor: "human"` task. Before you work a frontier task in your own session, claim it with `claim_board_task`; release it with `release_board_task` if you stop. Goal Autopilot, which people set per goal, starts frontier tasks of the goal in new workspaces, or asks the user first; you cannot change its settings.

**`list_goals`** — optional `all: true` adds landed goals. Each goal includes `ref`, `ownerAgentId`, `tasks` (`total`, `done`), `autopilot`, and `landedAt`.

**`create_goal`** — required: `title`. Optional: `notes` (what done looks like) and `owner` (`"me"`, another agent ID, or `null`). Create one when the user hands you an aim bigger than one task.

**`update_goal`** — required: `goalId` (ID or `G-<number>`). Optional: `title`, `notes`, `owner`, `landed` (`true` when the goal's work is done).

**`request_decision`** — required: `title` (the question), `brief` (Markdown: what happened, what you prepared, what each option leads to, your recommendation), and `options` (2 to 8 labels or `{ id, label }`). Optional `goalId` (defaults to the goal you own) and `taskId`. Returns `decisionId` at once. The user's answer arrives later as a prompt in this conversation, with the chosen label and any note. End your turn or keep working; do not wait or poll.

**`list_board_tasks`** — optional `state` (`ahead`, `started`, `landed`), `stage` (`fog`, `ready`; tasks not started only), `goalId`, `projectId`, and `frontier: true`. Without filters, an owner agent sees its goals' tasks and other agents see their workspace's project. Each task includes `goalId`, `readyFor`, `claimedBy`, `onFrontier`, `openBlockers` (unfinished blockers), and `children` (`total`, `done`).

**`plan_board_tasks`** — record a plan atomically. Required: `tasks`, each with `key` and `title`; optional `notes`, `acceptanceCriteria` (strings), `readyFor`, `stage` (default `ready`), `parentKey` or `parentId`, and `blockedBy` (batch keys, existing task IDs, or `T-<number>`). Optional `projectId` defaults to the caller workspace's project, and `goalId` to the goal you own. The given order becomes the rank order. Slice the work into thin end-to-end vertical slices, each with its own acceptance criteria, and list blockers before the tasks they block.

**`create_board_task`** — required: `title`. Optional: `notes`, `projectId` (defaults to the caller workspace's project), `goalId` (defaults to the goal you own), `acceptanceCriteria` (strings), `parentId`, `blockedBy`, `readyFor` (default `agent`), `stage` (default `fog`). Creates a task without an agent or workspace.

**`update_board_task`** — optional `taskId` defaults to the task linked to your workspace. Change `title`, `notes`, `goalId` (`null` makes it loose work), `parentId` (`null` detaches), `blockedBy` (replaces the list), `readyFor`, `stage`, `summary`, or `completed`. Move a task to `ready` when the user commits to it or when you own its goal and have written its criteria. Tick criteria with `criteriaMet` (zero-based indexes) or replace them with `acceptanceCriteria` (`{ text, met }` items). When marking your task done, tick the criteria you met and write a one-paragraph `summary` of what changed, verification, and anything remaining that addresses each criterion.

**`claim_board_task`** / **`release_board_task`** — `{ taskId }` (ID or `T-<number>`). Claim needs a frontier task; claiming your own claim again is a no-op. Only the claiming agent can release. Starting, linking, or completing the task clears the claim.

**`start_board_task`** — required: `taskId` (ID or `T-<number>`), `isolation` (`local` or `worktree`), and either `profile` (saved profile name or ID) or `provider` with optional `model`, `modeId`, `thinkingOptionId`, `featureValues`. Use `list_profiles` to choose a profile. The task must have a project, be incomplete, have its blockers done, and have no active linked workspace. Its title, notes, and attachments become the first prompt. Returns `task`, `workspaceId`, and `agentId`; an agent-scoped call creates your subagent. Reuse `idempotencyKey` when retrying the same start.

## Workspace scripts

Configured `paseo.json` scripts use the same supervised lifecycle from tools and the CLI.

**`list_workspace_scripts`** — `{ workspaceId }`. Lists configured scripts with lifecycle, service port, proxy URLs, health, exit code, and terminal ID.

**`start_workspace_script`** — `{ workspaceId, scriptName }`. Starts one configured script through Paseo's managed workspace-script launcher and returns its status metadata.

**`stop_workspace_script`** — `{ workspaceId, scriptName }`. Stops a running script through its supervised terminal and returns the stopped status metadata.

The matching CLI surface accepts either an explicit workspace ID or resolves the current directory:

```bash
paseo script ls [--cwd <path> | --workspace <workspace-id>]
paseo script start <name> [--cwd <path> | --workspace <workspace-id>]
paseo script stop <name> [--cwd <path> | --workspace <workspace-id>]
```

## Agents

**`create_agent`** — required: `title`, `provider` (`claude/opus`, `codex/gpt-5.4`, …), `initialPrompt`. Optional: `workspaceId`, `notifyOnFinish`, `settings`, `labels`. Returns `{ agentId, workspaceId, … }`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. Agent profiles are the preferred source for these values. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

Agent-scoped creation always creates your subagent. On your own host, omit `workspaceId` to use your current workspace. On another host, first list or create a workspace with that `serverId`, then pass its `workspaceId` and the same `serverId` to `create_agent`. Placement never changes parentage.

Detach is an explicit user action in the subagents track, not an agent tool. A cross-workspace child remains your subagent even though it also appears as a normal tab in its workspace.

Agent-scoped `create_agent` defaults `notifyOnFinish` to true. Set it to `false` when you want explicit reporting or no completion callback.

**`send_agent_prompt`** — `{ agentId, prompt, activeTurnBehavior? }`. Use for follow-ups to an existing agent. Agent-scoped calls default to `steer`; top-level calls default to `interrupt`. Set `activeTurnBehavior` to `steer` or `interrupt` to override the default. Steering falls back to interruption when unavailable. CLI agent sends use the same defaults and accept `--behavior steer|interrupt`. Agent-scoped calls return a queued receipt immediately; messages to each recipient deliver after two quiet seconds. Top-level calls return after dispatch acknowledgement. Agent-scoped calls default `notifyOnFinish` to true; top-level calls have no parent callback.

**`update_agent`** — `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_agents`** — filter by `cwd`, `statuses`, `sinceHours`, `includeArchived`; set `includeBackground: true` to include agents in background workspaces.

**`archive_agent`** — `{ agentId }`. Interrupts if running, removes from active list.

## Agent profiles and provider discovery

**`list_profiles`** — named launch bundles configured by the human. Before choosing how to launch a delegated agent, call this tool and read every profile's `notes`. Pick a named profile the user requested, or the profile whose notes best match the work.

There is no `profile` parameter on `create_agent`. Materialize the selected profile into the call:

- combine `provider` and `model` as the `provider/model` value for `create_agent.provider`
- copy `modeId` to `settings.modeId`
- copy `thinkingOptionId` to `settings.thinkingOptionId`
- copy `featureValues` to `settings.features`

Omit absent values. Do not remember a selected profile or infer drift later; a profile is only launch configuration.

If no profile fits, or no profiles are configured, use the provider discovery tools below rather than guessing. Tell the user when you fall back because no configured profile fits.

**`list_providers`** — compact provider availability and modes.

**`list_models`** — full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** — compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_agent` or `update_agent`.

## Schedules and heartbeats

**`create_schedule`** — starts a new agent on a cron cadence. Required: `prompt`, `cron`, `provider`. Optional: `timezone`, `name`, `cwd`, `maxRuns`, `expiresIn`. Use when the recurring work should live in fresh agents.

**`create_heartbeat`** — sends you a prompt on a cron cadence. Required: `prompt`, `cron`. Optional: `timezone`, `name`, `maxRuns`, `expiresIn`. Use for reminders, PR/build babysitting, and status checks that should return to this conversation.

**`delete_heartbeat`** stops it. MCP intentionally exposes no heartbeat update tool; delete and recreate when its task or cadence changes.

Schedules have the full list/inspect/update/pause/resume/run-once/log/delete surface. Heartbeats deliberately do not.

## Waiting

When you create or prompt a subagent, `notifyOnFinish` defaults to `true` and reports completion, errors, or permission requests, including across hosts.
Finish your turn and wait for that notification instead of polling.
If you want an explicit reply with `send_agent_prompt`, have the sender check `list_hosts` for the recipient’s server before setting `notifyOnFinish: false`.

## CLI semantics

The CLI and tools use the same ownership semantics even where their syntax differs:

```bash
paseo workspace create --isolation worktree --mode branch-off --new-branch fix-x --base origin/main
paseo workspace create --isolation worktree --mode checkout-branch --branch existing-work
paseo workspace create --isolation worktree --mode checkout-pr --pr-number 42
paseo run --provider codex/gpt-5.4 --mode full-access --workspace <workspace-id> "<prompt>"
paseo run --provider codex/gpt-5.4 --mode full-access --new-workspace worktree --worktree-mode branch-off --new-branch fix-x --base origin/main "<prompt>"
paseo send <agent-id> "<follow-up>"
paseo ls
paseo schedule create --cron "*/15 * * * *" "ping main build"
paseo heartbeat create --cron "*/15 * * * *" "check the build"
```

Discover with `paseo --help` and `paseo <cmd> --help`.

For product questions, setup, logs, version problems, or troubleshooting, use the **paseo-help** skill.
