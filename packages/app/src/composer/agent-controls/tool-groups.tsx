import { useCallback, useState, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Blocks } from "lucide-react-native";
import {
  PI_SCOPEWEAVER_TOOL_PATTERN,
  formatPiDisabledTools,
  isPiToolDisabled,
  piEnabledToolGroupLabels,
  togglePiToolGroup,
} from "@getpaseo/protocol/pi-disabled-tools";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";

const PI_TOOL_GROUPS = [
  {
    id: "scopeweaver",
    label: "ScopeWeaver",
    pattern: PI_SCOPEWEAVER_TOOL_PATTERN,
    descriptionKey: "agentControls.tools.scopeweaverDescription",
  },
] as const;

type PiToolGroup = (typeof PI_TOOL_GROUPS)[number];

function ToolGroupMenuItem({
  group,
  enabled,
  disabled,
  onToggle,
}: {
  group: PiToolGroup;
  enabled: boolean;
  disabled: boolean;
  onToggle: (pattern: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const onSelect = useCallback(() => onToggle(group.pattern), [group.pattern, onToggle]);
  return (
    <DropdownMenuItem
      description={t(group.descriptionKey)}
      selected={enabled}
      showSelectedCheck
      closeOnSelect={false}
      disabled={disabled}
      onSelect={onSelect}
      testID={`agent-tool-group-${group.id}`}
    >
      {group.label}
    </DropdownMenuItem>
  );
}

export function usePiToolGroups(
  enabled: boolean,
  provider: string | undefined,
  patterns: readonly string[] | undefined,
  disabled: boolean,
  onChange: (serialized: string) => void,
): (surface: "toolbar" | "sheet") => ReactElement | null {
  return useCallback(
    (surface) => {
      if (!enabled || provider !== "pi" || patterns === undefined) return null;
      return (
        <PiToolGroupsControl
          surface={surface}
          patterns={patterns}
          disabled={disabled}
          onChange={onChange}
        />
      );
    },
    [disabled, enabled, onChange, patterns, provider],
  );
}

export function PiToolGroupsControl({
  surface,
  patterns,
  disabled = false,
  onChange,
}: {
  surface: "toolbar" | "sheet";
  patterns: readonly string[];
  disabled?: boolean;
  onChange: (serialized: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  const [open, setOpen] = useState(false);
  const isSheet = surface === "sheet";
  const exceptionLabel = piEnabledToolGroupLabels(patterns, PI_TOOL_GROUPS).join(", ");
  const showException = exceptionLabel.length > 0;
  const iconColor = showException ? styles.activeIcon.color : styles.idleIcon.color;
  const accessibilityLabel = showException
    ? t("agentControls.tools.openWithValue", { value: exceptionLabel })
    : t("agentControls.tools.open");

  const triggerStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      isSheet ? styles.sheetRow : styles.toolbar,
      !isSheet && !showException && styles.toolbarIconOnly,
      (hovered || pressed || open) && styles.pressed,
      disabled && styles.disabled,
    ],
    [disabled, isSheet, open, showException],
  );

  const toggleGroup = useCallback(
    (pattern: string) => {
      const enabled = !isPiToolDisabled(pattern, patterns);
      onChange(formatPiDisabledTools(togglePiToolGroup(patterns, pattern, !enabled)));
    },
    [onChange, patterns],
  );

  const rows = PI_TOOL_GROUPS.map((group) => (
    <ToolGroupMenuItem
      key={group.id}
      group={group}
      enabled={!isPiToolDisabled(group.pattern, patterns)}
      disabled={disabled}
      onToggle={toggleGroup}
    />
  ));

  const trigger = (
    <DropdownMenuTrigger
      disabled={disabled}
      style={triggerStyle}
      accessibilityLabel={accessibilityLabel}
      testID="agent-tool-groups-trigger"
    >
      {isSheet ? (
        <View style={styles.sheetGlyph}>
          <Blocks size={16} color={iconColor} />
        </View>
      ) : (
        <ComposerToolbarGlyph size={glyphSize}>
          <Blocks size={glyphSize} color={iconColor} />
        </ComposerToolbarGlyph>
      )}
      {isSheet ? <Text style={styles.sheetLabel}>{t("agentControls.tools.title")}</Text> : null}
      {showException ? (
        <Text style={isSheet ? styles.sheetValue : styles.toolbarValue} numberOfLines={1}>
          {exceptionLabel}
        </Text>
      ) : null}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} compactMode="sheet">
      {isSheet ? (
        trigger
      ) : (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <View>{trigger}</View>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{accessibilityLabel}</Text>
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        width={280}
        sheetTitle={t("agentControls.tools.title")}
        testID="agent-tool-groups-menu"
      >
        {rows}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    minWidth: 0,
    height: 28,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  toolbarIconOnly: {
    width: 28,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.palette.blue[400],
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetRow: {
    minHeight: 44,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface1,
  },
  sheetGlyph: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.palette.blue[400],
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  idleIcon: {
    color: theme.colors.foregroundMuted,
  },
  activeIcon: {
    color: theme.colors.palette.blue[400],
  },
  pressed: {
    backgroundColor: theme.colors.surface2,
  },
  disabled: {
    opacity: 0.5,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
