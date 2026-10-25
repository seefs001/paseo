import { useCallback, useMemo, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import { upsertCustomCommand, type CustomCommand } from "./model";
import { useCustomCommandFormModel } from "./use-form-model";

interface CustomCommandFormSheetProps {
  command: CustomCommand | null;
  onClose(): void;
}

export function CustomCommandFormSheet({ command, onClose }: CustomCommandFormSheetProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  const { settings, updateSettings } = useAppSettings();
  const model = useCustomCommandFormModel({
    command,
    commands: settings.customCommands,
    createId: () => crypto.randomUUID(),
    save: (saved) =>
      updateSettings((current) => ({
        customCommands: upsertCustomCommand({ command: saved, commands: current.customCommands }),
      })),
  });
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const saving = state.submission.status === "saving";
  const title = command ? t("settings.customCommands.edit") : t("settings.customCommands.add");
  const saveLabel = saving ? t("settings.customCommands.saving") : t("common.actions.save");
  const nameError = state.errors.name
    ? t(`settings.customCommands.errors.${state.errors.name}`)
    : null;
  const promptError = state.errors.prompt
    ? t(`settings.customCommands.errors.${state.errors.prompt}`)
    : null;

  const save = useCallback(async () => {
    if (await model.submit()) onClose();
  }, [model, onClose]);
  const header = useMemo(() => ({ title }), [title]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size={size}
          onPress={onClose}
          disabled={saving}
          testID="custom-command-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size={size}
          onPress={save}
          disabled={!state.canSubmit}
          testID="custom-command-save"
        >
          {saveLabel}
        </Button>
      </View>
    ),
    [size, onClose, saving, t, save, state.canSubmit, saveLabel],
  );
  const autoSendSwitch = useMemo(
    () => (
      <Switch
        value={state.command.autoSend}
        onValueChange={model.setAutoSend}
        disabled={saving}
        accessibilityLabel={t("settings.customCommands.autoSend")}
        testID="custom-command-auto-send"
      />
    ),
    [state.command.autoSend, model, saving, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      dismissible={!saving}
      header={header}
      snapPoints={SNAP_POINTS}
      contentStyle={styles.fields}
      testID="custom-command-form"
      footer={footer}
    >
      <Field
        label={t("settings.customCommands.name")}
        error={nameError}
        testID="custom-command-name-field"
      >
        <FormTextInput
          initialValue={state.command.name}
          onChangeText={model.setName}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!saving}
          size={size}
          accessibilityLabel={t("settings.customCommands.name")}
          testID="custom-command-name"
        />
      </Field>
      <Field label={t("settings.customCommands.description")}>
        <FormTextInput
          initialValue={state.command.description}
          onChangeText={model.setDescription}
          editable={!saving}
          size={size}
          accessibilityLabel={t("settings.customCommands.description")}
          testID="custom-command-description"
        />
      </Field>
      <Field
        label={t("settings.customCommands.prompt")}
        error={promptError}
        testID="custom-command-prompt-field"
      >
        <FormTextInput
          initialValue={state.command.prompt}
          onChangeText={model.setPrompt}
          multiline
          editable={!saving}
          size={size}
          style={styles.prompt}
          accessibilityLabel={t("settings.customCommands.prompt")}
          testID="custom-command-prompt"
        />
      </Field>
      <Field label={t("settings.customCommands.autoSend")} trailing={autoSendSwitch}>
        {null}
      </Field>
      {state.submission.status === "error" ? (
        <Alert
          variant="error"
          title={t("settings.customCommands.saveFailed")}
          description={t("settings.customCommands.retrySave")}
          testID="custom-command-save-error"
        />
      ) : null}
    </AdaptiveModalSheet>
  );
}

const SNAP_POINTS = ["90%"];

const styles = StyleSheet.create((theme) => ({
  fields: { gap: theme.spacing[4] },
  prompt: { minHeight: 144, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
