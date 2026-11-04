import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { stopManagedSubagent } from "./use-stop-subagents";

export type BulkSubagentAction = "stop" | "detach" | "archive";

export interface BulkSubagentActions {
  pending: BulkSubagentAction | null;
  /** Resolves true when the action ran, false when the user cancelled it. */
  run: (action: BulkSubagentAction, addresses: readonly AgentAddress[]) => Promise<boolean>;
}

async function detachManagedSubagent(address: AgentAddress): Promise<void> {
  const client = useSessionStore.getState().sessions[address.serverId]?.client;
  if (!client) throw new Error(i18n.t("workspaceSetup.errors.hostDisconnected"));
  await client.detachAgent(address.agentId);
}

/**
 * Stop, detach, or archive the subagents a user picked in the panel. Detach and archive ask once
 * for the whole selection instead of once per row; stop does not ask, like the row's stop.
 */
export function useBulkSubagentActions(): BulkSubagentActions {
  const { t } = useTranslation();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const [pending, setPending] = useState<BulkSubagentAction | null>(null);

  const run = useCallback(
    async (action: BulkSubagentAction, addresses: readonly AgentAddress[]) => {
      if (addresses.length === 0) return false;
      const count = addresses.length;
      if (action !== "stop") {
        const confirmed = await confirmDialog(
          action === "archive"
            ? {
                title: t("subagents.archiveSelectedConfirmTitle", { count }),
                message: t("subagents.archiveSelectedConfirmMessage"),
                confirmLabel: t("subagents.archiveSelectedAction"),
                cancelLabel: t("subagents.selectionCancel"),
                destructive: true,
              }
            : {
                title: t("subagents.detachSelectedConfirmTitle", { count }),
                message: t("subagents.detachSelectedConfirmMessage"),
                confirmLabel: t("subagents.detachSelectedAction"),
                cancelLabel: t("subagents.selectionCancel"),
              },
        );
        if (!confirmed) return false;
      }
      const perform = {
        stop: stopManagedSubagent,
        detach: detachManagedSubagent,
        archive: archiveAgent,
      }[action];
      setPending(action);
      try {
        const results = await Promise.allSettled(addresses.map((address) => perform(address)));
        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        const firstFailure = failures[0];
        if (firstFailure) {
          toast.error(
            t("subagents.bulkActionFailed", {
              failed: failures.length,
              total: count,
              message: toErrorMessage(firstFailure.reason),
            }),
          );
        }
      } finally {
        setPending(null);
      }
      return true;
    },
    [archiveAgent, t, toast],
  );

  return { pending, run };
}
