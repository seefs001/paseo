import type { Logger } from "pino";
import { isAbsolute, relative, resolve, sep } from "path";
import type {
  AgentCreateRequest,
  AgentSnapshotPayload,
  CreationSnapshot,
} from "@getpaseo/protocol/messages";
import type { SessionInboundMessage, WorkspaceDescriptorPayload } from "../messages.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  inheritWorkspaceBackground,
  type CreateAgentCaller,
} from "../agent/create-agent/intent.js";
import { resolveFirstAgentPromptTitle } from "../agent/create-agent-title.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import type { PluginLifecycle } from "../plugins/lifecycle/index.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { expandTilde } from "../../utils/path.js";
import type { WorkspaceAutoName } from "../workspace-auto-name.js";
import { formatWorkspaceAutomationBlockedMessage } from "../workspace-automation-gate.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { resolveWorktreeSourceCwd } from "../workspace-source.js";
import type {
  CreatePaseoWorktreeWorkflowFn,
  CreatePaseoWorktreeWorkflowResult,
} from "../worktree-session.js";
import type { CreatedAgent, CreationService } from "./index.js";

export type WorkspaceCreateRequest = Extract<
  SessionInboundMessage,
  { type: "workspace.create.request" }
>;
export type CreateAgentRequestMessage = Extract<
  SessionInboundMessage,
  { type: "create_agent_request" }
>;
type CurrentSelection = NonNullable<
  Parameters<WorkspaceAutoName["scheduleForDirectory"]>[1]
>["currentSelection"];

/**
 * The parts of one creation that depend on who asked. A Session publishes to its own client;
 * daemon callers such as Board starts publish to every client.
 */
export interface WorkspaceCreationEffects {
  directoryWorkspaceCreated(
    workspace: PersistedWorkspaceRecord,
    request: WorkspaceCreateRequest,
  ): Promise<WorkspaceDescriptorPayload>;
  createWorktree: CreatePaseoWorktreeWorkflowFn;
  worktreeWorkspaceCreated(
    result: CreatePaseoWorktreeWorkflowResult,
    request: WorkspaceCreateRequest,
  ): Promise<WorkspaceDescriptorPayload>;
  currentSelection?(cwd: string): CurrentSelection;
  createAgent(
    request: CreateAgentRequestMessage,
    agentId: string,
    onReady: (agent: AgentSnapshotPayload) => Promise<void>,
  ): Promise<CreatedAgent>;
}

export interface WorkspaceCreationDependencies {
  creations: Pick<CreationService, "create" | "subscribe">;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  agentManager: Pick<AgentManager, "getAgent">;
  agentStorage: Pick<AgentStorage, "get">;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForDirectory">;
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
  workspaceAutoName: Pick<WorkspaceAutoName, "scheduleForDirectory">;
  pluginRuntime?: Pick<PluginLifecycle, "before">;
  isDirectory(path: string): Promise<boolean>;
  logger: Logger;
}

class WorkspaceCreationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceCreationError";
  }
}

export function hasInitialCreationPrompt(
  request?: Pick<AgentCreateRequest, "initialPrompt" | "images" | "attachments">,
): boolean {
  return Boolean(
    request &&
    buildAgentPrompt(request.initialPrompt?.trim() ?? "", request.images, request.attachments)
      .length,
  );
}

/**
 * Creates a workspace, optionally with its first agent, once per idempotency key. One instance
 * serves the whole daemon; callers pass the effects that publish the result.
 */
export class WorkspaceCreation {
  constructor(private readonly deps: WorkspaceCreationDependencies) {}

  create(
    request: WorkspaceCreateRequest,
    effects: WorkspaceCreationEffects,
    observer?: (snapshot: CreationSnapshot) => void,
  ): Promise<CreationSnapshot> {
    const { requestId, subscribe: _subscribe, type: _type, idempotencyKey, ...intent } = request;
    const agentInput = request.agent;
    return this.deps.creations.create(
      {
        kind: "workspace",
        key: idempotencyKey ?? requestId,
        request: intent,
        workspaceId: request.workspaceId,
        agentId: agentInput?.agentId,
        hasAgent: Boolean(agentInput),
        hasPrompt: hasInitialCreationPrompt(agentInput),
        exists: this.exists,
        provision: async (id) => {
          const descriptor = await this.provision(
            {
              ...request,
              firstAgentContext: agentInput
                ? { prompt: agentInput.initialPrompt, attachments: agentInput.attachments }
                : request.firstAgentContext,
            },
            id,
            effects,
          );
          const workspace = await this.deps.workspaceRegistry.get(descriptor.id);
          return {
            workspace: descriptor,
            setupSkippedReason: workspace?.untrustedSource
              ? formatWorkspaceAutomationBlockedMessage(workspace.untrustedSource)
              : undefined,
          };
        },
        createAgent: agentInput
          ? async (id, workspace, onReady) => {
              if (!workspace?.workspaceDirectory)
                throw new Error("Created workspace has no directory");
              const sourceCwd =
                request.source.kind === "directory"
                  ? request.source.path
                  : await resolveWorktreeSourceCwd(request.source, this.deps.projectRegistry);
              const sourceDirectory = resolve(expandTilde(sourceCwd));
              const agentDirectory = resolve(expandTilde(agentInput.config.cwd));
              const relativeCwd = relative(sourceDirectory, agentDirectory);
              if (
                relativeCwd === ".." ||
                relativeCwd.startsWith(`..${sep}`) ||
                isAbsolute(relativeCwd)
              )
                throw new Error("Agent directory must be inside the workspace source");
              return effects.createAgent(
                {
                  ...agentInput,
                  type: "create_agent_request",
                  requestId,
                  config: {
                    ...agentInput.config,
                    cwd: resolve(workspace.workspaceDirectory, relativeCwd),
                  },
                  workspaceId: workspace.id,
                },
                id,
                onReady,
              );
            }
          : undefined,
      },
      observer,
    );
  }

  /** Reads the snapshot of an earlier creation without observing it. */
  async read(key: string): Promise<CreationSnapshot | null> {
    const observation = await this.deps.creations.subscribe("workspace", key, () => {});
    observation.unsubscribe();
    return observation.snapshot;
  }

  readonly exists = async (kind: "workspace" | "agent", id: string): Promise<boolean> =>
    kind === "workspace"
      ? (await this.deps.workspaceRegistry.get(id)) !== null
      : this.deps.agentManager.getAgent(id) != null ||
        (await this.deps.agentStorage.get(id)) !== null;

  private async provision(
    request: WorkspaceCreateRequest,
    workspaceId: string,
    effects: WorkspaceCreationEffects,
  ): Promise<WorkspaceDescriptorPayload> {
    if (request.internal)
      throw new Error(
        "Public internal workspaces were removed; use background workspace creation.",
      );
    if (request.agent?.background !== undefined)
      throw new Error("Configure background on the workspace, not its initial agent.");
    let creationRequest = request;
    // Hooks belong to the operation: retries fingerprint the caller's input
    // and must not rerun hooks or compare their potentially changing output.
    if (this.deps.pluginRuntime) {
      const { type, requestId, ...input } = request;
      const transformed = await this.deps.pluginRuntime.before("workspace.create.before", input);
      creationRequest = { ...transformed, type, requestId };
    }
    return creationRequest.source.kind === "directory"
      ? this.provisionDirectory(creationRequest, workspaceId, effects)
      : this.provisionWorktree(creationRequest, workspaceId, effects);
  }

  private async provisionDirectory(
    request: WorkspaceCreateRequest,
    workspaceId: string,
    effects: WorkspaceCreationEffects,
  ): Promise<WorkspaceDescriptorPayload> {
    if (request.source.kind !== "directory") {
      throw new Error("Unexpected workspace source");
    }

    if (request.source.projectAssigned === false && request.source.projectId !== undefined) {
      throw new Error("An unassigned workspace cannot specify a project");
    }
    const projectId = request.source.projectAssigned === false ? null : request.source.projectId;
    const cwd = expandTilde(request.source.path);
    const directoryExists = await this.deps.isDirectory(cwd).catch(() => false);
    if (!directoryExists) {
      throw new WorkspaceCreationError("directory_not_found", `Directory not found: ${cwd}`);
    }

    const explicitTitle = request.title?.trim() || null;
    const promptTitle = resolveFirstAgentPromptTitle(request.firstAgentContext);
    const workspace = await this.deps.workspaceProvisioning.createWorkspaceForDirectory(
      cwd,
      explicitTitle ?? promptTitle,
      projectId,
      {
        expectsInitialAgent: Boolean(request.firstAgentContext),
        workspaceId,
        ...(await this.workspaceBackgroundIntent(request.background, request.callerAgentId)),
      },
    );
    const descriptor = await effects.directoryWorkspaceCreated(workspace, request);
    void this.deps.workspaceGitService
      .getSnapshot(workspace.cwd, { force: true, includeForge: false, reason: "open_project" })
      .catch((error) => {
        this.deps.logger.warn(
          { err: error, cwd: workspace.cwd },
          "Background snapshot refresh failed after workspace.create",
        );
      });
    if (request.firstAgentContext) {
      this.deps.workspaceAutoName.scheduleForDirectory(
        {
          workspaceId: workspace.workspaceId,
          cwd: workspace.cwd,
          firstAgentContext: request.firstAgentContext,
        },
        { currentSelection: effects.currentSelection?.(workspace.cwd) },
      );
    }
    return descriptor;
  }

  private async provisionWorktree(
    request: WorkspaceCreateRequest,
    workspaceId: string,
    effects: WorkspaceCreationEffects,
  ): Promise<WorkspaceDescriptorPayload> {
    if (request.source.kind !== "worktree") {
      throw new Error("Unexpected workspace source");
    }

    const source = request.source;

    if (!source.cwd && !source.projectId) {
      throw new WorkspaceCreationError(
        "source_required",
        "cwd or projectId is required for a worktree-backed workspace",
      );
    }

    const sourceCwd = await resolveWorktreeSourceCwd(source, this.deps.projectRegistry);

    const result = await effects.createWorktree(
      {
        cwd: sourceCwd,
        workspaceId,
        projectId: source.projectId,
        worktreeSlug: source.worktreeSlug,
        action: source.action,
        refName: source.refName,
        branchName: source.branchName,
        checkoutSource: source.checkoutSource,
        githubPrNumber: source.githubPrNumber,
        firstAgentContext: request.firstAgentContext,
        title: request.title,
        ...(await this.workspaceBackgroundIntent(request.background, request.callerAgentId)),
      },
      source.baseBranch
        ? { resolveDefaultBranch: async () => source.baseBranch as string }
        : undefined,
    );
    return effects.worktreeWorkspaceCreated(result, request);
  }

  private async workspaceBackgroundIntent(
    background: boolean | undefined,
    callerAgentId?: string,
  ): Promise<{ background?: boolean; callerWorkspaceId?: string }> {
    if (!callerAgentId) return { background };
    let caller: (CreateAgentCaller & { background?: boolean }) | null =
      this.deps.agentManager.getAgent(callerAgentId);
    if (!caller) {
      const stored = await this.deps.agentStorage.get(callerAgentId);
      if (stored && !stored.archivedAt) caller = stored;
    }
    if (!caller) throw new Error(`Caller agent ${callerAgentId} not found`);
    return {
      background: inheritWorkspaceBackground(background, caller),
      callerWorkspaceId: caller.workspaceId,
    };
  }
}
