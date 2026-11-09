import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { useFormModel } from "../internal/use-form-model";
import {
  openSshRoutingForm,
  type SshFormError,
  type SshRoutingBaseline,
  type SshRoutingField,
  type SshRoutingValues,
} from "../internal/ssh-form-models";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function fieldError(errors: readonly SshFormError[], field: string | null, t: Translate) {
  const error = errors.find((entry) => entry.field === field);
  if (!error) return null;
  return error.messageKey ? t(error.messageKey) : (error.message ?? null);
}

// The daemon reports stale revisions with this wording; the form then offers a reload.
function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && /changed since it was loaded/.test(error.message);
}

// Edits a machine's default routing or one workspace's override. In workspace scope each
// setting either inherits the machine default or overrides it.
export function SshRoutingEditor({
  baseline,
  save,
  load,
  readOnly = false,
}: {
  baseline: SshRoutingBaseline;
  save: (values: SshRoutingValues & { expectedRevision: number }) => Promise<SshRoutingBaseline>;
  // Reads the daemon's current routing again.
  load: () => Promise<SshRoutingBaseline | null>;
  readOnly?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { model, state } = useFormModel(() =>
    openSshRoutingForm({ baseline, save, isConflict: isRevisionConflict }),
  );
  // A newer daemon baseline replaces an unedited form; edits wait for an explicit reload.
  useEffect(() => {
    if (!model.getState().dirty) model.reload(baseline);
  }, [baseline, model]);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const handleReload = useCallback(async () => {
    setReloading(true);
    setReloadError(null);
    try {
      const fresh = await load();
      if (fresh) model.reload(fresh);
      else setReloadError(t("sshMachines.routing.machineMissing"));
    } catch (error) {
      setReloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReloading(false);
    }
  }, [load, model, t]);
  const handleSave = useCallback(() => void model.submit(), [model]);
  const submitError = fieldError(state.errors, null, t);
  const workspace = state.scope === "workspace";

  return (
    <View style={styles.form}>
      <Text style={settingsStyles.rowHint}>
        {t(workspace ? "sshMachines.routing.workspaceHint" : "sshMachines.policyHint")}
      </Text>
      <SkillsRow
        value={state.localSkills}
        inherit={workspace ? state.inherit.localSkills : null}
        readOnly={readOnly}
        onChange={model.setLocalSkills}
        onInherit={model.setInherit}
      />
      <ToolListField
        field="localTools"
        label={t("sshMachines.localTools")}
        hint={t("sshMachines.localToolsHint")}
        value={state.drafts.localTools}
        inherit={workspace ? state.inherit.localTools : null}
        error={fieldError(state.errors, "localTools", t)}
        readOnly={readOnly}
        resetKey={state.resetKey}
        onChange={model.setDraft}
        onInherit={model.setInherit}
      />
      <ToolListField
        field="localMcpServers"
        label={t("sshMachines.routing.localMcpServers")}
        hint={t("sshMachines.routing.localMcpServersHint")}
        value={state.drafts.localMcpServers}
        inherit={workspace ? state.inherit.localMcpServers : null}
        error={fieldError(state.errors, "localMcpServers", t)}
        readOnly={readOnly}
        resetKey={state.resetKey}
        onChange={model.setDraft}
        onInherit={model.setInherit}
      />
      <ToolListField
        field="disabledTools"
        label={t("sshMachines.disabledTools")}
        hint={t("sshMachines.routing.disabledToolsHint")}
        value={state.drafts.disabledTools}
        inherit={workspace ? state.inherit.disabledTools : null}
        error={fieldError(state.errors, "disabledTools", t)}
        readOnly={readOnly}
        resetKey={state.resetKey}
        onChange={model.setDraft}
        onInherit={model.setInherit}
      />
      <Text style={settingsStyles.rowHint}>
        {t("sshMachines.policyRevision", { revision: state.expectedRevision })}
      </Text>
      {submitError ? <Text style={settingsStyles.rowError}>{submitError}</Text> : null}
      {reloadError ? <Text style={settingsStyles.rowError}>{reloadError}</Text> : null}
      {readOnly ? (
        <Text style={settingsStyles.rowHint}>{t("sshMachines.routing.readOnly")}</Text>
      ) : null}
      {readOnly ? null : (
        <View style={styles.actions}>
          {state.stale || state.dirty ? (
            <Button size="sm" variant="ghost" onPress={handleReload} loading={reloading}>
              {t("sshMachines.routing.reload")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="default"
            onPress={handleSave}
            loading={state.status === "submitting"}
            disabled={!state.dirty || state.errors.some((error) => error.field !== null)}
          >
            {t("sshMachines.savePolicy")}
          </Button>
        </View>
      )}
    </View>
  );
}

function SkillsRow({
  value,
  inherit,
  readOnly,
  onChange,
  onInherit,
}: {
  value: boolean;
  inherit: boolean | null;
  readOnly: boolean;
  onChange: (value: boolean) => void;
  onInherit: (field: "localSkills", value: boolean) => void;
}) {
  const { t } = useTranslation();
  const handleInherit = useCallback((next: boolean) => onInherit("localSkills", next), [onInherit]);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("sshMachines.localSkills")}</Text>
        <Text style={settingsStyles.rowHint}>{t("sshMachines.localSkillsHint")}</Text>
        {inherit === null ? null : (
          <InheritToggle value={inherit} readOnly={readOnly} onChange={handleInherit} />
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={readOnly || inherit === true}
        accessibilityLabel={t("sshMachines.localSkills")}
      />
    </View>
  );
}

function ToolListField({
  field,
  label,
  hint,
  value,
  inherit,
  error,
  readOnly,
  resetKey,
  onChange,
  onInherit,
}: {
  field: SshRoutingField;
  resetKey: number;
  label: string;
  hint: string;
  value: string;
  inherit: boolean | null;
  error: string | null;
  readOnly: boolean;
  onChange: (field: SshRoutingField, value: string) => void;
  onInherit: (field: SshRoutingField, value: boolean) => void;
}) {
  const handleChange = useCallback((next: string) => onChange(field, next), [field, onChange]);
  const handleInherit = useCallback((next: boolean) => onInherit(field, next), [field, onInherit]);
  const trailing = useMemo(
    () =>
      inherit === null ? undefined : (
        <InheritToggle value={inherit} readOnly={readOnly} onChange={handleInherit} />
      ),
    [handleInherit, inherit, readOnly],
  );
  return (
    <Field label={label} hint={hint} error={error} trailing={trailing}>
      <FormTextInput
        key={`${field}:${resetKey}:${inherit === true ? "inherit" : "own"}`}
        initialValue={value}
        onChangeText={handleChange}
        editable={!readOnly && inherit !== true}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </Field>
  );
}

function InheritToggle({
  value,
  readOnly,
  onChange,
}: {
  value: boolean;
  readOnly: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.inherit}>
      <Text style={settingsStyles.rowHint}>{t("sshMachines.routing.useMachineDefault")}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={readOnly}
        accessibilityLabel={t("sshMachines.routing.useMachineDefault")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  inherit: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
