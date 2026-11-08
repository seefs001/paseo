import { stat } from "node:fs/promises";
import type { ProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";

/** Change host-local membership without touching execution or checkout ownership. */
export async function setWorkspaceProject(input: {
  workspaceId: string;
  projectId: string | null;
  workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  projectRegistry: Pick<ProjectRegistry, "get">;
}): Promise<void> {
  // Both registries belong to the destination daemon, including for routed requests.
  if (input.projectId !== null) {
    const project = await input.projectRegistry.get(input.projectId);
    if (!project || project.archivedAt) throw new Error("Target project not found or archived");
    if (!(await stat(project.rootPath)).isDirectory()) {
      throw new Error("Target project root is not a directory");
    }
  }

  const updated = await input.workspaceRegistry.update(input.workspaceId, (workspace) => {
    if (workspace.archivedAt) throw new Error("Workspace is archived");
    if (workspace.projectId === input.projectId) return workspace;
    // In particular, keep worktreeRoot, mainRepoRoot and isPaseoOwnedWorktree:
    // changing the grouping must never grant ownership of a user's directory.
    return { ...workspace, projectId: input.projectId, updatedAt: new Date().toISOString() };
  });
  if (!updated) throw new Error("Workspace not found");
}
