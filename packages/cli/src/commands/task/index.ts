import { Command, Option } from "commander";
import type { BoardGoal, BoardTask } from "@getpaseo/protocol/messages";
import { withOutput, type ListResult, type SingleResult } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import {
  loadBoard,
  resolveAgent,
  resolveGoalId,
  resolveTaskId,
  taskSchema,
  toAppliedCommandError,
  toTaskRows,
  validateAgentOptions,
  withTaskClient,
  type TaskOptions,
  type TaskRow,
} from "./shared.js";

async function listTasks(options: TaskOptions, _command: Command): Promise<ListResult<TaskRow>> {
  return withTaskClient(options, async (client) => {
    const payload = await loadBoard(client);
    const goalId =
      options.goal === undefined ? undefined : resolveGoalId(payload.goals, options.goal);
    const tasks = payload.tasks.filter(
      (task) =>
        (options.all || task.completedAt === null) &&
        (goalId === undefined || task.goalId === goalId) &&
        // A stage filter lists tasks that have not started, the ones in that stage of Ahead.
        (options.stage === undefined ||
          (task.stage === options.stage && task.workspaceId === null && task.completedAt === null)),
    );
    return {
      type: "list",
      data: await toTaskRows(client, tasks, payload),
      schema: taskSchema,
    };
  });
}

/** Each `--criterion` becomes one unchecked item; on edit the list replaces the current one. */
function toCriteria(texts: string[] | undefined) {
  return texts?.map((text) => ({ text, met: false }));
}

async function addTask(
  title: string,
  options: TaskOptions,
  _command: Command,
): Promise<SingleResult<TaskRow>> {
  return withTaskClient(options, async (client) => {
    const { tasks, goals } = await loadBoard(client);
    const task = await client.createBoardTask({
      title,
      notes: options.notes,
      projectId: options.project,
      acceptanceCriteria: toCriteria(options.criterion),
      parentId: options.parent === undefined ? undefined : resolveTaskId(tasks, options.parent),
      blockedBy: options.blockedBy?.map((ref) => resolveTaskId(tasks, ref)),
      readyFor: options.readyFor,
      stage: options.stage,
      goalId: toGoalId(goals, options.goal),
    });
    const [row] = await toTaskRows(client, [task]).catch((error: unknown) => {
      throw toAppliedCommandError({ entity: "task", id: task.id, error });
    });
    return { type: "single", data: row!, schema: taskSchema };
  });
}

async function editTask(
  id: string,
  options: TaskOptions,
  _command: Command,
): Promise<SingleResult<TaskRow>> {
  const fields = [
    options.title,
    options.notes,
    options.summary,
    options.criterion,
    options.parent,
    options.blockedBy,
    options.readyFor,
    options.stage,
    options.goal,
  ];
  if (fields.every((value) => value === undefined)) {
    throw {
      code: "NO_UPDATES",
      message:
        "Specify --title, --notes, --summary, --criterion, --parent, --blocked-by, --ready-for, --stage, or --goal",
    };
  }
  return updateTask(id, options);
}

/** An empty --parent detaches the task from its parent. */
function toParentId(tasks: readonly BoardTask[], parent: string | undefined) {
  if (parent === undefined) return undefined;
  return parent === "" ? null : resolveTaskId(tasks, parent);
}

/** An empty --goal moves the task to Loose work. */
function toGoalId(goals: readonly BoardGoal[], goal: string | undefined) {
  if (goal === undefined) return undefined;
  return goal === "" ? null : resolveGoalId(goals, goal);
}

async function updateTask(
  id: string,
  options: TaskOptions,
  completed?: boolean,
): Promise<SingleResult<TaskRow>> {
  return withTaskClient(options, async (client) => {
    const { tasks, goals } = await loadBoard(client);
    const task = await client.updateBoardTask({
      taskId: resolveTaskId(tasks, id),
      title: options.title,
      notes: options.notes,
      summary: options.summary,
      acceptanceCriteria: toCriteria(options.criterion),
      parentId: toParentId(tasks, options.parent),
      blockedBy: options.blockedBy?.map((ref) => resolveTaskId(tasks, ref)),
      readyFor: options.readyFor,
      stage: options.stage,
      goalId: toGoalId(goals, options.goal),
      completed,
    });
    const [row] = await toTaskRows(client, [task]).catch((error: unknown) => {
      throw toAppliedCommandError({ entity: "task", id: task.id, error });
    });
    return { type: "single", data: row!, schema: taskSchema };
  });
}

async function removeTask(id: string, options: TaskOptions, _command: Command) {
  return withTaskClient(options, async (client) => {
    const taskId = resolveTaskId((await loadBoard(client)).tasks, id);
    await client.deleteBoardTask({ taskId });
    return {
      type: "single" as const,
      data: { id: taskId, status: "deleted" },
      schema: {
        idField: "id" as const,
        columns: [
          { header: "ID", field: "id" as const },
          { header: "STATUS", field: "status" as const },
        ],
      },
    };
  });
}

async function startTask(id: string, options: TaskOptions, _command: Command) {
  validateAgentOptions(options);
  if (!options.profile && !options.provider) {
    throw { code: "INVALID_AGENT", message: "Specify exactly one of --profile or --provider" };
  }
  return withTaskClient(options, async (client) => {
    const agent = await resolveAgent(client, options);
    const payload = await client.startBoardTask({
      taskId: resolveTaskId((await loadBoard(client)).tasks, id),
      isolation: options.isolation ?? "local",
      agent,
    });
    return {
      type: "single" as const,
      data: {
        id: payload.task.id,
        ref: `T-${payload.task.number}`,
        workspaceId: payload.workspaceId,
        agentId: payload.agentId,
      },
      schema: {
        idField: "id" as const,
        columns: [
          { header: "REF", field: "ref" as const },
          { header: "ID", field: "id" as const },
          { header: "WORKSPACE", field: "workspaceId" as const },
          { header: "AGENT", field: "agentId" as const },
        ],
      },
    };
  });
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function stageOption(description: string): Option {
  return new Option("--stage <stage>", description).choices(["fog", "ready"]);
}

function readyForOption(): Option {
  return new Option(
    "--ready-for <who>",
    "Who takes the task next; Autopilot and agents take only agent tasks",
  ).choices(["agent", "human"]);
}

export function createTaskCommand(): Command {
  const task = new Command("task").description("Manage Desk tasks");
  addJsonAndDaemonHostOptions(
    task
      .command("ls")
      .description("List unfinished tasks")
      .option("--all", "Include Done tasks")
      .option("--goal <id>", "List only tasks that serve this goal ID or G-<number>")
      .addOption(stageOption("List only tasks not started yet in this stage")),
  ).action(withOutput(listTasks));
  addJsonAndDaemonHostOptions(
    task
      .command("add")
      .description("Add a task in Fog, or Ready with --stage ready")
      .argument("<title>")
      .option("--notes <text>", "Task notes")
      .option("--project <id>", "Project ID")
      .option("--goal <id>", "Goal ID or G-<number> the task serves")
      .option("--criterion <text>", "Acceptance criterion; repeat for more", collect)
      .option("--parent <id>", "Parent task ID or T-<number>")
      .option("--blocked-by <id...>", "Task IDs or T-<number> that must be Done first")
      .addOption(readyForOption())
      .addOption(stageOption("Stage (default: fog); agents take only Ready tasks")),
  ).action(withOutput(addTask));
  addJsonAndDaemonHostOptions(
    task
      .command("edit")
      .description("Edit a task")
      .argument("<id>", "Task ID or T-<number>")
      .option("--title <text>", "Task title")
      .option("--notes <text>", "Task notes")
      .option("--summary <text>", "Completion summary")
      .option("--criterion <text>", "Replace acceptance criteria; repeat for more", collect)
      .option("--parent <id>", 'Parent task ID or T-<number>; "" detaches the task')
      .option("--blocked-by <id...>", "Replace the task IDs or T-<number> that must be Done first")
      .option("--goal <id>", 'Goal ID or G-<number>; "" moves the task to Loose work')
      .addOption(readyForOption())
      .addOption(stageOption("Move a task that has not started between Fog and Ready")),
  ).action(withOutput(editTask));
  addJsonAndDaemonHostOptions(
    task
      .command("done")
      .description("Mark a task Done")
      .argument("<id>", "Task ID or T-<number>")
      .option("--summary <text>", "Completion summary"),
  ).action(
    withOutput((id: string, options: TaskOptions, _command: Command) =>
      updateTask(id, options, true),
    ),
  );
  addJsonAndDaemonHostOptions(
    task.command("reopen").description("Reopen a task").argument("<id>", "Task ID or T-<number>"),
  ).action(
    withOutput((id: string, options: TaskOptions, _command: Command) =>
      updateTask(id, options, false),
    ),
  );
  addJsonAndDaemonHostOptions(
    task.command("rm").description("Delete a task").argument("<id>", "Task ID or T-<number>"),
  ).action(withOutput(removeTask));
  addJsonAndDaemonHostOptions(
    task
      .command("start")
      .description("Start a task in a new workspace")
      .argument("<id>", "Task ID or T-<number>")
      .option("--profile <name|id>", "Agent profile name or ID")
      .option("--provider <provider/model>", "Agent provider and optional model")
      .option("--mode <id>", "Provider mode")
      .option("--thinking <id>", "Thinking option")
      .addOption(
        new Option("--isolation <kind>", "Workspace isolation")
          .choices(["local", "worktree"])
          .default("local"),
      ),
  ).action(withOutput(startTask));
  return task;
}
