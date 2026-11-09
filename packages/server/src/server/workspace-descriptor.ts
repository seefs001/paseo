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
  // Location facts for SSH workspaces; absent or null means the owner computer.
  describeExecutionLocation?(
    workspace: PersistedWorkspaceRecord,
  ): WorkspaceDescriptorPayload["executionLocation"] | null;
}

export async function buildProjectPlacement(
  sources: Pick<
    WorkspaceDescriptorSources,
    "projectRegistry" | "workspaceRuntimeStore" | "describeExecutionLocation"
  >,
  workspace: PersistedWorkspaceRecord,
  projectRecord?: PersistedProjectRecord | null,
): Promise<ProjectPlacementPayload> {
  const project = projectRecord ?? (await sources.projectRegistry.get(workspace.projectId));
  const location = workspace.executionLocation
    ? (sources.describeExecutionLocation?.(workspace) ?? null)
    : null;
  if (location) return sshProjectPlacement(workspace, project ?? null, location);
  if (workspace.projectId !== null && !project) {
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
    // COMPAT(unassignedProjectWire): added after v0.15.3; remove empty-string projections
    // when the protocol floor permits nullable project keys, not merely a newer app version.
    ...(workspace.projectId === null ? { projectAssigned: false } : {}),
    projectKey: project?.projectId ?? "",
    projectName: project ? resolveProjectDisplayName(project) : "",
    workspaceName: resolveWorkspaceDisplayName(workspace),
    checkout,
  };
}

function projectIdentityForWire(
  workspace: PersistedWorkspaceRecord,
  project: PersistedProjectRecord | null,
) {
  return {
    // COMPAT(unassignedProjectWire): added after v0.15.3; remove when the protocol floor
    // permits nullable project IDs. No corresponding Project record is manufactured.
    ...(workspace.projectId === null ? { projectAssigned: false } : {}),
    projectId: workspace.projectId ?? "",
    projectDisplayName: project ? resolveProjectDisplayName(project) : (workspace.projectId ?? ""),
    projectCustomName: project?.customName ?? null,
    projectCustomIconRevision: project?.customIconRevision ?? null,
  };
}

export async function describeWorkspaceRecord(
  sources: WorkspaceDescriptorSources,
  workspace: PersistedWorkspaceRecord,
  projectRecord?: PersistedProjectRecord | null,
): Promise<WorkspaceDescriptorPayload> {
  const location = workspace.executionLocation
    ? (sources.describeExecutionLocation?.(workspace) ?? null)
    : null;
  if (location) return describeSshWorkspaceRecord(sources, workspace, location);
  return describeLocalWorkspaceRecord(sources, workspace, projectRecord);
}

async function describeLocalWorkspaceRecord(
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
    ...projectIdentityForWire(workspace, resolvedProjectRecord),
    projectRootPath: resolvedProjectRecord?.rootPath ?? workspace.cwd,
    workspaceDirectory: workspace.cwd,
    setupStatus: sources.workspaceSetupObservation.status(workspace),
    worktreeSlug,
    projectKind: (resolvedProjectRecord?.kind ?? "directory") === "git" ? "git" : "non_git",
    workspaceKind: workspace.kind,
    name: resolveWorkspaceDisplayName(workspace),
    title: workspace.title,
    pinnedAt: workspace.pinnedAt,
    residentAt: workspace.residentAt,
    metadata: workspace.metadata,
    ...(workspace.labels && workspace.labels.length > 0 ? { labels: workspace.labels } : {}),
    background: workspace.background,
    parentWorkspaceId: workspace.parentWorkspaceId,
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    createdAt: workspace.createdAt,
    diffStat,
    uncommittedDiffStat: snapshot?.git.uncommittedDiffStat ?? null,
    scripts: await sources.buildScripts(workspace, resolvedProjectRecord),
    ...(resolvedProjectRecord || workspace.projectId === null
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
    ...projectIdentityForWire(result.workspace, projectRecord),
    projectRootPath: projectRecord?.rootPath ?? result.repoRoot,
    workspaceDirectory: result.workspace.cwd,
    setupStatus: sources.workspaceSetupObservation.status(result.workspace),
    worktreeSlug: basename(result.worktree.worktreePath),
    projectKind: projectRecord?.kind ?? "git",
    workspaceKind: result.workspace.kind,
    background: result.workspace.background,
    parentWorkspaceId: result.workspace.parentWorkspaceId,
    name: resolveWorkspaceName({
      title: result.workspace.title,
      derivedDisplayName: result.worktree.branchName || result.workspace.displayName,
    }),
    title: result.workspace.title,
    pinnedAt: result.workspace.pinnedAt,
    residentAt: result.workspace.residentAt,
    metadata: result.workspace.metadata,
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
    uncommittedDiffStat: null,
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

// SSH workspaces keep their owner-side session directory internal. The wire carries the
// directory key instead, which every workspace on the same machine directory shares and
// which local-only RPCs refuse. Git is reported as observed on the machine; an unobserved
// state is "directory", never a "non_git" claim.
async function describeSshWorkspaceRecord(
  sources: WorkspaceDescriptorSources,
  workspace: PersistedWorkspaceRecord,
  location: NonNullable<WorkspaceDescriptorPayload["executionLocation"]>,
): Promise<WorkspaceDescriptorPayload> {
  const key = location.key ?? location.directory;
  const project = await sources.projectRegistry.get(workspace.projectId);
  let projectKind: WorkspaceDescriptorPayload["projectKind"] = "directory";
  if (location.gitObservation === "git") projectKind = "git";
  else if (location.gitObservation === "not_git") projectKind = "non_git";
  return {
    id: workspace.workspaceId,
    ...projectIdentityForWire(workspace, project),
    projectRootPath: key,
    workspaceDirectory: key,
    setupStatus: null,
    projectKind,
    workspaceKind: "directory",
    name: resolveWorkspaceDisplayName(workspace),
    title: workspace.title,
    pinnedAt: workspace.pinnedAt,
    residentAt: workspace.residentAt,
    metadata: workspace.metadata,
    ...(workspace.labels && workspace.labels.length > 0 ? { labels: workspace.labels } : {}),
    background: workspace.background,
    executionLocation: location,
    parentWorkspaceId: workspace.parentWorkspaceId,
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    createdAt: workspace.createdAt,
    diffStat: null,
    uncommittedDiffStat: null,
    scripts: [],
    project: sshProjectPlacement(workspace, project, location),
  };
}

function sshProjectPlacement(
  workspace: PersistedWorkspaceRecord,
  project: PersistedProjectRecord | null,
  location: NonNullable<WorkspaceDescriptorPayload["executionLocation"]>,
): ProjectPlacementPayload {
  const key = location.key ?? location.directory;
  return {
    ...(workspace.projectId === null ? { projectAssigned: false } : {}),
    projectKey: project?.projectId ?? "",
    projectName: project ? resolveProjectDisplayName(project) : "",
    workspaceName: resolveWorkspaceDisplayName(workspace),
    checkout:
      location.gitObservation === "git"
        ? {
            cwd: key,
            isGit: true,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: key,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          }
        : {
            cwd: key,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          },
  };
}
