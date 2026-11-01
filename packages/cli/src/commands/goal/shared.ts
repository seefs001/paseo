import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { BoardGoal, BoardTask } from "@getpaseo/protocol/messages";
import type { OutputSchema } from "../../output/index.js";
import type { TaskOptions } from "../task/shared.js";

export interface GoalOptions extends TaskOptions {
  owner?: string;
  enable?: boolean;
  disable?: boolean;
  maxActive?: string;
  dailyLimit?: string;
  confirmStarts?: boolean;
}

export interface GoalRow extends BoardGoal {
  /** `G-<number>`, accepted wherever a goal ID is. */
  ref: string;
  /** Done and total tasks that serve the goal. */
  tasks: { done: number; total: number };
  autopilotLabel: string;
}

export const goalSchema: OutputSchema<GoalRow> = {
  idField: "id",
  columns: [
    { header: "REF", field: "ref", width: 6 },
    { header: "ID", field: "id", width: 16 },
    { header: "TITLE", field: "title", width: 36 },
    { header: "OWNER", field: "ownerAgentId", width: 16 },
    { header: "TASKS", field: (row) => `${row.tasks.done}/${row.tasks.total}` },
    { header: "AUTOPILOT", field: "autopilotLabel", width: 30 },
    { header: "LANDED", field: (row) => (row.landedAt ? "yes" : "") },
    { header: "LAST ERROR", field: "lastAutopilotError", width: 30 },
  ],
};

export async function toGoalRows(
  client: DaemonClient,
  goals: BoardGoal[],
  tasks: readonly BoardTask[],
): Promise<GoalRow[]> {
  const needsProfiles = goals.some((goal) => goal.autopilot?.agent.kind === "profile");
  const profileNames = new Map(
    needsProfiles
      ? ((await client.getDaemonConfig()).config.agentProfiles ?? []).map((profile) => [
          profile.id,
          profile.name,
        ])
      : [],
  );
  return goals.map((goal) => {
    const served = tasks.filter((task) => task.goalId === goal.id);
    let autopilotLabel = "off";
    if (goal.autopilot) {
      const { agent, enabled, isolation, maxActive, dailyStartLimit, confirmStarts } =
        goal.autopilot;
      const agentLabel =
        agent.kind === "profile"
          ? `profile:${profileNames.get(agent.profileId) ?? agent.profileId}`
          : [agent.provider, agent.model].filter(Boolean).join("/");
      autopilotLabel = [
        enabled ? "on" : "off",
        agentLabel,
        isolation,
        `max ${maxActive}`,
        `today ${goal.startsToday}/${dailyStartLimit}`,
        confirmStarts ? "confirm" : null,
      ]
        .filter(Boolean)
        .join(" ");
    }
    return {
      ...goal,
      ref: `G-${goal.number}`,
      tasks: {
        done: served.filter((task) => task.completedAt !== null).length,
        total: served.length,
      },
      autopilotLabel,
    };
  });
}
