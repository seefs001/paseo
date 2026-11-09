import type {
  BoardTaskListPayload,
  BoardTaskStartOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type { BoardGoal, BoardTask, WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import {
  toCommandError,
  type CommandError,
  type CommandOptions,
  type OutputSchema,
} from "../../output/index.js";
import { connectToDaemon, buildDaemonConnectionCommandError } from "../../utils/client.js";
import { resolveProviderAndModel } from "../../utils/provider-model.js";
import { toScheduleCommandError } from "../schedule/shared.js";

export interface TaskOptions extends CommandOptions {
  all?: boolean;
  notes?: string;
  project?: string;
  title?: string;
  summary?: string;
  profile?: string;
  provider?: string;
  mode?: string;
  thinking?: string;
  isolation?: "local" | "worktree";
  criterion?: string[];
  parent?: string;
  blockedBy?: string[];
  readyFor?: "agent" | "human";
  stage?: BoardTask["stage"];
  goal?: string;
}

export interface TaskRow extends BoardTask {
  /** `T-<number>`, accepted wherever a task ID is. */
  ref: string;
  column: string;
  project: string | null;
  /** `G-<number>` of the goal the task serves. */
  goal: string | null;
  workspace: string | null;
  /** Blockers that are not Done yet. */
  waitingOn: string[];
  /** Ready, unclaimed, ready for an agent, and not waiting on anything. */
  onFrontier: boolean;
}

export const taskSchema: OutputSchema<TaskRow> = {
  idField: "id",
  columns: [
    { header: "REF", field: "ref", width: 6 },
    { header: "ID", field: "id", width: 16 },
    { header: "COLUMN", field: "column", width: 12 },
    { header: "NEXT", field: (row) => (row.onFrontier ? "*" : "") },
    { header: "FOR", field: "readyFor" },
    { header: "TITLE", field: "title", width: 36 },
    { header: "GOAL", field: "goal", width: 6 },
    { header: "PROJECT", field: "project", width: 20 },
    { header: "WORKSPACE", field: "workspace", width: 20 },
    { header: "BLOCKED BY", field: (row) => row.waitingOn.join(", "), width: 20 },
    { header: "CLAIMED BY", field: "claimedBy", width: 16 },
  ],
};

const columnByStatus: Record<WorkspaceDescriptorPayload["status"], string> = {
  running: "Running",
  needs_input: "Needs you",
  failed: "Review",
  attention: "Review",
  done: "Review",
};

export async function withTaskClient<T>(
  options: TaskOptions,
  action: (client: DaemonClient) => Promise<T>,
): Promise<T> {
  const target = options.daemonTarget;
  const client = await connectToDaemon({ target }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ target, error });
  });
  try {
    if (client.getLastServerInfoMessage()?.features?.boardTasks !== true) {
      throw new Error("Update the host to use Board tasks");
    }
    return await action(client);
  } catch (error) {
    throw toScheduleCommandError("TASK_COMMAND_FAILED", "manage Board tasks", error);
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface AppliedCommandErrorOptions {
  entity: "task" | "goal";
  id: string;
  error: unknown;
}

export function toAppliedCommandError({
  entity,
  id,
  error,
}: AppliedCommandErrorOptions): CommandError {
  const commandError = toCommandError(
    toScheduleCommandError("TASK_COMMAND_FAILED", "manage Board tasks", error),
  );
  const idField = entity === "task" ? "taskId" : "goalId";
  return {
    ...commandError,
    message: `Applied changes to ${entity} ${id}, but could not load its details: ${commandError.message}`,
    details: {
      applied: true,
      [idField]: id,
      cause: commandError,
    },
  };
}

/** Resolves a task ID or `T-<number>` reference against the host's tasks. */
export function resolveTaskId(tasks: readonly BoardTask[], ref: string): string {
  return resolveRef(tasks, ref, "T", "Task");
}

/** Resolves a goal ID or `G-<number>` reference against the host's goals. */
export function resolveGoalId(goals: readonly BoardGoal[], ref: string): string {
  return resolveRef(goals, ref, "G", "Goal");
}

function resolveRef(
  items: readonly { id: string; number: number }[],
  ref: string,
  prefix: string,
  noun: string,
): string {
  const byId = items.find((item) => item.id === ref);
  if (byId) return byId.id;
  const match = new RegExp(`^(?:${prefix}-)?(\\d+)$`, "i").exec(ref.trim());
  const byNumber = match ? items.find((item) => item.number === Number(match[1])) : undefined;
  if (!byNumber) throw new Error(`${noun} not found: ${ref}`);
  return byNumber.id;
}

type AgentOptions = Pick<TaskOptions, "profile" | "provider" | "mode" | "thinking">;

export function validateAgentOptions(options: AgentOptions): void {
  const hasProfile = Boolean(options.profile);
  const hasProvider = Boolean(options.provider);
  if (hasProfile && hasProvider) {
    throw { code: "INVALID_AGENT", message: "Specify only one of --profile or --provider" };
  }
  if (!hasProvider && (options.mode !== undefined || options.thinking !== undefined)) {
    throw { code: "INVALID_AGENT", message: "--mode and --thinking require --provider" };
  }
}

export async function resolveAgent(
  client: DaemonClient,
  options: AgentOptions,
): Promise<BoardTaskStartOptions["agent"]> {
  if (options.profile) {
    const { config } = await client.getDaemonConfig();
    const profiles = config.agentProfiles ?? [];
    const matches = profiles.filter(
      (profile) => profile.id === options.profile || profile.name === options.profile,
    );
    if (matches.length !== 1) {
      throw new Error(`Agent profile must match one name or ID: ${options.profile}`);
    }
    return { kind: "profile", profileId: matches[0]!.id };
  }
  const { provider, model } = resolveProviderAndModel({ provider: options.provider });
  return {
    kind: "config",
    provider,
    model,
    modeId: options.mode,
    thinkingOptionId: options.thinking,
  };
}

export function parseLimit(
  value: string | undefined,
  flag: string,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw {
      code: "INVALID_INTEGER",
      message: `${flag} must be an integer from 1 to ${max}`,
    } satisfies CommandError;
  }
  return parsed;
}

export async function loadBoard(client: DaemonClient): Promise<BoardTaskListPayload> {
  const observation = client.observeBoardTasks();
  try {
    return await observation.ready;
  } finally {
    await observation.release();
  }
}

/** `board` decides which blockers are still open and names goals; it is fetched when omitted. */
export async function toTaskRows(
  client: DaemonClient,
  tasks: BoardTask[],
  board?: Pick<BoardTaskListPayload, "tasks" | "goals">,
): Promise<TaskRow[]> {
  const { tasks: allTasks, goals } = board ?? (await loadBoard(client));
  const doneIds = new Set(
    allTasks.filter((task) => task.completedAt !== null).map((task) => task.id),
  );
  const goalRefs = new Map(goals.map((goal) => [goal.id, `G-${goal.number}`]));
  const projects = await client.listProjects();
  const projectNames = new Map(
    projects.projects.map((project) => [project.projectId, project.projectDisplayName]),
  );
  const workspaces = new Map<string, WorkspaceDescriptorPayload>();
  let cursor: string | undefined;
  do {
    const payload = await client.fetchWorkspaces({
      filter: { includeBackground: true },
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const workspace of payload.entries) workspaces.set(workspace.id, workspace);
    cursor = payload.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return tasks.map((task) => {
    const workspace = task.workspaceId === null ? undefined : workspaces.get(task.workspaceId);
    const waitingOn = task.blockedBy.filter((id) => !doneIds.has(id));
    let column = "Review";
    if (task.completedAt !== null) column = "Done";
    else if (task.claimedBy !== null) column = "Running";
    else if (task.workspaceId === null) column = task.stage === "ready" ? "Ready" : "Fog";
    else if (workspace) column = columnByStatus[workspace.status];
    return {
      ...task,
      ref: `T-${task.number}`,
      column,
      project:
        task.projectId === null ? null : (projectNames.get(task.projectId) ?? task.projectId),
      goal: task.goalId === null ? null : (goalRefs.get(task.goalId) ?? task.goalId),
      workspace: workspace?.name ?? task.workspaceId,
      waitingOn,
      onFrontier:
        column === "Ready" &&
        task.claimedBy === null &&
        task.readyFor === "agent" &&
        waitingOn.length === 0,
    };
  });
}
