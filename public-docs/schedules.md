---
title: Schedules
description: Run fresh agents on cron schedules or wake an existing agent with a heartbeat.
nav: Overview
order: 25
category: Schedules
---

# Schedules

A schedule runs work on a cron cadence. By default, it starts a fresh agent with a prompt and agent settings, optionally in a project. It can also [file a fog task on the Desk without starting an agent](/docs/schedules-cli#file-board-tasks).

Paseo also has **heartbeats**. A heartbeat sends a recurring prompt back into one existing agent so it can reassess and continue the same conversation.

Both concepts use the same cron engine, but their product surfaces stay separate:

- **Schedules** create a new agent, continue a selected conversation, or create a Board task each run. You can inspect, pause, resume, run once, update, or delete them.
- **Heartbeats** target one existing agent. They are intentionally lightweight: create or delete them over MCP; from the CLI you can also update only their cron period.

Cron is the canonical cadence. The CLI accepts simple presets such as `5m` or `1h`, but compiles them to cron rather than storing a separate interval type.

Both run on a cadence you set. To start an agent from an external event instead — a comment, a mention — see [Hub](/docs/hub).

## What it's for

- **Fresh recurring jobs:** start a clean agent for daily triage, reports, or maintenance.
- **Heartbeats:** have the current agent periodically reassess state and keep moving.
- **Build babysitting:** keep one agent checking CI, EAS, Docker, or release builds until they pass.
- **Daily triage:** scan issues, PRs, and failing checks every morning.
- **Maintenance sweeps:** refresh dependencies, audit docs, or clean stale branches.

## Ways to create one

- **In the app** — open the Schedules view and create one with agent settings, a cron cadence, an optional project, and a prompt. This is the main way to create and manage schedules.
- **[From chat](/docs/schedules-chat)** — ask the agent in a chat and it sets the schedule up for you.
- **[From the CLI](/docs/schedules-cli)** — `paseo schedule create`, for headless boxes and scripts.
- **[Over MCP](/docs/mcp)** — agents create and manage schedules programmatically.

## Choose a workspace and conversation

In the app, open **Schedules** and create or edit a schedule. Both target fields are optional:

- Leave **Workspace** and **Conversation** unselected to create a workspace and a new conversation each run. Select a project, or choose **No project** to run in the host user's home directory without assigning the workspace to a project. **No project** uses local isolation and requires an updated host.
- Choose **Workspace** only to create a new conversation in that workspace each run. Paseo does not create another workspace.
- Choose **Workspace** and **Conversation** to send the prompt to that same conversation each run. It keeps its current model and mode; the form hides new-agent settings.

The conversation picker lists available conversations in the selected workspace on the selected host. Changing or clearing the workspace clears the conversation selection. Update the host if these fields are unavailable.

Schedules targeting an existing conversation keep all schedule management actions, including prompt editing, pause, run once, and logs. If the conversation is busy, the run fails without interrupting it; the next cron time remains scheduled. Archived, deleted, or mismatched targets are rejected. If a run finds that its target is gone, it records the reason in the run log and ends the schedule. Archiving a target conversation also ends its schedules.

## Choose a role

For schedules that create a conversation, choose **Role** to apply instructions from a role on the selected host. **No role** leaves role instructions unset. A role's default Agent profile fills in the agent settings; you can change those settings before saving. Providers without per-agent system prompts cannot run a selected role.

The schedule saves the role name and instructions with its agent settings. Later role edits do not change saved schedules; select the role again and save to use its latest instructions. Schedules targeting an existing conversation keep that conversation's role and hide this field.

## Keep run workspaces

When no existing workspace is selected, each new-agent schedule run creates a workspace. **Archive on finish** is on by default: when the run ends, Paseo archives that workspace and its agent. With worktree isolation, archiving also removes the worktree after its last active workspace is archived.

To keep runs available, open the schedule in the app's Schedules view, turn off **Archive on finish**, and save. Paseo keeps each run's workspace and agent active until you archive them; runs that fail before creating an agent are still cleaned up. This option also applies to local isolation; archiving a local workspace leaves the project directory in place.

The stored option is `target.config.archiveOnFinish`, a boolean that defaults to `true` when omitted. The CLI and MCP schedule tools do not expose this option; use the app to change it. Schedules targeting an existing workspace never archive that workspace or its conversations, including after a failed run or when the schedule is deleted. **Archive on finish** is hidden for these targets. Heartbeats also have no automatic workspace cleanup.
