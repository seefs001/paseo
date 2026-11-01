import { basename } from "path";
import type { ProjectPlacementPayload, WorkspaceDescriptorPayload } from "./messages.js";
import type { CreatePaseoWorktreeResult } from "./paseo-worktree-service.js";
import { checkoutFromPersistedWorkspacePlacement } from "./workspace-registry-model.js";
import {
  resolveProjectDisplayName,
  resolveWorkspaceDisplayName,
  resolveWorkspaceName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
} from "./workspace-registry.js";
import type { WorkspaceRuntimeStore } from "./workspace-runtime-store/index.js";
import type { WorkspaceSetupObservation } from "./workspace-setup-observation.js";

/** Daemon state a workspace descriptor is projected from. */
export interface WorkspaceDescriptorSources {
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRuntimeStore: Pick<WorkspaceRuntimeStore, "get">;
  workspaceSetupObservation: Pick<WorkspaceSetupObservation, "status">;
  buildScripts(
    workspace: PersistedWorkspaceRecord,
    project: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload["scripts"]>;
}

export async function buildProjectPlacement(
  sources: Pick<WorkspaceDescriptorSources, "projectRegistry" | "workspaceRuntimeStore">,
  workspace: PersistedWorkspaceRecord,
  projectRecord?: PersistedProjectRecord | null,
): Promise<ProjectPlacementPayload> {
  const project = projectRecord ?? (await sources.projectRegistry.get(workspace.projectId));
  if (!project) {
    throw new Error(`Project not found for workspace ${workspace.workspaceId}`);
  }
  const snapshot = sources.workspaceRuntimeStore.get(workspace.cwd);
  const checkout = checkoutFromPersistedWorkspacePlacement({
    workspace,
    // COMPAT(workspacePlacementBackfill): added in v0.1.107, remove after 2027-01-15.
    // Legacy records can lack branch and worktreeRoot because persisted registries
    // are not migrated in place.
    fallbackBranch: snapshot?.git.currentBranch ?? null,
    fallbackWorktreeRoot: snapshot?.git.repoRoot,
  });
  return {
    projectKey: project.projectId,
    projectName: resolveProjectDisplayName(project),
    workspaceName: resolveWorkspaceDisplayName(workspace),
    checkout,
  };
}

export async function describeWorkspaceRecord(
  sources: WorkspaceDescriptorSources,
  workspace: PersistedWorkspaceRecord,
  projectRecord?: PersistedProjectRecord | null,
): Promise<WorkspaceDescriptorPayload> {
  const resolvedProjectRecord =
    projectRecord ?? (await sources.projectRegistry.get(workspace.projectId));

  let diffStat: { additions: number; deletions: number } | null = null;
  const snapshot = sources.workspaceRuntimeStore.get(workspace.cwd);
  if (snapshot?.git.diffStat) {
    diffStat = snapshot.git.diffStat;
  }

  const worktreeSlug =
    workspace.isPaseoOwnedWorktree && workspace.worktreeRoot
      ? basename(workspace.worktreeRoot)
      : undefined;

  return {
    id: workspace.workspaceId,
    projectId: workspace.projectId,
    projectDisplayName: resolvedProjectRecord
      ? resolveProjectDisplayName(resolvedProjectRecord)
      : workspace.projectId,
    projectCustomName: resolvedProjectRecord?.customName ?? null,
    projectCustomIconRevision: resolvedProjectRecord?.customIconRevision ?? null,
    projectRootPath: resolvedProjectRecord?.rootPath ?? workspace.cwd,
    workspaceDirectory: workspace.cwd,
    setupStatus: sources.workspaceSetupObservation.status(workspace),
    worktreeSlug,
    projectKind: (resolvedProjectRecord?.kind ?? "directory") === "git" ? "git" : "non_git",
    workspaceKind: workspace.kind,
    name: resolveWorkspaceDisplayName(workspace),
    title: workspace.title,
    pinnedAt: workspace.pinnedAt,
    ...(workspace.labels && workspace.labels.length > 0 ? { labels: workspace.labels } : {}),
    background: workspace.background,
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    createdAt: workspace.createdAt,
    diffStat,
    scripts: await sources.buildScripts(workspace, resolvedProjectRecord),
    ...(resolvedProjectRecord
      ? { project: await buildProjectPlacement(sources, workspace, resolvedProjectRecord) }
      : {}),
  };
}

export async function describeCreatedWorktreeWorkspace(
  sources: Pick<WorkspaceDescriptorSources, "projectRegistry" | "workspaceSetupObservation">,
  result: CreatePaseoWorktreeResult,
): Promise<WorkspaceDescriptorPayload> {
  const projectRecord = await sources.projectRegistry.get(result.workspace.projectId);
  return {
    id: result.workspace.workspaceId,
    projectId: result.workspace.projectId,
    projectDisplayName: projectRecord
      ? resolveProjectDisplayName(projectRecord)
      : result.workspace.projectId,
    projectCustomName: projectRecord?.customName ?? null,
    projectCustomIconRevision: projectRecord?.customIconRevision ?? null,
    projectRootPath: projectRecord?.rootPath ?? result.repoRoot,
    workspaceDirectory: result.workspace.cwd,
    setupStatus: sources.workspaceSetupObservation.status(result.workspace),
    worktreeSlug: basename(result.worktree.worktreePath),
    projectKind: projectRecord?.kind ?? "git",
    workspaceKind: result.workspace.kind,
    background: result.workspace.background,
    name: resolveWorkspaceName({
      title: result.workspace.title,
      derivedDisplayName: result.worktree.branchName || result.workspace.displayName,
    }),
    title: result.workspace.title,
    pinnedAt: result.workspace.pinnedAt,
    ...(result.workspace.labels && result.workspace.labels.length > 0
      ? { labels: result.workspace.labels }
      : {}),
    archivingAt: null,
    status: "done",
    statusEnteredAt: result.workspace.createdAt,
    activityAt: null,
    createdAt: result.workspace.createdAt,
    lastUserMessageAt: null,
    diffStat: { additions: 0, deletions: 0 },
    scripts: [],
    gitRuntime: {
      currentBranch: result.worktree.branchName || null,
      remoteUrl: null,
      isPaseoOwnedWorktree: true,
      isDirty: false,
      aheadBehind: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
    },
    githubRuntime: null,
  };
}
