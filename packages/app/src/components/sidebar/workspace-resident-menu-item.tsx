import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Bot, BotOff } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

const ThemedBot = withUnistyles(Bot);
const ThemedBotOff = withUnistyles(BotOff);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const residentLeadingIcon = <ThemedBot size={14} uniProps={foregroundMutedColorMapping} />;
const unresidentLeadingIcon = <ThemedBotOff size={14} uniProps={foregroundMutedColorMapping} />;

/**
 * Toggles whether a workspace is resident: a standing bot listed in the sidebar Resident section
 * and by the MCP `list_workspaces` tool with `residentOnly`. Reads its own state from the session
 * store so the row components above it do not have to carry another prop.
 */
export function WorkspaceResidentMenuItem({
  surface,
  serverId,
  workspaceId,
  workspaceKey,
}: {
  surface: "context" | "dropdown";
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeature(serverId, "workspaceResident");
  const isResident = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId)?.residentAt != null,
  );
  const mutation = useMutation({
    mutationFn: async (resident: boolean) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspaceResident(workspaceId, resident);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
  });
  const { mutate, isPending } = mutation;
  const handleSelect = useCallback(() => {
    if (!isPending) mutate(!isResident);
  }, [isPending, isResident, mutate]);

  if (!supported) return null;

  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <Item
      testID={`sidebar-workspace-menu-resident-${workspaceKey}`}
      leading={isResident ? unresidentLeadingIcon : residentLeadingIcon}
      onSelect={handleSelect}
    >
      {isResident
        ? t("sidebar.workspace.actions.unmarkResident")
        : t("sidebar.workspace.actions.markResident")}
    </Item>
  );
}
