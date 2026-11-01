import type { Logger } from "pino";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import { toAgentPayload } from "../agent/agent-projections.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  createAgentCommand,
  type CreateAgentCommandDependencies,
} from "../agent/create-agent/create.js";
import { resolveCreateAgentIntent } from "../agent/create-agent/intent.js";
import { resolveCreateAgentTitles } from "../agent/create-agent-title.js";
import type { FirstAgentContext } from "../messages.js";
import {
  describeCreatedWorktreeWorkspace,
  describeWorkspaceRecord,
  type WorkspaceDescriptorSources,
} from "../workspace-descriptor.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { CreatePaseoWorktreeWorkflowFn } from "../worktree-session.js";
import type { WorkspaceCreationEffects } from "./workspace-creation.js";

export interface DaemonWorkspaceEffectsDependencies {
  descriptorSources: WorkspaceDescriptorSources;
  // Publishes setup and workspace updates to every client on its own.
  createWorktree: CreatePaseoWorktreeWorkflowFn;
  publishWorkspaces(workspaceIds: string[]): Promise<void>;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: CreateAgentCommandDependencies["providerSnapshotManager"];
  paseoHome?: string;
  worktreesRoot?: string;
  logger: Logger;
}

/**
 * Effects for creations the daemon starts on its own, such as Board starts. No client asked, so
 * every client hears about the workspace through the usual workspace and agent updates.
 */
export function createDaemonWorkspaceEffects(
  deps: DaemonWorkspaceEffectsDependencies,
): WorkspaceCreationEffects {
  const buildAgentPayload = async (agent: ManagedAgent): Promise<AgentSnapshotPayload> => {
    const payload = toAgentPayload(agent);
    const record = await deps.agentStorage.get(agent.id);
    payload.title = record?.title ?? null;
    payload.archivedAt = record?.archivedAt ?? null;
    return payload;
  };

  return {
    directoryWorkspaceCreated: async (workspace) => {
      await deps.publishWorkspaces([workspace.workspaceId]);
      return describeWorkspaceRecord(deps.descriptorSources, workspace);
    },
    createWorktree: deps.createWorktree,
    worktreeWorkspaceCreated: (result) =>
      describeCreatedWorktreeWorkspace(deps.descriptorSources, result),
    createAgent: async (request, agentId, onReady) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) throw new Error("Daemon creations place agents in a created workspace");
      if (request.autoArchive) throw new Error("Daemon creations do not support autoArchive");
      const workspace = await deps.workspaceRegistry.get(workspaceId);
      if (!workspace || workspace.archivedAt) throw new Error(`Workspace ${workspaceId} not found`);
      const caller = request.callerAgentId
        ? deps.agentManager.getAgent(request.callerAgentId)
        : null;
      if (request.callerAgentId && !caller) {
        throw new Error(`Caller agent ${request.callerAgentId} not found`);
      }
      const intent = await resolveCreateAgentIntent({
        explicitWorkspaceId: workspaceId,
        caller: caller ? { id: caller.id, cwd: caller.cwd, workspaceId: caller.workspaceId } : null,
        labels: request.labels,
        resolveWorkspace: async () => ({ workspaceId, cwd: workspace.cwd }),
        createWorkspace: async () => ({ workspaceId, cwd: workspace.cwd }),
      });
      const trimmedPrompt = request.initialPrompt?.trim();
      const { provisionalTitle } = resolveCreateAgentTitles({
        configTitle: request.config.title,
        initialPrompt: trimmedPrompt,
      });
      const firstAgentContext: FirstAgentContext = {
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
        ...(request.attachments && request.attachments.length > 0
          ? { attachments: request.attachments }
          : {}),
      };
      const { liveSnapshot, initialPromptStarted } = await createAgentCommand(
        {
          agentManager: deps.agentManager,
          agentStorage: deps.agentStorage,
          logger: deps.logger,
          paseoHome: deps.paseoHome,
          worktreesRoot: deps.worktreesRoot,
          providerSnapshotManager: deps.providerSnapshotManager,
        },
        {
          kind: "session",
          onAgentReady: async (agent) => onReady(await buildAgentPayload(agent)),
          agentId,
          config: { ...request.config, cwd: intent.cwd },
          workspaceId: intent.workspaceId,
          initialPrompt: request.initialPrompt,
          source: request.callerAgentId
            ? { kind: "agent-message", agentId: request.callerAgentId }
            : undefined,
          clientMessageId: request.clientMessageId,
          outputSchema: request.outputSchema,
          images: request.images,
          attachments: request.attachments,
          labels: intent.labels,
          env: request.env,
          provisionalTitle,
          firstAgentContext,
        },
      );
      return { agent: await buildAgentPayload(liveSnapshot), initialPromptStarted };
    },
  };
}
