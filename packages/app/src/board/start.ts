import type { AgentAttachment, BoardTask } from "@getpaseo/protocol/messages";
import { router } from "expo-router";
import type { UserComposerAttachment } from "@/attachments/types";
import type { ProjectDescriptor } from "@/stores/session-store";
import { useDraftStore } from "@/stores/draft-store";
import { buildNewWorkspaceDraftKey, generateDraftId } from "@/stores/draft-keys";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { updateBoardTask } from "./tasks";

/** Mirrors the daemon start's first prompt so both start paths brief the agent the same way. */
function buildBoardTaskPrompt(
  task: Pick<BoardTask, "title" | "notes" | "acceptanceCriteria">,
): string {
  const sections = [task.title];
  if (task.notes) sections.push(task.notes);
  if (task.acceptanceCriteria.length > 0) {
    const checklist = task.acceptanceCriteria
      .map((criterion) => `- [${criterion.met ? "x" : " "}] ${criterion.text}`)
      .join("\n");
    sections.push(
      `Acceptance criteria:\n${checklist}`,
      "When the work is done, call update_board_task with completed set to true and a summary that addresses each criterion.",
    );
  }
  return sections.join("\n\n");
}

/**
 * Rebuilds the composer's forge attachment from what the task stored. Search state and labels
 * are not stored and the composer does not send them.
 */
function toDraftAttachment(attachment: AgentAttachment): UserComposerAttachment | null {
  if (attachment.type === "forge_issue") {
    return {
      kind: "forge_issue",
      item: {
        kind: "issue",
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        state: "open",
        body: attachment.body ?? null,
        labels: [],
        ...(attachment.projectPath ? { projectPath: attachment.projectPath } : {}),
      },
    };
  }
  if (attachment.type === "forge_change_request") {
    return {
      kind: "forge_change_request",
      item: {
        kind: "change_request",
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        state: "open",
        body: attachment.body ?? null,
        labels: [],
        ...(attachment.projectPath ? { projectPath: attachment.projectPath } : {}),
        baseRefName: attachment.baseRefName ?? null,
        headRefName: attachment.headRefName ?? null,
      },
    };
  }
  return null;
}

/**
 * Starting reuses New workspace, so isolation, branch, provider and model stay chosen in one place.
 * The task becomes the editable first prompt, and creating the workspace links it back.
 */
export function startBoardTask(input: {
  serverId: string;
  task: BoardTask;
  project: ProjectDescriptor | null;
}): void {
  const { serverId, task, project } = input;
  const draftId = generateDraftId();
  useDraftStore.getState().saveDraftInput({
    draftKey: buildNewWorkspaceDraftKey(draftId),
    draft: {
      text: buildBoardTaskPrompt(task),
      attachments: task.attachments.flatMap((attachment) => toDraftAttachment(attachment) ?? []),
    },
  });
  const projectRoute = project
    ? {
        projectId: project.projectId,
        sourceDirectory: project.projectRootPath,
        displayName: project.projectCustomName ?? project.projectDisplayName,
      }
    : {};
  router.push(buildNewWorkspaceRoute({ serverId, draftId, boardTaskId: task.id, ...projectRoute }));
}

export async function linkBoardTaskWorkspace(input: {
  serverId: string;
  taskId: string;
  workspaceId: string;
}): Promise<void> {
  await updateBoardTask(input.serverId, { taskId: input.taskId, workspaceId: input.workspaceId });
}
