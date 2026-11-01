import type { BoardTask } from "@getpaseo/protocol/messages";
import type { BoardTaskUpdateOptions } from "@getpaseo/client/internal/daemon-client";
import type { BoardCard } from "@/board/columns";
import type { DeskCheckpoint } from "@/board/desk";
import {
  addTaskBlocker,
  setTaskGoal,
  setTaskRank,
  startTaskWithProfile,
} from "@/board/desk-actions";
import { snoozeCheckpoint, snoozePresets } from "@/board/snooze";
import { updateBoardTask, useBoardTasks } from "@/board/tasks";

/** What is being dragged on the Desk. */
export type DeskDragPayload =
  | { type: "task"; serverId: string; task: BoardTask }
  | { type: "checkpoint"; checkpoint: DeskCheckpoint };

/** Where it can land, and what landing there means. */
export type DeskDropTargetSpec =
  /** A slot in an Ahead list: the task moves to this stage (and goal), before `beforeTaskId`. */
  | {
      type: "stage";
      serverId: string;
      goalId: string | null;
      stage: "fog" | "ready";
      beforeTaskId: string | null;
    }
  /** A goal, or Loose work (`goalId: null`): the task serves it. */
  | { type: "goal"; serverId: string; goalId: string | null }
  /** Another task: the dragged task waits for it. */
  | { type: "task"; serverId: string; task: BoardTask }
  /** An Agent profile: the task starts with it. */
  | { type: "profile"; serverId: string; profileId: string; isolation: "local" | "worktree" }
  /** The Later tray: the checkpoint is snoozed. */
  | { type: "later" };

/** Not started and not finished: the only tasks that can change stage, rank or start. */
export function isPlannedTask(task: BoardTask): boolean {
  return task.workspaceId === null && task.completedAt === null;
}

/** Whether the drop would do something. Self drops, cross-host drops and no-ops are refused. */
export function acceptsDeskDrop(payload: DeskDragPayload, target: DeskDropTargetSpec): boolean {
  if (payload.type === "checkpoint") {
    return target.type === "later" && payload.checkpoint.snoozedUntil === null;
  }
  const { task, serverId } = payload;
  if (target.type === "later" || target.serverId !== serverId) return false;
  switch (target.type) {
    case "stage":
      return isPlannedTask(task) && task.claimedBy === null && target.beforeTaskId !== task.id;
    case "goal":
      return target.goalId !== task.goalId;
    case "task":
      return (
        target.task.id !== task.id &&
        target.task.completedAt === null &&
        !task.blockedBy.includes(target.task.id) &&
        !target.task.blockedBy.includes(task.id)
      );
    case "profile":
      return isPlannedTask(task) && task.claimedBy === null;
  }
}

/** A rank that sorts between two neighbours; either side may be missing. */
export function rankBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined) return (after ?? 0) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/**
 * The rank that places the task right before `beforeTaskId` (or last) among the host's planned
 * tasks in the stage. Ranks order the whole host, so a slot between host-wide neighbours is also
 * the right slot in any group the Desk shows.
 */
function rankForSlot(input: {
  tasks: ReadonlyMap<string, BoardTask>;
  task: BoardTask;
  stage: BoardTask["stage"];
  beforeTaskId: string | null;
}): number {
  const ordered = [...input.tasks.values()]
    .filter(
      (candidate) =>
        candidate.id !== input.task.id &&
        candidate.stage === input.stage &&
        isPlannedTask(candidate),
    )
    .sort((a, b) => a.rank - b.rank);
  const index = ordered.findIndex((candidate) => candidate.id === input.beforeTaskId);
  if (index === -1) return rankBetween(ordered.at(-1)?.rank, undefined);
  return rankBetween(ordered[index - 1]?.rank, ordered[index]?.rank);
}

/**
 * The rank a card takes after a list reorder moved it, between its new neighbours. Returns null
 * when nothing moved.
 */
export function rankAfterReorder(
  previous: readonly BoardCard[],
  next: readonly BoardCard[],
): { card: BoardCard; rank: number } | null {
  const first = next.findIndex((card, index) => card.key !== previous[index]?.key);
  if (first === -1) return null;
  let last = next.length - 1;
  while (last > first && next[last]?.key === previous[last]?.key) last -= 1;
  // Moved down: the card that was first now sits last in the changed span; else it moved up.
  const movedDown = previous[first]?.key === next[last]?.key;
  const index = movedDown ? last : first;
  const card = next[index];
  if (!card) return null;
  return { card, rank: rankBetween(next[index - 1]?.task.rank, next[index + 1]?.task.rank) };
}

function stageDropUpdate(
  payload: Extract<DeskDragPayload, { type: "task" }>,
  target: Extract<DeskDropTargetSpec, { type: "stage" }>,
): BoardTaskUpdateOptions {
  const host = useBoardTasks.getState().hosts[payload.serverId];
  const tasks = host?.status === "ready" ? host.tasks : new Map<string, BoardTask>();
  const { task } = payload;
  const update: BoardTaskUpdateOptions = {
    taskId: task.id,
    rank: rankForSlot({ tasks, task, stage: target.stage, beforeTaskId: target.beforeTaskId }),
  };
  if (target.stage !== task.stage) update.stage = target.stage;
  // Ahead groups by goal only under goal grouping; other groupings say nothing about the goal.
  const groupsByGoal = host?.status === "ready" && host.settings.grouping === "goal";
  if (groupsByGoal && target.goalId !== task.goalId) update.goalId = target.goalId;
  return update;
}

/** The i18n key for the toast when the drop fails. */
export function deskDropFailureKey(target: DeskDropTargetSpec): string {
  switch (target.type) {
    case "stage":
      return "board.plan2.dnd.moveFailed";
    case "goal":
      return "board.plan2.dnd.assignFailed";
    case "task":
      return "board.plan2.dnd.waitFailed";
    case "profile":
      return "board.plan2.dnd.startFailed";
    case "later":
      return "board.plan2.dnd.snoozeFailed";
  }
}

/** Runs what the drop means. Callers check `acceptsDeskDrop` first and toast failures. */
export async function runDeskDrop(
  payload: DeskDragPayload,
  target: DeskDropTargetSpec,
): Promise<void> {
  if (payload.type === "checkpoint") {
    if (target.type !== "later") return;
    const presets = snoozePresets(new Date());
    const preset = presets.find((candidate) => candidate.id === "tomorrow") ?? presets[0];
    if (preset) await snoozeCheckpoint(payload.checkpoint, preset.until);
    return;
  }
  const { serverId, task } = payload;
  switch (target.type) {
    case "stage":
      await updateBoardTask(serverId, stageDropUpdate(payload, target));
      return;
    case "goal":
      await setTaskGoal(serverId, task, target.goalId);
      return;
    case "task":
      await addTaskBlocker(serverId, task, target.task);
      return;
    case "profile":
      await startTaskWithProfile({
        serverId,
        task,
        profileId: target.profileId,
        isolation: target.isolation,
      });
      return;
    case "later":
      return;
  }
}

/** Reorder inside one list without a stage or goal change (the native long-press list). */
export function setDeskCardRank(card: BoardCard, rank: number): Promise<BoardTask> {
  return setTaskRank(card.serverId, card.task, rank);
}
