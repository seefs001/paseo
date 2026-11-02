import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import type { AgentRoleSnapshot } from "@getpaseo/protocol/messages";
import { AgentProfileGlyph } from "@/agent-profiles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { ICON_SIZE } from "@/styles/theme";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useAgentRoles } from "../internal/use-agent-roles";

export interface AgentRoleBadgeProps {
  serverId: string;
  role: AgentRoleSnapshot;
  /** Opens a new draft in the agent's workspace with this role selected. */
  onNewAgentWithRole?: () => void;
  showLabel: boolean;
}

/**
 * A running agent's role. Read-only: the role's instructions are in the
 * agent's system prompt, which most providers fix at creation.
 */
export function AgentRoleBadge({
  serverId,
  role,
  onNewAgentWithRole,
  showLabel,
}: AgentRoleBadgeProps): ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { roles } = useAgentRoles(serverId);
  const liveRole = useMemo(
    () => roles?.find((candidate) => candidate.id === role.id) ?? null,
    [role.id, roles],
  );
  // While the host's roles are still loading, assume the role exists.
  const isRemoved = roles !== null && liveRole === null;
  const label = isRemoved ? t("agentControls.role.removedName", { name: role.name }) : role.name;

  const openRoleSettings = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [router, serverId]);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open: isOpen }: MenuTriggerState) => [
      styles.trigger,
      !showLabel && styles.triggerIconOnly,
      hovered && styles.triggerHovered,
      (pressed || isOpen) && styles.triggerPressed,
    ],
    [showLabel],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop={!open} enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerWrapper}>
            <DropdownMenuTrigger
              testID="agent-role-badge"
              style={triggerStyle}
              accessibilityRole="button"
              accessibilityLabel={t("agentControls.role.selectedTooltip", { name: label })}
            >
              <ComposerToolbarGlyph size={ICON_SIZE.sm}>
                <AgentProfileGlyph icon={role.icon} color={role.color} size={ICON_SIZE.sm} />
              </ComposerToolbarGlyph>
              {showLabel ? (
                <Text style={styles.triggerLabel} numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>
            {t("agentControls.role.selectedTooltip", { name: label })}
          </Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        width={300}
        sheetTitle={label}
        testID="agent-role-badge-menu"
      >
        {liveRole?.description ? <DropdownMenuHint>{liveRole.description}</DropdownMenuHint> : null}
        <DropdownMenuHint testID="agent-role-badge-fixed-hint">
          {t("agentControls.role.fixedHint")}
        </DropdownMenuHint>
        {onNewAgentWithRole && !isRemoved ? (
          <DropdownMenuItem testID="agent-role-badge-new-agent" onSelect={onNewAgentWithRole}>
            {t("agentControls.role.newAgentWithRole")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem testID="agent-role-badge-manage" onSelect={openRoleSettings} muted>
          {t("agentControls.role.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  triggerWrapper: {
    minWidth: 0,
    flexShrink: 1,
  },
  trigger: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  triggerIconOnly: {
    width: 28,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface0,
  },
  triggerLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
