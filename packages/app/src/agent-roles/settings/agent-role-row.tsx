import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentRole } from "@getpaseo/protocol/messages";
import { AgentProfileGlyph } from "@/agent-profiles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const removeIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />;

export interface AgentRoleRowProps {
  role: AgentRole;
  /** The default profile's name; empty when the role has none or it was removed. */
  defaultProfileName: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export function AgentRoleRow({
  role,
  defaultProfileName,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: AgentRoleRowProps): ReactElement {
  const { t } = useTranslation();

  const handleEdit = useCallback(() => onEdit(role.id), [onEdit, role.id]);
  const handleRemove = useCallback(() => onRemove(role.id), [onRemove, role.id]);
  const handleMoveUp = useCallback(() => onMoveUp(role.id), [onMoveUp, role.id]);
  const handleMoveDown = useCallback(() => onMoveDown(role.id), [onMoveDown, role.id]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`agent-role-row-${role.id}`}>
      <View style={styles.rowMain}>
        <View style={styles.iconWrapper}>
          <AgentProfileGlyph icon={role.icon} color={role.color} size={ICON_SIZE.md} />
        </View>
        <View style={settingsStyles.rowContent}>
          <View style={styles.titleLine}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {role.name}
            </Text>
            {defaultProfileName ? (
              <Text style={styles.summary} numberOfLines={1}>
                {defaultProfileName}
              </Text>
            ) : null}
          </View>
          {role.description ? (
            <Text style={styles.description} numberOfLines={2}>
              {role.description}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.host.agentRoles.moveUp")}
          testID={`agent-role-move-up-${role.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.host.agentRoles.moveDown")}
          testID={`agent-role-move-down-${role.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.host.agentRoles.editRole")}
          testID={`agent-role-edit-${role.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeIcon}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.agentRoles.remove")}
          testID={`agent-role-remove-${role.id}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
    minHeight: 56,
    alignItems: "center",
    paddingVertical: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconWrapper: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  summary: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  description: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
  },
}));
