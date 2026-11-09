import { Command, Option } from "commander";
import type { BoardGoalUpdateOptions } from "@getpaseo/client/internal/daemon-client";
import type { BoardGoalAutopilot } from "@getpaseo/protocol/messages";
import { withOutput, type ListResult, type SingleResult } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import {
  loadBoard,
  parseLimit,
  resolveAgent,
  resolveGoalId,
  toAppliedCommandError,
  validateAgentOptions,
  withTaskClient,
} from "../task/shared.js";
import { goalSchema, toGoalRows, type GoalOptions, type GoalRow } from "./shared.js";

async function listGoals(options: GoalOptions, _command: Command): Promise<ListResult<GoalRow>> {
  return withTaskClient(options, async (client) => {
    const { goals, tasks } = await loadBoard(client);
    const shown = goals
      .filter((goal) => options.all || goal.landedAt === null)
      .sort((a, b) => a.rank - b.rank || a.number - b.number);
    return { type: "list", data: await toGoalRows(client, shown, tasks), schema: goalSchema };
  });
}

/** An empty --owner leaves the goal without an owner agent. */
function toOwner(owner: string | undefined) {
  if (owner === undefined) return undefined;
  return owner === "" ? null : owner;
}

async function addGoal(
  title: string,
  options: GoalOptions,
  _command: Command,
): Promise<SingleResult<GoalRow>> {
  return withTaskClient(options, async (client) => {
    const goal = await client.createBoardGoal({
      title,
      notes: options.notes,
      ownerAgentId: toOwner(options.owner),
    });
    const [row] = await toGoalRows(client, [goal], []);
    return { type: "single", data: row!, schema: goalSchema };
  });
}

async function updateGoal(
  id: string,
  options: GoalOptions,
  fields: Omit<BoardGoalUpdateOptions, "goalId">,
): Promise<SingleResult<GoalRow>> {
  return withTaskClient(options, async (client) => {
    const { goals, tasks } = await loadBoard(client);
    const goal = await client.updateBoardGoal({ goalId: resolveGoalId(goals, id), ...fields });
    const [row] = await toGoalRows(client, [goal], tasks).catch((error: unknown) => {
      throw toAppliedCommandError({ entity: "goal", id: goal.id, error });
    });
    return { type: "single", data: row!, schema: goalSchema };
  });
}

async function editGoal(id: string, options: GoalOptions, _command: Command) {
  if ([options.title, options.notes, options.owner].every((value) => value === undefined)) {
    throw { code: "NO_UPDATES", message: "Specify --title, --notes, or --owner" };
  }
  return updateGoal(id, options, {
    title: options.title,
    notes: options.notes,
    ownerAgentId: toOwner(options.owner),
  });
}

async function removeGoal(id: string, options: GoalOptions, _command: Command) {
  return withTaskClient(options, async (client) => {
    const goalId = resolveGoalId((await loadBoard(client)).goals, id);
    await client.deleteBoardGoal({ goalId });
    return {
      type: "single" as const,
      data: { id: goalId, status: "deleted" },
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

/** Flags override the current settings; a first setup starts from the defaults. */
function mergeAutopilot(
  current: BoardGoalAutopilot | null,
  agent: BoardGoalAutopilot["agent"],
  options: GoalOptions,
  limits: { maxActive?: number; dailyStartLimit?: number },
): BoardGoalAutopilot {
  return {
    enabled: options.enable ?? (options.disable ? false : (current?.enabled ?? false)),
    agent,
    isolation: options.isolation ?? current?.isolation ?? "worktree",
    maxActive: limits.maxActive ?? current?.maxActive ?? 1,
    dailyStartLimit: limits.dailyStartLimit ?? current?.dailyStartLimit ?? 10,
    confirmStarts: options.confirmStarts ?? current?.confirmStarts ?? false,
  };
}

async function setAutopilot(id: string, options: GoalOptions, _command: Command) {
  if (options.enable && options.disable) {
    throw { code: "INVALID_AUTOPILOT", message: "Specify only one of --enable or --disable" };
  }
  validateAgentOptions(options);
  const limits = {
    maxActive: parseLimit(options.maxActive, "--max-active", 20),
    dailyStartLimit: parseLimit(options.dailyLimit, "--daily-limit", 200),
  };
  const changes = [
    options.enable,
    options.disable,
    options.profile,
    options.provider,
    options.isolation,
    limits.maxActive,
    limits.dailyStartLimit,
    options.confirmStarts,
  ];
  return withTaskClient(options, async (client) => {
    const { goals, tasks } = await loadBoard(client);
    const goalId = resolveGoalId(goals, id);
    let goal = goals.find((candidate) => candidate.id === goalId)!;
    const hasChanges = changes.some((value) => value !== undefined);
    if (hasChanges) {
      const agent =
        options.profile || options.provider
          ? await resolveAgent(client, options)
          : goal.autopilot?.agent;
      if (!agent) {
        throw new Error("Specify --profile or --provider the first time you set up Autopilot");
      }
      goal = await client.updateBoardGoal({
        goalId,
        autopilot: mergeAutopilot(goal.autopilot, agent, options, limits),
      });
    }
    const [row] = await toGoalRows(client, [goal], tasks).catch((error: unknown) => {
      if (!hasChanges) throw error;
      throw toAppliedCommandError({ entity: "goal", id: goal.id, error });
    });
    return { type: "single" as const, data: row!, schema: goalSchema };
  });
}

export function createGoalCommand(): Command {
  const goal = new Command("goal").description("Manage Desk goals");
  addJsonAndDaemonHostOptions(
    goal.command("ls").description("List goals not landed yet").option("--all", "Include landed"),
  ).action(withOutput(listGoals));
  addJsonAndDaemonHostOptions(
    goal
      .command("add")
      .description("Add a goal")
      .argument("<title>")
      .option("--notes <text>", "Goal notes")
      .option("--owner <agent-id>", "Owner agent that plans and dispatches the goal's work"),
  ).action(withOutput(addGoal));
  addJsonAndDaemonHostOptions(
    goal
      .command("edit")
      .description("Edit a goal")
      .argument("<id>", "Goal ID or G-<number>")
      .option("--title <text>", "Goal title")
      .option("--notes <text>", "Goal notes")
      .option("--owner <agent-id>", 'Owner agent ID; "" removes the owner'),
  ).action(withOutput(editGoal));
  addJsonAndDaemonHostOptions(
    goal
      .command("land")
      .description("Mark a goal landed")
      .argument("<id>", "Goal ID or G-<number>"),
  ).action(
    withOutput((id: string, options: GoalOptions, _command: Command) =>
      updateGoal(id, options, { landed: true }),
    ),
  );
  addJsonAndDaemonHostOptions(
    goal
      .command("rm")
      .description("Delete a goal; its tasks become Loose work")
      .argument("<id>", "Goal ID or G-<number>"),
  ).action(withOutput(removeGoal));
  addJsonAndDaemonHostOptions(
    goal
      .command("autopilot")
      .description("Show or change a goal's Autopilot")
      .argument("<id>", "Goal ID or G-<number>")
      .option("--enable", "Turn Autopilot on")
      .option("--disable", "Turn Autopilot off")
      .option("--profile <name|id>", "Agent profile name or ID")
      .option("--provider <provider/model>", "Agent provider and optional model")
      .option("--mode <id>", "Provider mode")
      .option("--thinking <id>", "Thinking option")
      .addOption(
        new Option("--isolation <kind>", "Workspace isolation (default: worktree)").choices([
          "local",
          "worktree",
        ]),
      )
      .option("--max-active <n>", "Started, unfinished tasks allowed at once (default: 1)")
      .option("--daily-limit <n>", "Automatic starts allowed per day (default: 10)")
      .option("--confirm-starts", "Ask through a decision before each start")
      .option("--no-confirm-starts", "Start without asking"),
  ).action(withOutput(setAutopilot));
  return goal;
}
