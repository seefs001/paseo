import { ArtifactStore } from "../artifacts/store.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import {
  createBoardDecisionEffect,
  createBoardDecisionService,
  type BoardDecisionEffectDeps,
  type BoardDecisionService,
} from "./decisions.js";
import { createBoardDeskStore, type BoardDeskStore } from "./desk.js";
import { createBoardGoalService, type BoardGoalService } from "./goals.js";
import { createBoardTaskService, type BoardTaskService } from "./tasks.js";

/** Board storage the daemon hands to sessions as one unit. */
export interface BoardServices {
  tasks: BoardTaskService;
  goals: BoardGoalService;
  decisions: BoardDecisionService;
  desk: BoardDeskStore;
  /** Artifacts reference goals and tasks, so they ship with the Desk. */
  artifacts: ArtifactStore;
}

export function createBoardServices(input: {
  paseoHome: string;
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  startBoardTask: BoardDecisionEffectDeps["startBoardTask"];
  sendAgentPrompt: BoardDecisionEffectDeps["sendAgentPrompt"];
}): BoardServices {
  // Tasks check goals exist and goals clear deleted goals from tasks, so one side binds late.
  let goals: BoardGoalService | null = null;
  const tasks = createBoardTaskService({
    paseoHome: input.paseoHome,
    projectRegistry: input.projectRegistry,
    workspaceRegistry: input.workspaceRegistry,
    goalExists: (goalId) => Boolean(goals?.get(goalId)),
  });
  goals = createBoardGoalService({ paseoHome: input.paseoHome, tasks });
  const decisions = createBoardDecisionService({
    paseoHome: input.paseoHome,
    effect: createBoardDecisionEffect({
      tasks,
      goals,
      startBoardTask: input.startBoardTask,
      sendAgentPrompt: input.sendAgentPrompt,
    }),
  });
  const desk = createBoardDeskStore({ paseoHome: input.paseoHome });
  const artifacts = new ArtifactStore({ paseoHome: input.paseoHome });
  return { tasks, goals, decisions, desk, artifacts };
}

export async function initializeBoardServices(board: BoardServices): Promise<void> {
  await Promise.all([
    board.tasks.initialize(),
    board.goals.initialize(),
    board.decisions.initialize(),
    board.desk.initialize(),
    board.artifacts.initialize(),
  ]);
}
