import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { shallow } from "zustand/shallow";
import { useArtifacts, type ArtifactHost } from "@/artifacts/store";
import { useBoardTasks, type BoardHostTasks } from "@/board/tasks";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useHostDirectories } from "@/stores/session-store-hooks";
import {
  countDeskAttention,
  projectDesk,
  type DeskAttentionCounts,
  type DeskHostInput,
  type DeskHostRuntime,
  type DeskModel,
} from "./model";

export interface UseDeskOptions {
  enabled?: boolean;
}

interface DeskInputs {
  hosts: DeskHostInput[];
  serverIds: readonly string[];
}

const NO_BOARD_HOSTS: Readonly<Record<string, BoardHostTasks>> = {};
const NO_ARTIFACT_HOSTS: Readonly<Record<string, ArtifactHost>> = {};

function createRuntimeReader(serverIds: readonly string[]): () => DeskHostRuntime[] {
  const runtime = getHostRuntimeStore();
  let previous: DeskHostRuntime[] = [];
  return () => {
    const next = serverIds.map((serverId): DeskHostRuntime => {
      const snapshot = runtime.getSnapshot(serverId);
      return {
        serverId,
        connectionStatus: snapshot?.connectionStatus ?? "connecting",
        directoryStatus: snapshot?.agentDirectoryStatus ?? "idle",
        directoryError: snapshot?.agentDirectoryError ?? null,
        connectionError: snapshot?.lastError ?? null,
        lastOnlineAt: snapshot?.lastOnlineAt ?? null,
      };
    });
    const unchanged =
      next.length === previous.length &&
      next.every((host, index) => shallow(host, previous[index]));
    if (!unchanged) previous = next;
    return previous;
  };
}

function useDeskHostInputs(options: UseDeskOptions): DeskInputs {
  const enabled = options.enabled ?? true;
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const serverIds = useMemo(
    () => (enabled ? hosts.map((host) => host.serverId) : []),
    [enabled, hosts],
  );
  const directories = useHostDirectories(serverIds);
  const boardHosts = useBoardTasks((state) => (enabled ? state.hosts : NO_BOARD_HOSTS));
  const readRuntime = useMemo(() => createRuntimeReader(serverIds), [serverIds]);
  const subscribeRuntime = useCallback(
    (onChange: () => void) => runtime.subscribeAll(onChange),
    [runtime],
  );
  const runtimeHosts = useSyncExternalStore(subscribeRuntime, readRuntime, readRuntime);
  const inputs = useMemo(() => {
    const hostNames = new Map(hosts.map((host) => [host.serverId, host.label]));
    const runtimeByHost = new Map(runtimeHosts.map((host) => [host.serverId, host]));
    const result: DeskHostInput[] = [];
    for (const directory of directories) {
      const hostRuntime = runtimeByHost.get(directory.serverId);
      const serverName = hostNames.get(directory.serverId);
      if (!hostRuntime || serverName === undefined) continue;
      result.push({
        serverId: directory.serverId,
        serverName,
        runtime: hostRuntime,
        directory,
        board: boardHosts[directory.serverId],
      });
    }
    return result;
  }, [boardHosts, directories, hosts, runtimeHosts]);
  return { hosts: inputs, serverIds };
}

export function useDesk(options: UseDeskOptions = {}): DeskModel {
  const enabled = options.enabled ?? true;
  const runtime = getHostRuntimeStore();
  const { hosts, serverIds } = useDeskHostInputs({ enabled });
  const artifactsByHost = useArtifacts((state) => (enabled ? state.hosts : NO_ARTIFACT_HOSTS));
  useEffect(() => {
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => {
      for (const release of releases) release();
    };
  }, [runtime, serverIds]);
  return useMemo(() => projectDesk({ hosts, artifactsByHost }), [artifactsByHost, hosts]);
}

/** The sidebar consumes existing observations; it must not keep directory demand alive. */
export function useDeskAttentionCounts(): DeskAttentionCounts {
  const { hosts } = useDeskHostInputs({});
  return useMemo(() => countDeskAttention(hosts), [hosts]);
}
