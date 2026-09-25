import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { CheckSquare, Square } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppSettings } from "@/hooks/use-settings";
import { openRenameForm, canEditRenameRow, type RenameForm, type RenameRow } from "./rename-model";

const CheckedIcon = withUnistyles(CheckSquare);
const UncheckedIcon = withUnistyles(Square);

function TitleRow({ row, model, busy }: { row: RenameRow; model: RenameForm; busy: boolean }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const toggle = useCallback(() => model.toggle(row.agentId), [model, row.agentId]);
  const edit = useCallback(
    (title: string) => model.editTitle(row.agentId, title),
    [model, row.agentId],
  );
  const disabled = busy || !canEditRenameRow(row);
  const accessibilityState = useMemo(
    () => ({ checked: row.selected, disabled }),
    [row.selected, disabled],
  );
  return (
    <View style={styles.row} testID={`session-rename-row-${row.agentId}`}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={row.previousTitle || t("sessionPicker.untitled")}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={toggle}
        style={styles.rowHeader}
      >
        {row.selected ? (
          <CheckedIcon size={18} uniProps={extraMutedIconColorMapping} />
        ) : (
          <UncheckedIcon size={18} uniProps={extraMutedIconColorMapping} />
        )}
        <Text style={styles.previousTitle} numberOfLines={2}>
          {row.previousTitle || t("sessionPicker.untitled")}
        </Text>
      </Pressable>
      <FormTextInput
        initialValue={row.title}
        onChangeText={edit}
        editable={!disabled}
        maxLength={200}
        size={compact ? "md" : "sm"}
        accessibilityLabel={t("sessionPicker.suggestedTitle")}
        testID={`session-rename-title-${row.agentId}`}
      />
      {row.outcome ? (
        <Text style={styles.outcome}>{t(`sessionPicker.results.${row.outcome}`)}</Text>
      ) : null}
    </View>
  );
}

export function SessionRenameSheet({
  serverId,
  workspaceId,
  agentIds,
  onClose,
}: {
  serverId: string;
  workspaceId: string;
  agentIds: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const compact = useIsCompactFormFactor();
  const { settings, updateSettings } = useAppSettings();
  const [model] = useState(() =>
    openRenameForm({
      prompt: settings.sessionTitlePrompt || t("sessionPicker.defaultPrompt"),
      savePrompt: (prompt) => updateSettings({ sessionTitlePrompt: prompt }),
      preview: async (prompt) => {
        if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
        return client.previewSessionTitles(workspaceId, agentIds, prompt);
      },
      apply: async (proposals) => {
        if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
        return client.applySessionTitles(workspaceId, proposals);
      },
      invalidPrompt: t("sessionPicker.invalidPrompt"),
      invalidTitle: t("sessionPicker.invalidTitle"),
      failed: t("sessionPicker.failed"),
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const close = useCallback(() => {
    if (model.close()) onClose();
  }, [model, onClose]);
  const generate = useCallback(() => {
    void model.generate();
  }, [model]);
  const apply = useCallback(() => {
    void model.apply();
  }, [model]);
  const header = useMemo<SheetHeader>(() => ({ title: t("sessionPicker.rename") }), [t]);
  const preview = state.phase === "preview" || state.phase === "applying";
  const generating = state.phase === "generating";
  const applying = state.phase === "applying";
  const busy = generating || applying;
  const selected = preview
    ? state.rows.filter((row) => row.selected && row.outcome !== "applied").length
    : 0;
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={close} disabled={applying}>
          {t("common.actions.close")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={generate}
          disabled={busy || !connected}
          loading={generating}
          testID="session-rename-generate"
        >
          {t("sessionPicker.generate")}
        </Button>
        <Button
          size="sm"
          onPress={apply}
          disabled={busy || !connected || selected === 0}
          loading={applying}
          testID="session-rename-apply"
        >
          {t("sessionPicker.apply", { count: selected })}
        </Button>
      </View>
    ),
    [close, applying, generate, busy, connected, generating, apply, selected, t],
  );
  if (state.phase === "closed") return null;
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      footer={footer}
      desktopMaxWidth={640}
      testID="session-rename-sheet"
    >
      <View style={styles.content}>
        <Field label={t("sessionPicker.prompt")}>
          <FormTextInput
            initialValue={state.prompt}
            onChangeText={model.setPrompt}
            editable={!busy}
            multiline
            maxLength={4000}
            size={compact ? "md" : "sm"}
            style={styles.prompt}
            testID="session-rename-prompt"
            accessibilityLabel={t("sessionPicker.prompt")}
          />
        </Field>
        {state.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {state.error}
          </Text>
        ) : null}
        {preview
          ? state.rows.map((row) => (
              <TitleRow key={row.agentId} row={row} model={model} busy={busy} />
            ))
          : null}
        {preview && state.skipped.length > 0 ? (
          <Text style={styles.outcome}>
            {t("sessionPicker.skipped", { count: state.skipped.length })}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[4] },
  prompt: { minHeight: 92 },
  row: { gap: theme.spacing[2] },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 44,
  },
  previousTitle: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  outcome: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.palette.red[300], fontSize: theme.fontSize.sm },
  actions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
