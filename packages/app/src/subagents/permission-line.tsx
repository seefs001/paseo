import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { Check, X } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  resolveDecisionActions,
  toPermissionResponse,
} from "@/components/board/permission-request";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { PendingPermission } from "@/types/shared";
import { toErrorMessage } from "@/utils/error-messages";

const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);

function useFirstPendingPermission(address: AgentAddress): PendingPermission | null {
  return useSessionStore((state) => {
    const session = state.sessions[address.serverId];
    if (!session || session.pendingPermissions.size === 0) return null;
    for (const permission of session.pendingPermissions.values()) {
      if (permission.agentId === address.agentId) return permission;
    }
    return null;
  });
}

/**
 * The subagent's oldest pending permission, answered from its track row. Questions and plans need
 * their full card, so the row only names them and the user opens the subagent to answer.
 */
export function SubagentPermissionLine({
  address,
  compact,
}: {
  address: AgentAddress;
  compact: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const permission = useFirstPendingPermission(address);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const respond = useCallback(
    async (behavior: "allow" | "deny") => {
      if (!permission) return;
      const client = getHostRuntimeStore().getClient(address.serverId);
      if (!client) {
        toast.error(t("board.review.hostOffline"));
        return;
      }
      const actions = resolveDecisionActions(permission);
      setPendingId(permission.request.id);
      try {
        await client.respondToPermissionAndWait(
          permission.agentId,
          permission.request.id,
          toPermissionResponse(behavior === "allow" ? actions.allow : actions.deny),
          15000,
        );
      } catch (error) {
        toast.error(t("board.review.permission.failed", { message: toErrorMessage(error) }));
        setPendingId(null);
      }
    },
    [address.serverId, permission, t, toast],
  );
  const approve = useCallback(() => void respond("allow"), [respond]);
  const deny = useCallback(() => void respond("deny"), [respond]);

  if (!permission) return null;
  const { request } = permission;
  const answerable = request.kind !== "question" && request.kind !== "plan";
  const summary =
    request.kind === "plan"
      ? t("board.review.permission.plan")
      : (request.title ?? request.name ?? t("board.review.permission.required"));
  const busy = pendingId === request.id;
  const iconSize = paneContentToolbarIconSize(compact);

  return (
    <View style={styles.line} testID={`subagents-track-permission-${address.agentId}`}>
      <Text style={styles.summary} numberOfLines={1}>
        {summary}
      </Text>
      {answerable ? (
        <View style={styles.actions}>
          <ToolbarButton
            label={t("board.review.permission.approve")}
            compact={compact}
            disabled={busy}
            onPress={approve}
            testID={`subagents-track-permission-approve-${address.agentId}`}
          >
            <ThemedCheck size={iconSize} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
          <ToolbarButton
            label={t("board.review.permission.deny")}
            compact={compact}
            disabled={busy}
            onPress={deny}
            testID={`subagents-track-permission-deny-${address.agentId}`}
          >
            <ThemedX size={iconSize} uniProps={mutedIconColorMapping} />
          </ToolbarButton>
        </View>
      ) : (
        <Text style={styles.hint} numberOfLines={1}>
          {t("subagents.permissionOpenToAnswer")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summary: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  hint: {
    flexShrink: 2,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
