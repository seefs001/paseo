import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { UserRound } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentRole } from "@getpaseo/protocol/messages";
import { AgentProfileGlyph, useAgentProfiles } from "@/agent-profiles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useAgentRoles } from "../internal/use-agent-roles";
import type { MenuTriggerState } from "@/components/ui/menu";

const ThemedUserRound = withUnistyles(UserRound);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

export interface DraftAgentRoleControlProps {
  serverId: string | null;
  provider: string | null;
  selectedRoleId: string | null;
  onSelectRole: (roleId: string | null) => void;
  /** Applies the chosen role's default Agent profile to the draft controls. */
  onApplyProfile?: (profileId: string) => void;
  disabled?: boolean;
  /** Draw the role name next to its glyph. A draft without a role is always glyph only. */
  showLabel: boolean;
}

/**
 * Whether the selected provider can take a role. `null` while the provider is
 * still loading: the daemon has the final say, so the composer only warns once
 * it knows.
 */
function useProviderTakesRole(serverId: string | null, provider: string | null): boolean | null {
  const { entries } = useProvidersSnapshot(serverId, { cwd: null });
  const entry = provider ? entries?.find((candidate) => candidate.provider === provider) : null;
  if (!entry || entry.status !== "ready") return null;
  return entry.supportsSystemPrompt === true;
}

function DraftRoleGlyph({
  isBlocked,
  hasRole,
  role,
}: {
  isBlocked: boolean;
  hasRole: boolean;
  role: AgentRole | null;
}): ReactElement {
  if (isBlocked) return <ThemedUserRound size={ICON_SIZE.sm} uniProps={dangerColorMapping} />;
  if (hasRole)
    return <AgentProfileGlyph icon={role?.icon} color={role?.color} size={ICON_SIZE.sm} />;
  return <ThemedUserRound size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
}

function RoleMenuItem({
  role,
  selected,
  profileName,
  onSelect,
}: {
  role: AgentRole;
  selected: boolean;
  profileName: string;
  onSelect: (roleId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(role.id), [onSelect, role.id]);
  const leading = useMemo(
    () => <AgentProfileGlyph icon={role.icon} color={role.color} size={ICON_SIZE.sm} />,
    [role.color, role.icon],
  );
  const trailing = useMemo(
    () =>
      profileName ? (
        <Text style={styles.menuTrailing} numberOfLines={1}>
          {profileName}
        </Text>
      ) : null,
    [profileName],
  );
  return (
    <DropdownMenuItem
      testID={`draft-role-option-${role.id}`}
      onSelect={handleSelect}
      selected={selected}
      leading={leading}
      trailing={trailing}
      {...(role.description ? { description: role.description } : {})}
    >
      {role.name}
    </DropdownMenuItem>
  );
}

/**
 * The role chip at the head of a draft's agent controls. A role is chosen per
 * draft and never remembered: its instructions shape the agent without showing
 * in the conversation, so carrying one over unseen would surprise.
 */
export function DraftAgentRoleControl({
  serverId,
  provider,
  selectedRoleId,
  onSelectRole,
  onApplyProfile,
  disabled = false,
  showLabel,
}: DraftAgentRoleControlProps): ReactElement | null {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { roles, isSupported } = useAgentRoles(serverId);
  const { profiles } = useAgentProfiles(serverId);
  const providerTakesRole = useProviderTakesRole(serverId, provider);

  const selectedRole = useMemo(
    () => (selectedRoleId ? (roles?.find((role) => role.id === selectedRoleId) ?? null) : null),
    [roles, selectedRoleId],
  );
  const profileNames = useMemo(
    () => new Map((profiles ?? []).map((profile) => [profile.id, profile.name])),
    [profiles],
  );
  const isBlocked = selectedRoleId !== null && providerTakesRole === false;

  const handleSelectRole = useCallback(
    (roleId: string) => {
      onSelectRole(roleId);
      const role = roles?.find((entry) => entry.id === roleId);
      if (role?.defaultProfileId && profileNames.has(role.defaultProfileId)) {
        onApplyProfile?.(role.defaultProfileId);
      }
    },
    [onApplyProfile, onSelectRole, profileNames, roles],
  );
  const handleClearRole = useCallback(() => onSelectRole(null), [onSelectRole]);
  const openRoleSettings = useCallback(() => {
    if (serverId) router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [router, serverId]);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open: isOpen }: MenuTriggerState) => [
      styles.trigger,
      !(showLabel && selectedRoleId) && styles.triggerIconOnly,
      hovered && styles.triggerHovered,
      (pressed || isOpen) && styles.triggerPressed,
      disabled && styles.triggerDisabled,
    ],
    [disabled, selectedRoleId, showLabel],
  );

  if (!isSupported || !serverId || roles === null) return null;

  const roleName = selectedRole?.name ?? selectedRoleId ?? "";
  let tooltip = t("agentControls.role.title");
  if (isBlocked) tooltip = t("agentControls.role.unsupportedProvider");
  else if (selectedRoleId) tooltip = t("agentControls.role.selectedTooltip", { name: roleName });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop={!open} enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerWrapper}>
            <DropdownMenuTrigger
              testID="draft-role-trigger"
              disabled={disabled}
              style={triggerStyle}
              accessibilityRole="button"
              accessibilityLabel={tooltip}
            >
              <ComposerToolbarGlyph size={ICON_SIZE.sm}>
                <DraftRoleGlyph
                  isBlocked={isBlocked}
                  hasRole={selectedRoleId !== null}
                  role={selectedRole}
                />
              </ComposerToolbarGlyph>
              {showLabel && selectedRoleId ? (
                <Text
                  style={isBlocked ? styles.triggerLabelBlocked : styles.triggerLabel}
                  numberOfLines={1}
                >
                  {roleName}
                </Text>
              ) : null}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        width={320}
        sheetTitle={t("agentControls.role.title")}
        testID="draft-role-menu"
      >
        {isBlocked ? (
          <DropdownMenuHint testID="draft-role-unsupported-hint">
            {t("agentControls.role.unsupportedProvider")}
          </DropdownMenuHint>
        ) : null}
        <DropdownMenuItem
          testID="draft-role-option-none"
          onSelect={handleClearRole}
          selected={selectedRoleId === null}
          muted
        >
          {t("agentControls.role.none")}
        </DropdownMenuItem>
        {roles.map((role) => (
          <RoleMenuItem
            key={role.id}
            role={role}
            selected={role.id === selectedRoleId}
            profileName={
              role.defaultProfileId ? (profileNames.get(role.defaultProfileId) ?? "") : ""
            }
            onSelect={handleSelectRole}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem testID="draft-role-manage" onSelect={openRoleSettings} muted>
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
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  triggerLabelBlocked: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  menuTrailing: {
    maxWidth: 120,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
