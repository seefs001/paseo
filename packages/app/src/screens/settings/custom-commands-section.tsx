import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CustomCommandFormSheet } from "@/custom-commands/form-sheet";
import type { CustomCommand } from "@/custom-commands/model";
import { useAppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";

interface CustomCommandEditor {
  command: CustomCommand | null;
}

export function CustomCommandsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings, isLoading, error, updateSettings } = useAppSettings();
  const [editor, setEditor] = useState<CustomCommandEditor | null>(null);
  const deletion = useMutation({
    mutationFn: async (command: CustomCommand) => {
      const confirmed = await confirmDialog({
        title: t("settings.customCommands.deleteTitle"),
        message: t("settings.customCommands.deleteMessage", { name: command.name }),
        confirmLabel: t("settings.customCommands.delete"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      await updateSettings((current) => ({
        customCommands: current.customCommands.filter((candidate) => candidate.id !== command.id),
      }));
    },
  });

  const openCreate = useCallback(() => setEditor({ command: null }), []);
  const openEdit = useCallback((command: CustomCommand) => setEditor({ command }), []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const retryLoad = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
  }, [queryClient]);
  const addButton = useMemo(
    () => (
      <Button
        variant="outline"
        size="sm"
        onPress={openCreate}
        disabled={deletion.isPending}
        testID="custom-command-add"
      >
        {t("settings.customCommands.add")}
      </Button>
    ),
    [openCreate, deletion.isPending, t],
  );

  if (isLoading) return <Text style={settingsStyles.rowHint}>{t("settings.loading")}</Text>;
  if (error) {
    return (
      <Alert variant="error" title={t("settings.customCommands.loadFailed")}>
        <Button variant="outline" size="sm" onPress={retryLoad}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.sections.customCommands")}
        testID="custom-commands-section"
        trailing={addButton}
      >
        {deletion.isError ? (
          <Alert
            variant="error"
            title={t("settings.customCommands.deleteFailed")}
            description={t("settings.customCommands.retryDelete")}
            testID="custom-command-delete-error"
          >
            <Button variant="outline" size="sm" onPress={deletion.reset}>
              {t("common.actions.dismiss")}
            </Button>
          </Alert>
        ) : null}
        <SettingsCard>
          {settings.customCommands.length === 0 ? (
            <SettingsRow
              label={t("settings.customCommands.empty")}
              testID="custom-commands-empty"
            />
          ) : (
            settings.customCommands.map((command) => (
              <CustomCommandRow
                key={command.id}
                command={command}
                disabled={deletion.isPending}
                deleting={deletion.isPending && deletion.variables.id === command.id}
                onEdit={openEdit}
                onDelete={deletion.mutate}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>
      {editor ? (
        <CustomCommandFormSheet
          key={editor.command?.id ?? "create"}
          command={editor.command}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}

interface CustomCommandRowProps {
  command: CustomCommand;
  disabled: boolean;
  deleting: boolean;
  onEdit(command: CustomCommand): void;
  onDelete(command: CustomCommand): void;
}

function CustomCommandRow({
  command,
  disabled,
  deleting,
  onEdit,
  onDelete,
}: CustomCommandRowProps) {
  const { t } = useTranslation();
  const editCommand = useCallback(() => onEdit(command), [command, onEdit]);
  const deleteCommand = useCallback(() => onDelete(command), [command, onDelete]);
  const deleteLabel = deleting
    ? t("settings.customCommands.deleting")
    : t("settings.customCommands.delete");
  return (
    <SettingsRow
      label={`/${command.name}`}
      hint={command.description}
      testID={`custom-command-${command.id}`}
    >
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={editCommand}
          disabled={disabled}
          testID={`custom-command-edit-${command.id}`}
        >
          {t("settings.customCommands.edit")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onPress={deleteCommand}
          disabled={disabled}
          testID={`custom-command-delete-${command.id}`}
        >
          {deleteLabel}
        </Button>
      </View>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
