---
title: MCP reference
description: Reference for the Paseo tools agents use to manage agents, workspaces, scripts, terminals, and schedules.
nav: MCP reference
order: 34
category: Orchestration
---

# MCP reference

[Enable Paseo tools](/docs/orchestration#get-started) to give agents this catalog. Ask for an outcome in natural language, or use the tool interfaces below.

## Configuration

| Setting                       | Default | Purpose                                            |
| ----------------------------- | ------- | -------------------------------------------------- |
| `daemon.mcp.enabled`          | `true`  | Run the MCP server.                                |
| `daemon.mcp.injectIntoAgents` | `false` | Give agents launched by Paseo access to its tools. |

Depending on the provider, Paseo delivers tools through its native tool interface or MCP. The capabilities are the same. Start a new agent or reload an existing one after changing injection settings.

## Limit Paseo tools by provider

Use provider policies when different agent profiles should receive different Paseo tools. Enable
tool injection globally, then add `paseoTools` to the exact provider IDs you launch:

```json
{
  "$schema": "https://paseo.sh/schemas/paseo.config.v1.json",
  "version": 1,
  "daemon": {
    "mcp": {
      "enabled": true,
      "injectIntoAgents": true
    }
  },
  "agents": {
    "providers": {
      "codex-lead": {
        "extends": "codex",
        "label": "Codex Lead"
      },
      "codex-worker": {
        "extends": "codex",
        "label": "Codex Worker",
        "paseoTools": {
          "disabledTools": ["create_agent", "send_agent_prompt", "kill_agent"]
        }
      },
      "codex-isolated": {
        "extends": "codex",
        "label": "Codex Isolated",
        "paseoTools": {
          "enabled": false
        }
      }
    }
  }
}
```

Run `paseo reload` after editing `~/.paseo/config.json`, then start a new agent or reload an
existing one. A running session keeps the catalog it received at launch.

Omitting `paseoTools` enables the complete catalog. Set `enabled` to `false` to remove the catalog,
or list exact tool IDs in `disabledTools` to remove selected tools. Custom profiles do not inherit
this policy from `extends`; configure each custom provider ID separately.

Browser tools still require browser tools to be enabled and a connected browser host. The
voice-only `speak` tool is separate from this policy.

This setting limits the catalog presented to an agent. It is not a security boundary for an agent
that can access the host through a shell.

## Label MCP calls

The **MCP calls** page in the sidebar lists recent calls on each connected host. Tool arguments are
stored; results are not. Filter the list by tool name, caller, host, outcome, or label.

To tag the calls of an external client, add `label` to the MCP URL you give that client:

```text
http://127.0.0.1:6767/mcp/agents?label=cursor
```

Separate values with commas or repeat the parameter to add several labels. Calls from an agent carry
that agent's labels as `key=value`, including labels set through `create_agent`; Paseo's internal
`paseo.*` labels are left out. A call keeps at most 8 labels of up to 48 characters each.

## Mental model

Workspaces decide where work happens; agent parentage decides who owns the work.

- An agent that calls `create_agent` without a `workspaceId` gets a subagent in its own workspace.
- Passing a `workspaceId` places that subagent in another workspace without detaching it from its parent.
- A top-level MCP caller without a workspace gets a new local workspace.
- Create a workspace first when you need worktree isolation, a specific branch, or a pull request checkout.

MCP does not expose an agent-detach tool. Detaching is a manual user action in the app or CLI.

## Tools

### Agents

| Tool                 | Function                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_agent`       | Create an agent, optionally placing it in an existing workspace with `workspaceId`. Use `initialPrompt` to start work; returns without waiting for completion. `background: true` hides it from tabs, default lists, your subagent track and notifications; you still get its finish notification. Omission inherits your own value. |
| `send_agent_prompt`  | Send a prompt using `agentId` and `prompt`; returns without waiting for completion.                                                                                                                                                                                                                                                  |
| `get_agent_status`   | Return the latest snapshot for an agent.                                                                                                                                                                                                                                                                                             |
| `read_agent_context` | Read an agent's source metadata without loading its transcript; defaults to the calling agent.                                                                                                                                                                                                                                       |
| `read_agent_history` | Read a bounded history page, anchored by message ID or cursor.                                                                                                                                                                                                                                                                       |
| `list_agents`        | List recent agents as compact metadata; `includeBackground: true` includes background work.                                                                                                                                                                                                                                          |
| `cancel_agent`       | Abort an agent's current run but keep the agent alive.                                                                                                                                                                                                                                                                               |
| `archive_agent`      | Soft-delete an agent and remove it from the active list.                                                                                                                                                                                                                                                                             |
| `kill_agent`         | Terminate an agent session permanently.                                                                                                                                                                                                                                                                                              |
| `update_agent`       | Update an agent name, labels, or runtime settings such as mode/model/thinking/features.                                                                                                                                                                                                                                              |
| `get_agent_activity` | Return recent agent timeline entries as a curated summary.                                                                                                                                                                                                                                                                           |
| `set_agent_mode`     | Switch an agent's session mode.                                                                                                                                                                                                                                                                                                      |

Paseo agents receive finish, error, and permission notifications by default; set `notifyOnFinish: false` to disable them. External MCP clients can use HTTP completion callbacks or inspect results with `get_agent_status` and `get_agent_activity`.

#### HTTP completion callbacks

In the Seefs fork, `create_agent` and `send_agent_prompt` accept an optional string
`onFinishWebhook`. Set `PASEO_ON_FINISH_WEBHOOK` in the daemon environment for a default;
the request URL takes precedence. The URL may contain a query key. An optional string
`replyToAgentId` is echoed in the body; it does not send an agent message.
These callbacks work without a caller agent and independently of `notifyOnFinish`.

```json
{
  "agentId": "agent_123",
  "prompt": "Finish the implementation",
  "onFinishWebhook": "https://hooks.example.com/paseo?key=YOUR_KEY",
  "replyToAgentId": "orchestrator_123"
}
```

Connect MCP directly to the daemon that owns the agent. A different `serverId` with an
explicit or default callback is rejected before dispatch. Without a callback, existing
cross-host behavior is unchanged.

Paseo sends `POST` with `Content-Type: application/json`:

```json
{
  "event": "agent.finish",
  "source": "paseo",
  "agentId": "agent_123",
  "status": "idle",
  "runId": "turn_123",
  "finishedAt": "2026-10-30T12:00:00.000Z",
  "title": "Finish implementation",
  "workspaceId": "workspace_123",
  "serverId": "server_123",
  "lastResponse": "Implementation complete.",
  "replyToAgentId": "orchestrator_123"
}
```

- Status is `idle` after a turn, `error`, `pendingPermissions`, or `closed`.
  Initial idle state is not completion. Permission checkpoints do not stop observation.
- Each `(agentId, status, runId)` produces one delivery. Retries reuse the same body,
  `finishedAt`, and `Idempotency-Key` header. Deduplicate that key at the receiver:
  an HTTP timeout can occur after the receiver has accepted a POST.
- `lastResponse` is the reported turn’s last assistant text from the live timeline tail,
  limited to 4,000 characters, or an empty string when unavailable. Optional metadata is omitted when absent.
- Delivery runs in the background, with at most three attempts, 1s/2s backoff, and a 10s
  timeout per attempt. Non-2xx responses fail. Redirects are not followed.
- Only HTTPS is accepted. For a local mock, explicitly set
  `PASEO_ON_FINISH_WEBHOOK_ALLOW_HTTP_LOCALHOST=1` to allow HTTP to `localhost`,
  `127.0.0.1`, or `[::1]`. URL userinfo and fragments are rejected.
  MCP call logs redact the whole callback URL; delivery logs omit URLs and response bodies.
- A successful MCP prompt dispatch replaces the agent's callback with that request's URL
  or the environment default. Without either, it removes the previous callback.
  Other agent turns retain the current callback until replacement or agent deletion.
- Registration and deduplication live in daemon memory, not in the MCP connection.
  Restarting the daemon loses registrations and pending deliveries. Shutdown does not send
  synthetic `closed` callbacks. This is best-effort notification, not a durable queue.

Rebuild the server stack and restart the daemon to install this change or change its environment.
Reconnect the MCP client to refresh its tool schema; no separate MCP server build is needed.
For `paseo.seefs.dev`, update the daemon serving that origin, not only the web app.

### Workspaces

| Tool                | Function                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_workspace`  | Create a local or worktree-isolated workspace. Worktrees can branch off, check out a branch, or a PR. `background: true` hides it from default lists and the sidebar while preserving history and access by ID. Omission inherits the calling agent’s workspace setting, or defaults to false without a caller. |
| `list_workspaces`   | List active workspaces and their directories and isolation. Use `includeBackground: true` to include background workspaces.                                                                                                                                                                                     |
| `rename_workspace`  | Change the user-visible name of the current or specified workspace.                                                                                                                                                                                                                                             |
| `archive_workspace` | Archive a workspace and the sessions it owns.                                                                                                                                                                                                                                                                   |

For worktree isolation, `create_workspace` accepts the same useful choices as the app: branch off from a base, check out an existing branch, or check out a pull request. The worktree remains an implementation detail of the workspace lifecycle.

### Desk tasks and goals {#board-tasks}

These tools work on the Desk of the calling host. Push right: do as much as you can, then bring the user a prepared brief instead of stopping at every step.

A **goal** (`G-<number>`) is a long-running aim that tasks serve. A goal may have an **owner agent**: it plans the goal, splits it into ready tasks, dispatches subagents and brings real choices back as decisions. A **task** (`T-<number>`) that has not started is in stage `fog` (an idea, not specified yet; agents and Autopilot never take it) or `ready` (specified work). Each tool that takes a task or goal ID also accepts its reference. Outputs include `ref` next to `id`.

| Tool                 | Function                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_board_tasks`   | Filter by `state` (`ahead`, `started`, `landed`), `stage` (`fog`, `ready`; tasks not started only), `goalId`, `projectId`, and `frontier: true`. Without filters, an agent that owns goals sees those goals' tasks; other agents see their workspace's project. Each task includes `goalId`, `readyFor`, `claimedBy`, `onFrontier`, `openBlockers`, and `children` counts.                                                 |
| `plan_board_tasks`   | Create a whole plan atomically, in the given order. Tasks default to `ready`; set `stage: "fog"` per task for ideas. Each task has a `key`; `parentKey` and `blockedBy` can name keys from the batch, and `parentId` and `blockedBy` also accept existing task IDs or `T-<number>`. Acceptance criteria are strings.                                                                                                       |
| `create_board_task`  | Create one task with `title`, optional `notes`, `projectId`, `goalId`, `acceptanceCriteria` (strings), `parentId`, `blockedBy`, `readyFor`, and `stage` (default `fog`). Does not start work.                                                                                                                                                                                                                              |
| `update_board_task`  | Change fields, move a task between `fog` and `ready` with `stage`, assign `goalId` (`null` makes it loose work), tick criteria with `criteriaMet` (zero-based indexes) or replace them with `acceptanceCriteria`, and set `summary` or `completed`. Omit `taskId` to update the task linked to your workspace.                                                                                                             |
| `claim_board_task`   | Claim a frontier task for the calling agent before working it in its own session.                                                                                                                                                                                                                                                                                                                                          |
| `release_board_task` | Give back a task the calling agent claimed.                                                                                                                                                                                                                                                                                                                                                                                |
| `start_board_task`   | Start `taskId` with `isolation: "local" \| "worktree"` and either `profile` (saved name or ID) or `provider` with optional `model`, `modeId`, `thinkingOptionId`, and `featureValues`.                                                                                                                                                                                                                                     |
| `list_goals`         | List goals with their owner, task counts and `landedAt`. Landed goals only with `all: true`.                                                                                                                                                                                                                                                                                                                               |
| `create_goal`        | Create a goal with `title` and optional `notes`. `owner: "me"` makes the caller its owner agent; another agent ID or `null` also works.                                                                                                                                                                                                                                                                                    |
| `update_goal`        | Change `title`, `notes`, `owner` (`"me"`, an agent ID, or `null`), or `landed`.                                                                                                                                                                                                                                                                                                                                            |
| `request_decision`   | Ask the user to choose. `title` is the question, `brief` is Markdown (what happened, what you prepared, what each option leads to, your recommendation), and `options` are 2 to 8 plain labels or `{ id, label }`. Optional `goalId` and `taskId`. Returns the decision ID at once.                                                                                                                                        |
| `register_artifact`  | Add a file to the caller workspace's Artifacts, or update one. Pass `path` (inside the workspace) or `content` with `fileName`, plus `title` and `kind` (`plan`, `notes`, `diagram`, `prototype`, `screenshot`, `report`, `result`, `summary`). The daemon stores a copy. The same `path`, or `artifactId`, updates the entry and raises its revision. `goalId` and `taskIds` default to the task linked to the workspace. |
| `list_artifacts`     | The caller workspace's Artifacts, or with `goalId` every artifact that serves the goal, including those of archived workspaces.                                                                                                                                                                                                                                                                                            |
| `read_artifact`      | The stored content of one artifact by id, including artifacts of archived workspaces: the entry, `encoding` (`base64` for images, `utf8` otherwise) and `content`. Read it before citing an artifact as evidence.                                                                                                                                                                                                          |

`create_board_task`, `plan_board_tasks` and `request_decision` default `goalId` to the goal the caller owns when it owns exactly one. The project defaults to the caller workspace's project.

The frontier is the set of tasks an agent may take now: `ready`, not started, unclaimed, `readyFor: "agent"`, and every blocker done. Agents never work `readyFor: "human"` tasks. Record follow-ups as fog tasks rather than starting work. An owner agent splits its goal into thin end-to-end tasks with their own acceptance criteria, lists blockers before the tasks they block, and starts them with `start_board_task`. When you finish your task, tick the criteria you met and write a one-paragraph `summary` that addresses each criterion.

Use `request_decision` for real choices only: a direction, a trade-off, an approval. Do not use it for status updates. The decision shows on the user's Desk as a brief. The answer arrives later as a prompt in the same conversation, with the chosen label and the user's note, so end your turn or keep working instead of waiting.

Starting requires a project, an incomplete task, unfinished blockers done, and no active linked workspace. A person or a `start_board_task` call can start a task in either stage. The task's title, notes, and attachments become the first prompt. The tool returns `task`, `workspaceId`, and `agentId`. Agent-scoped starts create a subagent of the caller. Supply the same `idempotencyKey` on retries to reuse the workspace and agent.

Agents cannot change a goal's [Autopilot](/docs/cli#autopilot); people set it on the Desk or with `paseo goal autopilot`.

Register artifacts a person would open again, not logs or edited source files. Registering records nothing on the Desk and never completes a task. The user opens the Artifacts tab from the workspace's + menu, or opens a product from its goal.

### Workspace scripts

These tools manage scripts configured in a workspace's `paseo.json`. Each requires an explicit `workspaceId`; start and stop also require the configured `scriptName`.

| Tool                     | Function                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `list_workspace_scripts` | List configured scripts with lifecycle, terminal, port, proxy URL, and health metadata. |
| `start_workspace_script` | Start a configured script through Paseo's managed launcher.                             |
| `stop_workspace_script`  | Stop a running script through its supervised terminal.                                  |

See [Git worktrees](/docs/worktrees#scripts-and-services) for `paseo.json` configuration.

### Terminals

| Tool                 | Function                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `list_terminals`     | List terminal sessions for one working directory or all working directories. |
| `create_terminal`    | Create a terminal session for a working directory.                           |
| `kill_terminal`      | Kill a terminal session.                                                     |
| `capture_terminal`   | Capture plain-text output from a terminal session.                           |
| `send_terminal_keys` | Send text or special key tokens to a terminal session.                       |

### Schedules and heartbeats

Both use the same cron engine, but they have deliberately different interfaces.

| Tool                | Function                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `create_schedule`   | Create a cron schedule that starts a new agent for each run.                 |
| `list_schedules`    | List new-agent schedules managed by the daemon.                              |
| `inspect_schedule`  | Inspect a schedule and its run history.                                      |
| `pause_schedule`    | Pause an active schedule.                                                    |
| `resume_schedule`   | Resume a paused schedule.                                                    |
| `update_schedule`   | Change a schedule's cron, prompt, agent settings, limits, or other settings. |
| `schedule_logs`     | Return recent runs and output for a schedule.                                |
| `run_schedule_once` | Start one new-agent schedule run without changing its cron.                  |
| `delete_schedule`   | Delete a new-agent schedule permanently.                                     |
| `create_heartbeat`  | Send a recurring cron-backed prompt into the current agent.                  |
| `delete_heartbeat`  | Delete one of the current agent's heartbeats.                                |

MCP heartbeats are ephemeral: create or delete them. To change one, delete it and create a replacement. Pause, resume, update, inspect, logs, and run-once apply to new-agent schedules only.

New-agent run workspaces are archived when each run ends by default. `create_schedule` and `update_schedule` do not expose **Archive on finish** (`archiveOnFinish`); [change the option in the app](/docs/schedules#keep-run-workspaces) to keep subsequent run workspaces active.

### Agent profiles

| Tool            | Function                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_profiles` | Return the host's saved agent profiles, including their notes and launch settings. Returns an empty list when none are configured. |

Before delegating, read each profile's `notes` and choose the profile the user named or the one that fits the task. See [Agent profiles](/docs/agent-profiles) for setup and example notes.

`create_agent` has no profile parameter and requires a `provider/model` pair. If the profile has no model, call `list_models` for its provider and choose an available model for the task before launching. Apply the chosen profile's values to the launch request:

| Profile field                   | `create_agent` field                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `provider` and optional `model` | `provider` as `provider/model`, using the saved or discovered model ID      |
| `modeId`                        | `settings.modeId`                                                           |
| `thinkingOptionId`              | `settings.thinkingOptionId`                                                 |
| `featureValues`                 | `settings.features`                                                         |
| `notes`                         | Selection guidance for the orchestrator; supply the task in `initialPrompt` |

Omit absent optional settings. If no profile fits, use provider discovery to choose available settings.

### Providers

| Tool               | Function                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `list_providers`   | List configured agent providers, availability, and modes.         |
| `list_models`      | List models for an agent provider.                                |
| `inspect_provider` | Inspect compact provider capabilities and draft feature settings. |

### Permissions

| Tool                       | Function                                          |
| -------------------------- | ------------------------------------------------- |
| `list_pending_permissions` | Return pending permission requests across agents. |
| `respond_to_permission`    | Approve or deny a pending permission request.     |

### Browser

Browser automation is opt-in and adds tools for opening tabs, reading pages, clicking, typing, and taking screenshots. See the [Browser tools reference](/docs/browser-tools).

### Voice

| Tool    | Function                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `speak` | Speak text through daemon-managed voice output. Available only in voice-enabled sessions. |
