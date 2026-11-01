---
title: Schedules from the CLI
description: Create and manage Paseo schedules with paseo schedule.
nav: CLI
order: 27
category: Schedules
---

# Schedules from the CLI

`paseo schedule` creates and manages [schedules](/docs/schedules) from your terminal. By default, each run starts a fresh agent. Use `--board-task` to file work in the Board without starting an agent.

Run workspaces are archived when each run ends by default. The CLI has no **Archive on finish** flag; [change the option in the app](/docs/schedules#keep-run-workspaces) to keep subsequent run workspaces active.

## Create

Overnight refactor on Codex:

```bash
paseo schedule create \
  --every 30m \
  --name overnight-refactor \
  --provider codex/gpt-5.5 \
  --cwd ~/dev/my-app \
  --max-runs 16 \
  --expires-in 10h \
  "Continue the refactor. Run the focused checks. Leave a short status note."
```

Long build babysitter on Claude:

```bash
paseo schedule create \
  --every 5m \
  --name build-watch \
  --provider claude/opus-4.7 \
  --cwd ~/dev/my-app \
  --max-runs 24 \
  "Check the release build. If it failed, inspect logs, fix the cause, and rerun."
```

Daily GitHub triage on GLM through OpenCode:

```bash
paseo schedule create \
  --cron "0 14 * * 1-5" \
  --timezone UTC \
  --run-now \
  --name github-triage \
  --provider opencode/openrouter/glm-5.1 \
  --cwd ~/dev/my-app \
  "Triage GitHub issues, PRs, and failing checks. Summarize what needs attention."
```

Morning triage at 9 AM in New York, including daylight saving time changes:

```bash
paseo schedule create \
  --cron "0 9 * * 1-5" \
  --timezone America/New_York \
  --name morning-triage \
  --provider codex/gpt-5.5 \
  --cwd ~/dev/my-app \
  "Review overnight CI failures and summarize anything urgent."
```

## File Board tasks

Create one fog task on the Desk on each run:

```bash
paseo schedule create \
  --board-task \
  --cron "0 9 * * 1-5" \
  --name morning-review \
  --project <project-id> \
  --notes "Review overnight CI failures and note anything urgent" \
  "Morning CI review"
```

The positional argument is the task title. `--notes` and `--project` are optional. Do not combine `--board-task` with agent options or `--cwd`. This target creates no workspace or agent; start the task later with [`paseo task start`](/docs/cli#board-tasks).

Use the same list, inspect, pause, resume, update, run-once, logs, and delete commands as other schedules. `update --prompt` changes the title of future tasks. Run logs include the created `taskId`. Board task schedules are managed through the CLI; the app schedule form remains agent-only. Upgrade the host if the CLI reports that Board tasks are unsupported.

## Heartbeats

Inside a running Paseo agent, create a heartbeat for that same conversation:

```bash
paseo heartbeat create \
  --cron "*/20 * * * *" \
  --name heartbeat \
  "Check the current task state and continue with the next useful step."
```

The heartbeat interface is deliberately small:

```bash
paseo heartbeat update <id> --cron "*/10 * * * *"
paseo heartbeat delete <id>
```

Updating a heartbeat changes only its cron cadence and optional time zone. Its target and prompt stay fixed. Heartbeat commands require `PASEO_AGENT_ID`, which Paseo sets inside agent sessions.

Heartbeats require a raw `--cron` expression. The `--every` presets below are available for new-agent and Board task schedules.

## Manage

```bash
paseo schedule ls
paseo schedule inspect <id>
paseo schedule logs <id>
paseo schedule pause <id>
paseo schedule resume <id>
paseo schedule run-once <id>
paseo schedule update <id> --every 10m --max-runs 6
paseo schedule delete <id>
```

## Cadence

Use `--cron "<expr>"` for a 5-field cron expression. For common cron-compatible cadences, `--every <duration>` accepts presets such as `5m` or `1h` and compiles them to cron. It does not create a rolling interval anchored to creation time.

Schedules default to UTC. Pass `--timezone <IANA>` to interpret cron fields in a local wall-clock time zone, for example `--timezone America/New_York`. The persisted `nextRunAt` is still a UTC instant, but it is computed from that local time zone so recurring jobs stay at the same local time across daylight saving time changes.

Schedules wait for the next matching cron time by default. Pass `--run-now` to start one immediate run on creation.

Start the command with `paseo --host <target> schedule create ...` when targeting a remote daemon. For new-agent schedules, pass `--cwd`; your local working directory may not exist on the remote machine. Board task schedules use the remote host's project ID instead.
