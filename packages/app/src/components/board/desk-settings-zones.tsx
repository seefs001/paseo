import type { BoardDeskSettings } from "@getpaseo/protocol/messages";
import { GripVertical } from "lucide-react-native";
import { useCallback, type ReactElement, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { ControlSize } from "@/components/ui/control-geometry";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { isWeb } from "@/constants/platform";

export type DeskZone = BoardDeskSettings["zones"][number];

const ThemedGrip = withUnistyles(GripVertical, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
}));

function zoneKey(zone: DeskZone): string {
  return zone.id;
}

/** Zone order, visibility and names. Drag the handle to reorder. */
export function DeskSettingsZones({
  zones,
  onChange,
  size,
}: {
  zones: DeskZone[];
  onChange: (zones: DeskZone[]) => void;
  size: ControlSize;
}): ReactElement {
  const changeZone = useCallback(
    (next: DeskZone) => onChange(zones.map((zone) => (zone.id === next.id ? next : zone))),
    [onChange, zones],
  );
  const renderItem = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<DeskZone>) => (
      <DeskZoneRow
        zone={item}
        drag={drag}
        isActive={isActive}
        dragHandleProps={dragHandleProps}
        onChange={changeZone}
        size={size}
      />
    ),
    [changeZone, size],
  );
  return (
    <DraggableList
      data={zones}
      keyExtractor={zoneKey}
      renderItem={renderItem}
      onDragEnd={onChange}
      scrollEnabled={false}
      useDragHandle
      contentContainerStyle={styles.list}
      testID="desk-settings-zones"
    />
  );
}

function DeskZoneRow({
  zone,
  drag,
  isActive,
  dragHandleProps,
  onChange,
  size,
}: {
  zone: DeskZone;
  drag: () => void;
  isActive: boolean;
  dragHandleProps: DraggableRenderItemInfo<DeskZone>["dragHandleProps"];
  onChange: (zone: DeskZone) => void;
  size: ControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const label = t(`board.plan2.zones.${zone.id}`);
  const changeVisible = useCallback(
    (visible: boolean) => onChange({ ...zone, visible }),
    [onChange, zone],
  );
  const changeName = useCallback(
    (name: string) => onChange({ ...zone, name: name.trim() ? name : null }),
    [onChange, zone],
  );
  return (
    <View
      style={[styles.row, isActive && styles.rowActive]}
      testID={`desk-settings-zone-${zone.id}`}
    >
      {isWeb ? (
        <View
          {...dragHandleProps?.listeners}
          ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
          style={styles.handle}
          accessibilityLabel={t("board.plan2.settings.reorderZone", { zone: label })}
        >
          <ThemedGrip />
        </View>
      ) : (
        <Button
          variant="ghost"
          size={size}
          leftIcon={GripVertical}
          onPressIn={drag}
          accessibilityLabel={t("board.plan2.settings.reorderZone", { zone: label })}
        />
      )}
      <Switch
        value={zone.visible}
        onValueChange={changeVisible}
        accessibilityLabel={t("board.plan2.settings.showZone", { zone: label })}
        testID={`desk-settings-zone-visible-${zone.id}`}
      />
      <View style={styles.name}>
        <FormTextInput
          size={size}
          initialValue={zone.name ?? ""}
          onChangeText={changeName}
          placeholder={label}
          accessibilityLabel={t("board.plan2.settings.zoneName", { zone: label })}
          maxLength={40}
          testID={`desk-settings-zone-name-${zone.id}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  handle: {
    paddingHorizontal: theme.spacing[1],
  },
  name: {
    flex: 1,
  },
}));
