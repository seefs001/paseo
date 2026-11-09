import { useMutation } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { DeskCheckpoint } from "@/board/desk";
import { DensityIcon } from "@/components/ui/density-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

/** Agent ids per host whose checkpoint is an unread finished turn, the same set the card's mark-read covers. */
function unreadAgentsByHost(checkpoints: readonly DeskCheckpoint[]): Map<string, string[]> {
  const byHost = new Map<string, string[]>();
  for (const { item } of checkpoints) {
    if (item?.kind !== "agent" || item.column !== "review" || !item.agent.requiresAttention) {
      continue;
    }
    const ids = byHost.get(item.serverId) ?? [];
    ids.push(item.agent.id);
    byHost.set(item.serverId, ids);
  }
  return byHost;
}

export function DeskDecideMarkAllRead({
  checkpoints,
}: {
  checkpoints: readonly DeskCheckpoint[];
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const byHost = useMemo(() => unreadAgentsByHost(checkpoints), [checkpoints]);
  const { mutate, isPending } = useMutation({
    mutationFn: async (hosts: Map<string, string[]>) => {
      const runtime = getHostRuntimeStore();
      const results = await Promise.allSettled(
        [...hosts].map(async ([serverId, agentIds]) => {
          const client = runtime.getClient(serverId);
          if (!client?.isConnected) throw new Error(t("board.errors.offline"));
          await client.clearAgentAttention(agentIds);
        }),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [toErrorMessage(result.reason)] : [],
      );
      if (failures.length > 0) throw new AggregateError(failures, failures.join("\n"));
    },
    onError: (error) => {
      toast.error(t("desk.session.markAllReadFailed", { message: toErrorMessage(error) }));
    },
  });
  const markAllRead = useCallback(() => mutate(byHost), [byHost, mutate]);
  if (byHost.size === 0) return null;
  return (
    <ToolbarButton
      compact
      label={t("desk.session.markAllRead")}
      onPress={markAllRead}
      disabled={isPending}
      testID="board-decide-mark-all-read"
    >
      <DensityIcon icon={CheckCheck} size="sm" color="foregroundMuted" />
    </ToolbarButton>
  );
}
