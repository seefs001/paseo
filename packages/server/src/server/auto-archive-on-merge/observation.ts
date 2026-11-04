import { resolve } from "node:path";
import type { Logger } from "pino";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { WorkspaceGitService, WorkspaceGitSubscription } from "../workspace-git-service.js";

interface AutoArchiveObservationOptions {
  daemonConfigStore: DaemonConfigStore;
  workspaceRegistry: Pick<WorkspaceRegistry, "listActive"> &
    Required<Pick<WorkspaceRegistry, "subscribeToMutations">>;
  workspaceGitService: WorkspaceGitService;
  logger: Logger;
}

/** Automatic archive is a remote-status consumer even when no app is open. */
export function observeAutoArchiveWorkspaces({
  daemonConfigStore,
  workspaceRegistry,
  workspaceGitService,
  logger,
}: AutoArchiveObservationOptions): WorkspaceGitSubscription {
  const subscriptions = new Map<string, WorkspaceGitSubscription>();
  let stopped = false;
  let pending = Promise.resolve();

  function clear() {
    for (const subscription of subscriptions.values()) subscription.unsubscribe();
    subscriptions.clear();
  }

  async function reconcile() {
    if (stopped) return;
    if (daemonConfigStore.get().autoArchiveAfterMerge !== true) {
      clear();
      return;
    }
    const workspaces = await workspaceRegistry.listActive();
    if (stopped || daemonConfigStore.get().autoArchiveAfterMerge !== true) return;
    const directories = new Set(
      workspaces
        .filter((workspace) => workspace.isPaseoOwnedWorktree)
        .map((workspace) => resolve(workspace.cwd)),
    );
    for (const [cwd, subscription] of subscriptions) {
      if (directories.has(cwd)) continue;
      subscription.unsubscribe();
      subscriptions.delete(cwd);
    }
    for (const cwd of directories) {
      if (subscriptions.has(cwd)) continue;
      subscriptions.set(
        cwd,
        workspaceGitService.registerWorkspace({ cwd, includeForge: true }, () => {}),
      );
    }
  }

  function schedule() {
    pending = pending.then(reconcile).catch((err) => {
      logger.warn({ err }, "Failed to update automatic archive observations");
    });
  }

  const stopWorkspaces = workspaceRegistry.subscribeToMutations(schedule);
  const stopConfig = daemonConfigStore.onFieldChange("autoArchiveAfterMerge", schedule);
  schedule();
  return {
    unsubscribe() {
      stopped = true;
      stopWorkspaces();
      stopConfig();
      clear();
    },
  };
}
