import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SshMachine } from "@getpaseo/protocol/ssh-workspaces";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function sshMachinesQueryKey(serverId: string) {
  return ["sshMachines", serverId] as const;
}

export function sshWorkspaceRoutingQueryKey(serverId: string, workspaceId: string) {
  return ["sshWorkspaceRouting", serverId, workspaceId] as const;
}

export function sshWorkspaceOperationsQueryKey(serverId: string, workspaceId: string) {
  return ["sshWorkspaceOperations", serverId, workspaceId] as const;
}

// Effective routing for one workspace. Reading the machine defaults needs daemon.read; a
// rejected read surfaces as the query error.
export function useSshWorkspaceRouting(serverId: string, workspaceId: string) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  return useFetchQuery({
    queryKey: sshWorkspaceRoutingQueryKey(serverId, workspaceId),
    dataShape: "value",
    staleTimeMs: 5_000,
    enabled: Boolean(client && isConnected),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getSshWorkspaceRouting(workspaceId);
    },
  });
}

export function useSshWorkspaceOperations(serverId: string, workspaceId: string) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  return useFetchQuery({
    queryKey: sshWorkspaceOperationsQueryKey(serverId, workspaceId),
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: Boolean(client && isConnected),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.listSshWorkspaceOperations(workspaceId);
    },
  });
}

// The daemon owns machines; every client reads the same list and every action is
// checked by the daemon, so a cached "ready" state is never proof an operation will run.
export function useSshMachines(serverId: string) {
  const { t } = useTranslation();
  const disconnected = t("workspace.terminal.hostDisconnected");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "sshWorkspaces");
  const queryClient = useQueryClient();
  const query = useFetchQuery({
    queryKey: sshMachinesQueryKey(serverId),
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: Boolean(client && isConnected && isSupported),
    queryFn: async () => {
      if (!client) throw new Error(disconnected);
      return client.listSshMachines();
    },
  });

  const replace = useCallback(
    (machine: SshMachine) => {
      queryClient.setQueryData<SshMachine[]>(sshMachinesQueryKey(serverId), (current) => {
        const list = current ?? [];
        return list.some((entry) => entry.machineId === machine.machineId)
          ? list.map((entry) => (entry.machineId === machine.machineId ? machine : entry))
          : [...list, machine];
      });
    },
    [queryClient, serverId],
  );
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: sshMachinesQueryKey(serverId) }),
    [queryClient, serverId],
  );

  // Reads the list again from the daemon, ignoring the cache.
  const reload = useCallback(async () => {
    if (!client) throw new Error(disconnected);
    const machines = await client.listSshMachines();
    queryClient.setQueryData(sshMachinesQueryKey(serverId), machines);
    return machines;
  }, [client, disconnected, queryClient, serverId]);

  const requireClient = useCallback(() => {
    if (!client) throw new Error(disconnected);
    return client;
  }, [client, disconnected]);

  const save = useMutation({
    mutationFn: (input: Parameters<NonNullable<typeof client>["saveSshMachine"]>[0]) =>
      requireClient().saveSshMachine(input),
    onSuccess: replace,
  });
  const check = useMutation({
    mutationFn: (machineId: string) => requireClient().checkSshMachine(machineId),
    onSuccess: replace,
  });
  const trust = useMutation({
    mutationFn: (input: { machineId: string; revision: number; candidateId: string }) =>
      requireClient().trustSshMachineHostKey(input),
    onSuccess: replace,
  });
  const setPolicy = useMutation({
    mutationFn: (input: Parameters<NonNullable<typeof client>["setSshMachinePolicy"]>[0]) =>
      requireClient().setSshMachinePolicy(input),
    onSuccess: replace,
    onError: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (machineId: string) => requireClient().removeSshMachine(machineId),
    onSuccess: () => void refresh(),
  });
  const createWorkspace = useMutation({
    mutationFn: (input: { machineId: string; directory: string }) =>
      requireClient().createSshWorkspace(input),
    onSuccess: () => void refresh(),
  });

  const setWorkspaceRouting = useMutation({
    mutationFn: (input: Parameters<NonNullable<typeof client>["setSshWorkspaceRouting"]>[0]) =>
      requireClient().setSshWorkspaceRouting(input),
    onSettled: (_result, _error, input) =>
      void queryClient.invalidateQueries({
        queryKey: sshWorkspaceRoutingQueryKey(serverId, input.workspaceId),
      }),
  });

  const acknowledgeOperations = useMutation({
    mutationFn: (input: {
      workspaceId: string;
      operations: Array<{ operationId: string; at: string }>;
    }) => requireClient().acknowledgeSshWorkspaceOperations(input),
    onSettled: (_result, _error, input) =>
      void queryClient.invalidateQueries({
        queryKey: sshWorkspaceOperationsQueryKey(serverId, input.workspaceId),
      }),
  });

  return {
    reload,
    acknowledgeOperations,
    setWorkspaceRouting,
    isSupported,
    isConnected,
    machines: query.data ?? null,
    error: query.error,
    isLoading: query.isLoading,
    refresh,
    save,
    check,
    trust,
    setPolicy,
    remove,
    createWorkspace,
  };
}
