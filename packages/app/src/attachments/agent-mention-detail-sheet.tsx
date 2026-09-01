import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { settingsStyles } from "@/styles/settings";
import type { AgentMentionDetail } from "./agent-mention-detail";

interface AgentMentionDetailSheetProps {
  detail: AgentMentionDetail | null;
  onClose: () => void;
}

export function AgentMentionDetailSheet({ detail, onClose }: AgentMentionDetailSheetProps) {
  const header = useMemo<SheetHeader>(() => ({ title: detail?.title ?? "" }), [detail]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={detail !== null}
      onClose={onClose}
      snapPoints={["45%", "80%"]}
      testID="agent-mention-detail-sheet"
    >
      {detail ? (
        <View style={settingsStyles.card} testID="agent-mention-detail-card">
          {detail.rows.map((row, index) => (
            <View
              key={row.key}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
              testID={`agent-mention-detail-row-${row.key}`}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={styles.fieldLabel}>{row.label}</Text>
                <Text style={styles.fieldValue} selectable>
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  fieldValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[1],
  },
}));
