import type { BoardTask, BoardTaskStartAgentSchema } from "@getpaseo/protocol/messages";
import type { z } from "zod";
import { startBoardTaskOnHost, updateBoardTask } from "./tasks";

/**
 * What each Desk drop does. Drag and drop and their menu equivalents call these, so a gesture and
 * its menu item never behave differently.
 */

/** Fog -> Ready: the idea is specified enough for an agent to take. Ready -> Fog takes it back. */
export function setTaskStage(serverId: string, task: BoardTask, stage: BoardTask["stage"]) {
  return updateBoardTask(serverId, { taskId: task.id, stage });
}

/** A new rank between neighbours; see `buildBacklogMoves` for the in-column computation. */
export function setTaskRank(serverId: string, task: BoardTask, rank: number) {
  return updateBoardTask(serverId, { taskId: task.id, rank });
}

/** Drop a task onto a goal, or onto Loose work (`null`). */
export function setTaskGoal(serverId: string, task: BoardTask, goalId: string | null) {
  return updateBoardTask(serverId, { taskId: task.id, goalId });
}

/** Drop a task onto another task: it waits for that one. Both must be on the same host. */
export function addTaskBlocker(serverId: string, task: BoardTask, blocker: BoardTask) {
  if (task.blockedBy.includes(blocker.id)) return Promise.resolve(task);
  return updateBoardTask(serverId, { taskId: task.id, blockedBy: [...task.blockedBy, blocker.id] });
}

export function removeTaskBlocker(serverId: string, task: BoardTask, blockerId: string) {
  return updateBoardTask(serverId, {
    taskId: task.id,
    blockedBy: task.blockedBy.filter((id) => id !== blockerId),
  });
}

/** Drop a task onto an Agent profile: start it on the daemon with that profile. */
export function startTaskWithProfile(input: {
  serverId: string;
  task: BoardTask;
  profileId: string;
  isolation: "local" | "worktree";
}) {
  const agent: z.infer<typeof BoardTaskStartAgentSchema> = {
    kind: "profile",
    profileId: input.profileId,
  };
  return startBoardTaskOnHost(input.serverId, {
    taskId: input.task.id,
    isolation: input.isolation,
    agent,
  });
}
