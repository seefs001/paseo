import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentProfile, AgentRole } from "@getpaseo/protocol/messages";
import { useAgentProfiles } from "@/agent-profiles";
import { Button } from "@/components/ui/button";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { useAgentRoles } from "../internal/use-agent-roles";
import { generateAgentRoleId } from "../internal/role-id";
import type { AgentRoleValue } from "../internal/role-form-model";
import { AgentRoleEditModal } from "./agent-role-edit-modal";
import { AgentRoleRow } from "./agent-role-row";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const NO_PROFILES: readonly AgentProfile[] = [];

interface EditTarget {
  mode: "create" | "edit";
  role?: AgentRole;
}

function showSaveError(title: string, error: unknown): void {
  Alert.alert(title, toErrorMessage(error));
}

export function AgentRolesSection({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { roles, isSupported, isDefault, saveRoles, restoreDefaultRoles } = useAgentRoles(serverId);
  const { profiles } = useAgentProfiles(serverId);
  const availableProfiles = profiles ?? NO_PROFILES;
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const profileNames = useMemo(
    () => new Map(availableProfiles.map((profile) => [profile.id, profile.name])),
    [availableProfiles],
  );

  const handleAddOpen = useCallback(() => setEditTarget({ mode: "create" }), []);
  const handleEditClose = useCallback(() => setEditTarget(null), []);

  const handleEditOpen = useCallback(
    (id: string) => {
      const role = roles?.find((entry) => entry.id === id);
      if (role) setEditTarget({ mode: "edit", role });
    },
    [roles],
  );

  const handleSave = useCallback(
    async (value: AgentRoleValue) => {
      const current = roles ?? [];
      const editing = editTarget?.mode === "edit" ? editTarget.role : undefined;
      // Replaced, not merged: `value` omits cleared fields, so spreading it over
      // the stored record would keep the old description or default profile.
      const next: AgentRole[] = editing
        ? current.map((entry) => (entry.id === editing.id ? { id: entry.id, ...value } : entry))
        : [...current, { id: generateAgentRoleId(), ...value }];
      await saveRoles(next);
    },
    [editTarget, roles, saveRoles],
  );

  const reorder = useCallback(
    async (id: string, offset: -1 | 1) => {
      if (!roles) return;
      const index = roles.findIndex((entry) => entry.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= roles.length) return;
      const next = [...roles];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      try {
        await saveRoles(next);
      } catch (error) {
        showSaveError(t("common.errors.unableToSave"), error);
      }
    },
    [roles, saveRoles, t],
  );

  const handleMoveUp = useCallback((id: string) => void reorder(id, -1), [reorder]);
  const handleMoveDown = useCallback((id: string) => void reorder(id, 1), [reorder]);

  const handleRemove = useCallback(
    (id: string) => {
      const role = roles?.find((entry) => entry.id === id);
      if (!role) return;
      void confirmDialog({
        title: t("settings.host.agentRoles.removeConfirmTitle"),
        message: t("settings.host.agentRoles.removeConfirmMessage", { name: role.name }),
        confirmLabel: t("settings.host.agentRoles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !roles) return;
        try {
          await saveRoles(roles.filter((entry) => entry.id !== id));
        } catch (error) {
          showSaveError(t("common.errors.unableToSave"), error);
        }
        return;
      });
    },
    [roles, saveRoles, t],
  );

  const handleRestoreDefaults = useCallback(() => {
    void confirmDialog({
      title: t("settings.host.agentRoles.restoreConfirmTitle"),
      message: t("settings.host.agentRoles.restoreConfirmMessage"),
      confirmLabel: t("settings.host.agentRoles.restoreDefaults"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      try {
        await restoreDefaultRoles();
      } catch (error) {
        showSaveError(t("common.errors.unableToSave"), error);
      }
      return;
    });
  }, [restoreDefaultRoles, t]);

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addIcon}
        onPress={handleAddOpen}
        disabled={!roles}
        accessibilityLabel={t("settings.host.agentRoles.addRoleTitle")}
        testID="agent-roles-add-button"
      />
    ),
    [handleAddOpen, roles, t],
  );

  if (!isConnected || !isSupported) {
    return (
      <SettingsSection
        title={t("settings.host.agentRoles.sectionTitle")}
        testID="agent-roles-section"
      >
        <View style={settingsStyles.card} testID="agent-roles-unavailable">
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {isConnected
                ? t("settings.host.agentRoles.unsupported")
                : t("settings.host.agentRoles.unavailable")}
            </Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.agentRoles.sectionTitle")}
        trailing={addButton}
        testID="agent-roles-section"
      >
        <View style={settingsStyles.card} testID="agent-roles-card">
          {roles && roles.length > 0 ? (
            roles.map((role, index) => (
              <AgentRoleRow
                key={role.id}
                role={role}
                defaultProfileName={
                  role.defaultProfileId ? (profileNames.get(role.defaultProfileId) ?? "") : ""
                }
                isFirst={index === 0}
                isLast={index === roles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText} testID="agent-roles-empty">
                {t("settings.host.agentRoles.emptyState")}
              </Text>
              <Button size="sm" leftIcon={addIcon} onPress={handleAddOpen} disabled={!roles}>
                {t("settings.host.agentRoles.newRole")}
              </Button>
            </View>
          )}
        </View>
        {roles && !isDefault ? (
          <View style={styles.footer}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleRestoreDefaults}
              testID="agent-roles-restore-defaults"
            >
              {t("settings.host.agentRoles.restoreDefaults")}
            </Button>
          </View>
        ) : null}
      </SettingsSection>

      <AgentRoleEditModal
        visible={editTarget !== null}
        mode={editTarget?.mode ?? "create"}
        {...(editTarget?.role ? { role: editTarget.role } : {})}
        profiles={availableProfiles}
        onClose={handleEditClose}
        onSave={handleSave}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: theme.spacing[2],
  },
}));
