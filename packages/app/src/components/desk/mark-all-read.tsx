import { useMutation } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import type { DeskSession } from "@/desk/model";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

export function DeskMarkAllRead({ sessions }: { sessions: readonly DeskSession[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { mutate, isPending } = useMutation({
    mutationFn: async (replies: readonly DeskSession[]) => {
      const sessionsByHost = new Map<string, DeskSession[]>();
      for (const session of replies) {
        const hostSessions = sessionsByHost.get(session.serverId) ?? [];
        hostSessions.push(session);
        sessionsByHost.set(session.serverId, hostSessions);
      }
      const hosts = [...sessionsByHost];
      const runtime = getHostRuntimeStore();
      const results = await Promise.allSettled(
        hosts.map(async ([serverId, hostSessions]) => {
          const client = runtime.getClient(serverId);
          if (!client?.isConnected) throw new Error(t("desk.request.hostUnavailable"));
          await client.clearAgentAttention(hostSessions.map((session) => session.agent.id));
        }),
      );
      const failures: string[] = [];
      for (const [index, result] of results.entries()) {
        if (result.status !== "rejected") continue;
        const [, hostSessions] = hosts[index];
        failures.push(`${hostSessions[0].serverName}: ${toErrorMessage(result.reason)}`);
      }
      if (failures.length > 0) throw new AggregateError(failures, failures.join("\n"));
    },
    onError: (error) => {
      toast.error(t("desk.session.markAllReadFailed", { message: toErrorMessage(error) }));
    },
  });
  const markAllRead = useCallback(() => mutate(sessions), [mutate, sessions]);
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={CheckCheck}
      disabled={sessions.length === 0}
      loading={isPending}
      onPress={markAllRead}
      testID="desk-mark-all-read"
    >
      {isPending ? t("desk.session.markingAllRead") : t("desk.session.markAllRead")}
    </Button>
  );
}
