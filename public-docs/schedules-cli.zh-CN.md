---
title: 在 CLI 中使用定时任务
description: 用 paseo schedule 创建和管理 Paseo 定时任务。
nav: CLI
---

# 在 CLI 中使用定时任务 {#schedules-from-the-cli}

`paseo schedule` 在终端中创建和管理[定时任务](/docs/schedules)。默认每次运行都会启动一个新的 Agent。使用 `--board-task` 可以把工作加入看板，而不启动 Agent。

默认情况下，每次运行结束时都会归档其工作区。CLI 没有 **Archive on finish** 参数；要让之后的运行工作区保持活跃，请[在应用中修改该选项](/docs/schedules#keep-run-workspaces)。

## 创建 {#create}

在 Codex 上通宵重构：

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

在 Claude 上看护耗时较长的构建：

```bash
paseo schedule create \
  --every 5m \
  --name build-watch \
  --provider claude/opus-4.7 \
  --cwd ~/dev/my-app \
  --max-runs 24 \
  "Check the release build. If it failed, inspect logs, fix the cause, and rerun."
```

通过 OpenCode 使用 GLM 每天分拣 GitHub：

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

纽约时间早上 9 点进行晨间分拣，并跟随夏令时变化：

```bash
paseo schedule create \
  --cron "0 9 * * 1-5" \
  --timezone America/New_York \
  --name morning-triage \
  --provider codex/gpt-5.5 \
  --cwd ~/dev/my-app \
  "Review overnight CI failures and summarize anything urgent."
```

## 创建看板任务 {#file-board-tasks}

每次运行在工作台创建一个迷雾任务：

```bash
paseo schedule create \
  --board-task \
  --cron "0 9 * * 1-5" \
  --name morning-review \
  --project <project-id> \
  --notes "Review overnight CI failures and note anything urgent" \
  "Morning CI review"
```

位置参数是任务标题。`--notes` 和 `--project` 可选。不要把 `--board-task` 与 Agent 参数或 `--cwd` 混用。此目标不会创建工作区或 Agent；之后可用 [`paseo task start`](/docs/cli#board-tasks) 启动任务。

可使用与其他定时任务相同的列出、查看、暂停、恢复、更新、单次运行、日志和删除命令。`update --prompt` 修改以后创建的任务标题。运行日志包含创建的 `taskId`。通过 CLI 管理看板定时任务；应用中的定时任务表单仍只支持 Agent。如果 CLI 提示不支持看板任务，请升级主机。

## heartbeat {#heartbeats}

在一个正在运行的 Paseo Agent 中，为同一段对话创建 heartbeat：

```bash
paseo heartbeat create \
  --cron "*/20 * * * *" \
  --name heartbeat \
  "Check the current task state and continue with the next useful step."
```

heartbeat 的接口有意保持精简：

```bash
paseo heartbeat update <id> --cron "*/10 * * * *"
paseo heartbeat delete <id>
```

更新 heartbeat 只会改变它的 cron 节奏和可选的时区。它的目标和提示词保持不变。heartbeat 命令需要 `PASEO_AGENT_ID`，Paseo 会在 Agent 会话中设置它。

heartbeat 需要原始的 `--cron` 表达式。下文的 `--every` 预设适用于新建 Agent 和看板定时任务。

## 管理 {#manage}

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

## 节奏 {#cadence}

使用 `--cron "<expr>"` 指定 5 字段的 cron 表达式。对于常见的、可用 cron 表示的节奏，`--every <duration>` 接受 `5m` 或 `1h` 这样的预设，并把它们编译为 cron。它不会创建以创建时间为起点的滚动间隔。

定时任务默认使用 UTC。传入 `--timezone <IANA>` 可以按本地挂钟时区解释 cron 字段，例如 `--timezone America/New_York`。持久化的 `nextRunAt` 仍然是 UTC 时刻，但它是按该本地时区计算的，因此重复任务在夏令时变化前后都保持在相同的本地时间。

定时任务默认等待下一个匹配的 cron 时间。传入 `--run-now` 可以在创建时立即运行一次。

以远程 daemon 为目标时，用 `paseo --host <target> schedule create ...` 开始命令。新建 Agent 的定时任务需要传入 `--cwd`；你本地的工作目录在远程机器上可能不存在。看板定时任务则使用远程主机上的项目 ID。
