import type { BoardTask } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { createBoardTask, updateBoardTask } from "./tasks";

function requireClient(serverId: string) {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client?.isConnected) throw new Error(i18n.t("board.errors.offline"));
  return client;
}

/** Interrupts the agent's current turn. The session stays and can take the next prompt. */
export async function stopBoardAgent(serverId: string, agentId: string): Promise<void> {
  await requireClient(serverId).cancelAgent(agentId);
}

/** Clears "finished, not seen" the same way opening the agent's tab does. */
export async function markBoardAgentRead(serverId: string, agentId: string): Promise<void> {
  await requireClient(serverId).clearAgentAttention(agentId);
}

export async function archiveBoardAgent(serverId: string, agentId: string): Promise<void> {
  await requireClient(serverId).archiveAgent(agentId);
}

/**
 * Brings an unplanned session into the Board's planning: a task named after the agent, linked to
 * its workspace, so review, acceptance criteria and dependencies apply from here on.
 */
export async function trackAgentAsTask(input: {
  serverId: string;
  agent: Pick<Agent, "title">;
  workspace: Pick<WorkspaceDescriptor, "id" | "name" | "title" | "projectId">;
}): Promise<BoardTask> {
  const { serverId, agent, workspace } = input;
  const title = agent.title?.trim() || workspace.title?.trim() || workspace.name;
  const task = await createBoardTask(serverId, {
    title,
    projectId: workspace.projectId,
    stage: "ready",
  });
  return updateBoardTask(serverId, { taskId: task.id, workspaceId: workspace.id });
}
