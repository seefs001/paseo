import type {
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { Check, X } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { PendingPermission } from "@/types/shared";
import { toErrorMessage } from "@/utils/error-messages";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

const NO_PERMISSIONS: PendingPermission[] = [];

type PermissionScope =
  | { workspaceId: string; agentId?: never }
  | { agentId: string; workspaceId?: never };

/** Pending permission requests from one agent, or from every agent in one workspace, oldest first. */
function usePendingPermissions(serverId: string, scope: PermissionScope): PendingPermission[] {
  const { workspaceId, agentId } = scope;
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const session = state.sessions[serverId];
      if (!session || session.pendingPermissions.size === 0) return NO_PERMISSIONS;
      const target = normalizeWorkspaceOpaqueId(workspaceId);
      const matches: PendingPermission[] = [];
      for (const permission of session.pendingPermissions.values()) {
        if (agentId !== undefined) {
          if (permission.agentId === agentId) matches.push(permission);
          continue;
        }
        const agent = session.agents.get(permission.agentId);
        if (agent && normalizeWorkspaceOpaqueId(agent.workspaceId) === target) {
          matches.push(permission);
        }
      }
      return matches.length > 0 ? matches : NO_PERMISSIONS;
    },
    shallow,
  );
}

/** The allow and deny actions the agent panel would offer, or the panel's defaults. */
function resolveDecisionActions(permission: PendingPermission): {
  allow: AgentPermissionAction;
  deny: AgentPermissionAction;
} {
  const actions = permission.request.actions ?? [];
  const allow =
    actions.find((action) => action.behavior === "allow" && action.variant === "primary") ??
    actions.find((action) => action.behavior === "allow");
  const deny = actions.find((action) => action.behavior === "deny");
  return {
    allow: allow ?? { id: "accept", label: "", behavior: "allow" },
    deny: deny ?? { id: "reject", label: "", behavior: "deny" },
  };
}

function toResponse(action: AgentPermissionAction): AgentPermissionResponse {
  return action.behavior === "allow"
    ? { behavior: "allow", selectedActionId: action.id }
    : { behavior: "deny", selectedActionId: action.id, message: "Denied by user" };
}

/**
 * Needs you, answered from the card: the oldest pending permission of the agent, or of any agent
 * in the workspace, with Approve and Deny. Questions need their form, so they only point at the
 * workspace.
 */
export function BoardPermissionRequest({
  serverId,
  ...scope
}: { serverId: string } & PermissionScope): ReactElement | null {
  const permissions = usePendingPermissions(serverId, scope);
  const first = permissions[0];
  if (!first) return null;
  return (
    <PermissionRow
      key={first.key}
      serverId={serverId}
      permission={first}
      moreCount={permissions.length - 1}
    />
  );
}

function PermissionRow({
  serverId,
  permission,
  moreCount,
}: {
  serverId: string;
  permission: PendingPermission;
  moreCount: number;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const { request } = permission;
  const isQuestion = request.kind === "question";
  const summary =
    request.kind === "plan"
      ? t("board.review.permission.plan")
      : (request.title ?? request.name ?? t("board.review.permission.required"));

  const respond = useCallback(
    async (behavior: "allow" | "deny") => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        toast.error(t("board.review.hostOffline"));
        return;
      }
      const actions = resolveDecisionActions(permission);
      setPending(behavior);
      try {
        await client.respondToPermissionAndWait(
          permission.agentId,
          request.id,
          toResponse(behavior === "allow" ? actions.allow : actions.deny),
          15000,
        );
      } catch (error) {
        toast.error(t("board.review.permission.failed", { message: toErrorMessage(error) }));
        setPending(null);
      }
    },
    [permission, request.id, serverId, t, toast],
  );
  const approve = useCallback(() => {
    void respond("allow");
  }, [respond]);
  const deny = useCallback(() => {
    void respond("deny");
  }, [respond]);

  return (
    <View style={styles.container} testID={`board-permission-${request.id}`}>
      <View style={styles.summaryRow}>
        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>
        {moreCount > 0 ? (
          <Text style={styles.more}>{t("board.review.permission.more", { count: moreCount })}</Text>
        ) : null}
      </View>
      {isQuestion ? (
        <Text style={styles.hint}>{t("board.review.permission.answerInWorkspace")}</Text>
      ) : (
        <View style={styles.actions}>
          <Button
            size="xs"
            variant="secondary"
            leftIcon={Check}
            onPress={approve}
            loading={pending === "allow"}
            disabled={pending !== null}
            testID="board-permission-approve"
          >
            {t("board.review.permission.approve")}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            leftIcon={X}
            onPress={deny}
            loading={pending === "deny"}
            disabled={pending !== null}
            testID="board-permission-deny"
          >
            {t("board.review.permission.deny")}
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  summary: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  more: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
