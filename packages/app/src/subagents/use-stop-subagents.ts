import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import {
  createStopAllSubagents,
  isStoppableTurn,
  type StopAllOutcome,
  type StopAllState,
  type StopAllSubagents,
} from "./stop-subagents";
import type { SubagentRow } from "./select";

export type { StopAllStatus } from "./stop-subagents";

export async function stopManagedSubagent(address: AgentAddress): Promise<void> {
  const session = useSessionStore.getState().sessions[address.serverId];
  const presentation = selectAgentTurnPresentation(session, address.agentId);
  if (!presentation.isActive || presentation.isCancelling) return;

  const runtime = getHostRuntimeStore();
  const client = session?.client;
  if (!isHostRuntimeConnected(runtime.getSnapshot(address.serverId)) || !client) {
    throw new Error(i18n.t("workspaceSetup.errors.hostDisconnected"));
  }

  const requestId = runtime.beginAgentCancellation(address.serverId, address.agentId);
  try {
    await client.cancelAgent(address.agentId);
  } finally {
    runtime.settleAgentCancellation(address.serverId, address.agentId, requestId);
  }
}

function isLiveStoppable(address: AgentAddress): boolean {
  const agent = useSessionStore.getState().sessions[address.serverId]?.agents.get(address.agentId);
  return Boolean(agent && isStoppableTurn(agent.turn));
}

export interface StopAllSubagentsCapability extends StopAllState {
  stopAll: () => Promise<StopAllOutcome>;
}

export function useStopAllSubagents(rows: readonly SubagentRow[]): StopAllSubagentsCapability {
  const stopAll = useMemo<StopAllSubagents>(
    () =>
      createStopAllSubagents([], {
        stopSubagent: stopManagedSubagent,
        isStillStoppable: isLiveStoppable,
      }),
    [],
  );
  const state = useSyncExternalStore(stopAll.subscribe, stopAll.getState, stopAll.getState);

  useEffect(() => {
    stopAll.setRows(rows);
  }, [rows, stopAll]);

  return { ...state, stopAll: stopAll.stopAll };
}

export function useStopSubagent(): (address: AgentAddress) => void {
  const toast = useToast();

  return useCallback(
    (address: AgentAddress) => {
      void stopManagedSubagent(address).catch((error: unknown) => {
        toast.error(toErrorMessage(error));
      });
    },
    [toast],
  );
}
