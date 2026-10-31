import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { formatNmemOutput, type NmemCall } from "./model";

interface NmemDetailsProps {
  call: NmemCall;
  detail: Extract<ToolCallDetail, { type: "shell" }>;
  metadata?: Record<string, unknown>;
  errorText?: string;
  running: boolean;
  visible: boolean;
  onClose: () => void;
  onOpenFilePath?: (path: string) => void;
}

export function NmemDetails({
  call,
  detail,
  metadata,
  errorText,
  running,
  visible,
  onClose,
  onOpenFilePath,
}: NmemDetailsProps) {
  const { t } = useTranslation();
  const active = useRetainedPanelActive();
  const header = useMemo(() => ({ title: "nmem" }), []);
  const output = useMemo(() => {
    if (detail.output === undefined) return undefined;
    return formatNmemOutput(detail.output);
  }, [detail.output]);
  const sharedOutput =
    typeof metadata?.codemodeOutput === "string" ? metadata.codemodeOutput : null;
  const fullOutputPath =
    typeof metadata?.codemodeFullOutputPath === "string" ? metadata.codemodeFullOutputPath : null;
  const missingOutput = output === undefined;
  const emptyLabel = running ? t("nmem.pending") : t("nmem.unavailable");
  const showSharedOutput = missingOutput && sharedOutput !== null;

  const openFullOutput = useCallback(() => {
    if (!fullOutputPath || !onOpenFilePath) return;
    onClose();
    onOpenFilePath(fullOutputPath);
  }, [fullOutputPath, onClose, onOpenFilePath]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible && active}
      onClose={onClose}
      desktopMaxWidth={800}
      testID="nmem-details"
      contentStyle={styles.content}
      contextBridge={null}
    >
      <View style={styles.section}>
        <Text style={styles.heading}>{t("nmem.command")}</Text>
        <Text selectable style={styles.code}>
          {call.command}
        </Text>
      </View>
      {errorText ? (
        <View style={styles.section}>
          <Text style={styles.heading}>{t("toolCallDetails.error")}</Text>
          <Text selectable style={styles.error}>
            {errorText}
          </Text>
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.heading}>{t("nmem.returnedData")}</Text>
        {missingOutput ? (
          <Text style={styles.hint}>{emptyLabel}</Text>
        ) : (
          <Text selectable style={styles.code}>
            {output || t("nmem.empty")}
          </Text>
        )}
      </View>
      {showSharedOutput ? (
        <View style={styles.section}>
          <Text style={styles.heading}>{t("nmem.sharedOutput")}</Text>
          <Text style={styles.hint}>{t("nmem.sharedOutputHint")}</Text>
          <Text selectable style={styles.code}>
            {sharedOutput}
          </Text>
        </View>
      ) : null}
      {missingOutput && fullOutputPath && onOpenFilePath ? (
        <Button variant="outline" size="sm" onPress={openFullOutput}>
          {t("nmem.openFullOutput")}
        </Button>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[6],
    paddingVertical: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  heading: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  code: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
}));
