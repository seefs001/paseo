import { useCallback } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { AgentInputDraftSubmission } from "./input-draft";
import type { DraftInput } from "@/stores/draft-store";

function FailedSubmission({
  id,
  input,
  draft,
  disabled,
  onRestored,
}: {
  id: string;
  input: DraftInput;
  draft: AgentInputDraftSubmission;
  disabled: boolean;
  onRestored: () => void;
}) {
  const { t } = useTranslation();
  const handleRestore = useCallback(() => {
    if (draft.restore(id)) onRestored();
  }, [draft, id, onRestored]);
  return (
    <View style={styles.row}>
      <Text numberOfLines={2} style={styles.preview}>
        {input.text || t("composer.failedSubmission.saved")}
      </Text>
      <Button variant="outline" size="sm" disabled={disabled} onPress={handleRestore}>
        {t("composer.failedSubmission.restore")}
      </Button>
    </View>
  );
}

export function FailedSubmissions({
  draft,
  disabled,
  onRestored,
}: {
  draft: AgentInputDraftSubmission;
  disabled: boolean;
  onRestored: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        {t(disabled ? "composer.failedSubmission.waitForEmpty" : "composer.failedSubmission.saved")}
      </Text>
      {Object.entries(draft.failures ?? {}).map(([id, input]) => (
        <FailedSubmission
          key={id}
          id={id}
          input={input}
          draft={draft}
          disabled={disabled}
          onRestored={onRestored}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[2] },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  preview: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
}));
