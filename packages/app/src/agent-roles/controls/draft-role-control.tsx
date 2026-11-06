import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { UserRound } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentRole } from "@getpaseo/protocol/messages";
import { AgentProfileGlyph, useAgentProfiles } from "@/agent-profiles";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useAgentRoles } from "../internal/use-agent-roles";

const ThemedUserRound = withUnistyles(UserRound);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

// The picker's "no role" row. Created roles get `agent_role_…` ids and built-ins use plain words.
const NO_ROLE_OPTION_ID = "__no-role__";
// Matches the other composer pickers: a short list reads faster without a search field.
const SEARCH_THRESHOLD = 6;

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
  size,
}: {
  isBlocked: boolean;
  hasRole: boolean;
  role: AgentRole | null;
  size: number;
}): ReactElement {
  if (isBlocked) return <ThemedUserRound size={size} uniProps={dangerColorMapping} />;
  if (hasRole) return <AgentProfileGlyph icon={role?.icon} color={role?.color} size={size} />;
  return <ThemedUserRound size={size} uniProps={mutedColorMapping} />;
}

function RoleOption({
  option,
  role,
  profileName,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  role: AgentRole | null;
  profileName: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leading = useMemo(
    () =>
      role ? (
        <AgentProfileGlyph icon={role.icon} color={role.color} size={ICON_SIZE.sm} />
      ) : (
        <ThemedUserRound size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
      ),
    [role],
  );
  const trailing = useMemo(
    () =>
      profileName ? (
        <Text style={styles.optionTrailing} numberOfLines={1}>
          {profileName}
        </Text>
      ) : null,
    [profileName],
  );
  return (
    <ComboboxItem
      testID={`draft-role-option-${role ? role.id : "none"}`}
      label={option.label}
      description={option.description}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leading}
      trailingSlot={trailing}
      wrapDescription
    />
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
  const { glyphs } = useComposerControlLayout();
  const anchorRef = useRef<View>(null);
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
  const rolesById = useMemo(() => new Map((roles ?? []).map((role) => [role.id, role])), [roles]);
  const isBlocked = selectedRoleId !== null && providerTakesRole === false;

  const options = useMemo<ComboboxOption[]>(
    () => [
      { id: NO_ROLE_OPTION_ID, label: t("agentControls.role.none") },
      ...(roles ?? []).map((role) => ({
        id: role.id,
        label: role.name,
        description: role.description,
      })),
    ],
    [roles, t],
  );

  const handleSelect = useCallback(
    (optionId: string) => {
      if (optionId === NO_ROLE_OPTION_ID) {
        onSelectRole(null);
        return;
      }
      onSelectRole(optionId);
      const role = rolesById.get(optionId);
      if (role?.defaultProfileId && profileNames.has(role.defaultProfileId)) {
        onApplyProfile?.(role.defaultProfileId);
      }
    },
    [onApplyProfile, onSelectRole, profileNames, rolesById],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const openRoleSettings = useCallback(() => {
    setOpen(false);
    if (serverId) router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [router, serverId]);

  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => {
      const role = rolesById.get(option.id) ?? null;
      const profileName = role?.defaultProfileId
        ? (profileNames.get(role.defaultProfileId) ?? "")
        : "";
      return (
        <RoleOption
          option={option}
          role={role}
          profileName={profileName}
          selected={selected}
          active={active}
          onPress={onPress}
        />
      );
    },
    [profileNames, rolesById],
  );

  const stickyHeader = useMemo(
    () =>
      isBlocked ? (
        <Text style={styles.blockedHint} testID="draft-role-unsupported-hint">
          {t("agentControls.role.unsupportedProvider")}
        </Text>
      ) : null,
    [isBlocked, t],
  );
  const footer = useMemo(
    () => (
      <Button variant="ghost" size="sm" onPress={openRoleSettings} testID="draft-role-manage">
        {t("agentControls.role.manage")}
      </Button>
    ),
    [openRoleSettings, t],
  );

  const triggerStyle = useCallback(
    ({ hovered, pressed }: { hovered: boolean; pressed: boolean }) => [
      styles.trigger,
      !(showLabel && selectedRoleId) && styles.triggerIconOnly,
      hovered && styles.triggerHovered,
      (pressed || open) && styles.triggerPressed,
      disabled && styles.triggerDisabled,
    ],
    [disabled, open, selectedRoleId, showLabel],
  );

  if (!isSupported || !serverId || roles === null) return null;

  const glyphRole = showLabel && selectedRoleId ? "label" : "icon";
  const roleName = selectedRole?.name ?? selectedRoleId ?? "";
  let tooltip = t("agentControls.role.title");
  if (isBlocked) tooltip = t("agentControls.role.unsupportedProvider");
  else if (selectedRoleId) tooltip = t("agentControls.role.selectedTooltip", { name: roleName });

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop={!open} enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerWrapper}>
            <ComboboxTrigger
              ref={anchorRef}
              collapsable={false}
              chevron={null}
              testID="draft-role-trigger"
              disabled={disabled}
              onPress={handlePress}
              style={triggerStyle}
              accessibilityRole="button"
              accessibilityLabel={tooltip}
            >
              <ComposerToolbarGlyph role={glyphRole}>
                <DraftRoleGlyph
                  size={glyphs[glyphRole].size}
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
            </ComboboxTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        anchorRef={anchorRef}
        open={open}
        onOpenChange={setOpen}
        options={options}
        value={selectedRoleId ?? NO_ROLE_OPTION_ID}
        onSelect={handleSelect}
        renderOption={renderOption}
        searchable={options.length > SEARCH_THRESHOLD}
        title={t("agentControls.role.title")}
        desktopPlacement="top-start"
        desktopMinWidth={420}
        stickyHeader={stickyHeader}
        footer={footer}
      />
    </>
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
  optionTrailing: {
    maxWidth: 120,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  blockedHint: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
