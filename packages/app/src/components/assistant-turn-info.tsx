import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Copy, Info } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import type { AgentTurnInfo } from "@getpaseo/protocol/agent-types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { getTurnDurationLabel } from "./assistant-turn-footer-label";

const ThemedInfo = withUnistyles(Info);
const ThemedCopy = withUnistyles(Copy);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface AssistantTurnInfoProps {
  info?: AgentTurnInfo;
  completedAt?: Date;
  durationMs?: number | null;
}

/** Never consults the agent's current settings: this surface belongs to a historical turn. */
export const AssistantTurnInfo = memo(function AssistantTurnInfo({
  info,
  completedAt,
  durationMs,
}: AssistantTurnInfoProps) {
  const { t, i18n } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyIcon = useMemo(() => <ThemedCopy size={ICON_SIZE.sm} uniProps={mutedColor} />, []);
  const missing = t("message.turnInfo.notRecorded");
  const formatTimestamp = (value: Date | string | undefined) => {
    if (value === undefined) return missing;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return missing;
    return date.toLocaleString(i18n.resolvedLanguage);
  };
  let fastMode = missing;
  if (info?.fastModeRequested === true) fastMode = t("message.turnInfo.requested");
  if (info?.fastModeRequested === false) fastMode = t("message.turnInfo.notRequested");
  const rows = [
    { label: t("message.turnInfo.provider"), value: info?.provider ?? missing },
    { label: t("message.turnInfo.model"), value: info?.model ?? missing },
    {
      label: t("message.turnInfo.thinking"),
      value:
        info?.thinkingOptionId === null
          ? t("message.turnInfo.default")
          : (info?.thinkingOptionId ?? missing),
    },
    { label: t("message.turnInfo.fast"), value: fastMode },
    { label: t("message.turnInfo.startedAt"), value: formatTimestamp(info?.startedAt) },
    { label: t("message.turnInfo.completedAt"), value: formatTimestamp(completedAt) },
    {
      label: t("message.turnInfo.duration"),
      value: durationMs == null ? missing : getTurnDurationLabel(durationMs, t),
    },
  ];
  const note = t("message.turnInfo.note");
  const copyText = [
    t("message.turnInfo.title"),
    ...rows.map((row) => `${row.label}: ${row.value}`),
    note,
  ].join("\n");
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setCopyState("idle");
  }, []);
  const handleCopy = useCallback(async () => {
    try {
      const copied = await Clipboard.setStringAsync(copyText);
      setCopyState(copied ? "copied" : "failed");
    } catch {
      setCopyState("failed");
    }
  }, [copyText]);

  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={handleOpenChange}>
      <ToolbarButton
        kind="menu"
        label={t("message.turnInfo.title")}
        tooltipSide="top"
        selected={open}
        testID="assistant-turn-info-trigger"
      >
        <ThemedInfo size={ICON_SIZE.sm} uniProps={mutedColor} />
      </ToolbarButton>
      <DropdownMenuContent
        align="start"
        side="top"
        minWidth={340}
        maxWidth={400}
        maxHeight={480}
        scrollable
        sheetTitle={t("message.turnInfo.title")}
        testID="assistant-turn-info-content"
      >
        <View style={styles.content}>
          {!isCompact ? <Text style={styles.title}>{t("message.turnInfo.title")}</Text> : null}
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text selectable style={styles.value}>
                {row.value}
              </Text>
            </View>
          ))}
          <Text style={styles.note}>{note}</Text>
          {copyState === "failed" ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t("message.turnInfo.copyFailed")}
            </Text>
          ) : null}
        </View>
        <DropdownMenuItem
          closeOnSelect={false}
          leading={copyIcon}
          onSelect={handleCopy}
          testID="assistant-turn-info-copy"
        >
          {copyState === "copied" ? t("message.actions.copied") : t("message.turnInfo.copy")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[3], gap: theme.spacing[3] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  value: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
