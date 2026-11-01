import { createHash } from "node:crypto";
import type {
  BoardTask,
  BoardTaskStartRequestSchema,
  CreationSnapshot,
  WorkspaceCreateRequest,
} from "@getpaseo/protocol/messages";
import type { z } from "zod";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import { BoardTaskError, type BoardTaskService } from "./tasks.js";

export type BoardTaskStartInput = Omit<
  z.infer<typeof BoardTaskStartRequestSchema>,
  "type" | "requestId"
> & {
  callerAgentId?: string;
};

export interface BoardTaskStartDependencies {
  service: BoardTaskService;
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  daemonConfigStore?: Pick<DaemonConfigStore, "get">;
  createWorkspace(request: WorkspaceCreateRequest): Promise<CreationSnapshot>;
  readCreation(key: string): Promise<CreationSnapshot | null>;
  serverId?: string;
}

export function startBoardTask(deps: BoardTaskStartDependencies, input: BoardTaskStartInput) {
  const launch = async (task: BoardTask) => {
    if (task.completedAt !== null) {
      throw new BoardTaskError("task_completed", "Completed tasks cannot be started");
    }
    if (task.projectId === null) {
      throw new BoardTaskError("task_has_no_project", "Choose a project before starting this task");
    }
    const project = await deps.projectRegistry.get(task.projectId);
    if (!project || project.archivedAt) {
      throw new BoardTaskError("project_not_found", "Project not found");
    }
    const selection = resolveAgentConfig(deps, input.agent);
    const digest = createHash("sha256")
      .update(JSON.stringify([task.id, input.idempotencyKey]))
      .digest("hex");
    const key = `board-task-start:${digest}`;
    if (task.workspaceId !== null) {
      const workspace = await deps.workspaceRegistry.get(task.workspaceId);
      if (workspace && !workspace.archivedAt) {
        const receipt = input.idempotencyKey ? await deps.readCreation(key) : null;
        if (receipt?.workspaceId !== task.workspaceId) {
          throw new BoardTaskError("task_already_started", "Task already has an active workspace");
        }
      }
    }
    const prompt = buildStartPrompt(task);
    const parentBranch = await readParentBranch(deps, task);
    const source: WorkspaceCreateRequest["source"] =
      input.isolation === "local"
        ? { kind: "directory", path: project.rootPath, projectId: project.projectId }
        : {
            kind: "worktree",
            cwd: project.rootPath,
            projectId: project.projectId,
            action: "branch-off",
            ...(parentBranch ? { baseBranch: parentBranch } : {}),
          };
    const labels: Record<string, string> = {};
    if (input.callerAgentId && deps.serverId) labels["paseo.parent-server-id"] = deps.serverId;
    const creation = await deps.createWorkspace({
      type: "workspace.create.request",
      requestId: key,
      idempotencyKey: key,
      title: task.title,
      source,
      callerAgentId: input.callerAgentId,
      agent: {
        config: {
          provider: selection.provider,
          cwd: project.rootPath,
          title: task.title,
          model: selection.model,
          modeId: selection.modeId,
          thinkingOptionId: selection.thinkingOptionId,
          featureValues: selection.featureValues,
        },
        initialPrompt: prompt,
        attachments: task.attachments,
        callerAgentId: input.callerAgentId,
        labels,
      },
    });
    if (
      creation.error ||
      !creation.workspaceId ||
      !creation.agentId ||
      creation.phase !== "completed"
    ) {
      throw new BoardTaskError(
        "task_start_failed",
        creation.error ?? "Task workspace or agent could not be created",
      );
    }
    return { workspaceId: creation.workspaceId, agentId: creation.agentId };
  };
  return deps.service.start(input.taskId, launch, input.callerAgentId);
}

function buildStartPrompt(task: BoardTask): string {
  const sections = [task.title];
  if (task.notes) sections.push(task.notes);
  if (task.acceptanceCriteria.length > 0) {
    const checklist = task.acceptanceCriteria
      .map((criterion) => `- [${criterion.met ? "x" : " "}] ${criterion.text}`)
      .join("\n");
    sections.push(
      `## Acceptance criteria\n\n${checklist}`,
      `When you are done, report with update_board_task (taskId ${task.id}): mark each criterion you met and write a summary that addresses each criterion.`,
    );
  }
  return sections.join("\n\n");
}

// Subtasks of one plan integrate on their parent's branch while the parent's worktree is active.
async function readParentBranch(
  deps: BoardTaskStartDependencies,
  task: BoardTask,
): Promise<string | null> {
  if (task.parentId === null) return null;
  const parent = deps.service.list().find((candidate) => candidate.id === task.parentId);
  if (!parent?.workspaceId) return null;
  const workspace = await deps.workspaceRegistry.get(parent.workspaceId);
  if (!workspace || workspace.archivedAt || workspace.kind !== "worktree") return null;
  return workspace.branch ?? null;
}

function resolveAgentConfig(
  deps: BoardTaskStartDependencies,
  selection: BoardTaskStartInput["agent"],
): Extract<BoardTaskStartInput["agent"], { kind: "config" }> {
  if (selection.kind === "config") return selection;
  const profileId = selection.profileId;
  const profiles = deps.daemonConfigStore?.get().agentProfiles ?? [];
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile)
    throw new BoardTaskError("profile_not_found", `Agent profile not found: ${profileId}`);
  return {
    kind: "config",
    provider: profile.provider,
    model: profile.model,
    modeId: profile.modeId,
    thinkingOptionId: profile.thinkingOptionId,
    featureValues: profile.featureValues,
  };
}

export type BoardTaskStartResult = Awaited<ReturnType<typeof startBoardTask>>;
