import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SshMachine } from "@getpaseo/protocol/ssh-workspaces";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { useSshMachines } from "../internal/use-ssh-machines";
import { useHostPermission } from "../internal/use-execution-location";
import { useFormModel } from "../internal/use-form-model";
import {
  openSshMachineForm,
  openSshWorkspaceForm,
  type SshFormError,
} from "../internal/ssh-form-models";
import { SshRoutingEditor } from "./ssh-routing-editor";

type SshMachinesApi = ReturnType<typeof useSshMachines>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

export function formErrorText(
  errors: readonly SshFormError[],
  field: string | null,
  t: Translate,
): string | null {
  const error = errors.find((entry) => entry.field === field);
  if (!error) return null;
  return error.messageKey ? t(error.messageKey) : (error.message ?? null);
}

export function SshMachinesSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const api = useSshMachines(serverId);
  const canManageHost = useHostPermission(serverId, "daemon.manage");
  const [adding, setAdding] = useState(false);
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const addButton = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={openAdd} testID="ssh-machine-add">
        {t("sshMachines.add")}
      </Button>
    ),
    [openAdd, t],
  );

  if (!api.isConnected) return null;
  if (!api.isSupported) {
    return (
      <SettingsSection title={t("sshMachines.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("sshMachines.updateHost")}</Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t("sshMachines.title")}
      info={t("sshMachines.info")}
      trailing={adding || !canManageHost ? null : addButton}
      testID="ssh-machines-section"
    >
      {adding ? <AddMachineCard api={api} onDone={closeAdd} /> : null}
      {api.error ? <Text style={settingsStyles.rowError}>{toErrorMessage(api.error)}</Text> : null}
      {api.machines && api.machines.length === 0 && !adding ? (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("sshMachines.empty")}</Text>
          </View>
        </View>
      ) : null}
      {(api.machines ?? []).map((machine) => (
        <MachineCard key={machine.machineId} serverId={serverId} api={api} machine={machine} />
      ))}
    </SettingsSection>
  );
}

function AddMachineCard({ api, onDone }: { api: SshMachinesApi; onDone: () => void }) {
  const { t } = useTranslation();
  const { model, state } = useFormModel(() =>
    openSshMachineForm({ save: (input) => api.save.mutateAsync(input) }),
  );
  const setHost = useCallback((value: string) => model.setField("host", value), [model]);
  const setName = useCallback((value: string) => model.setField("displayName", value), [model]);
  const setUser = useCallback((value: string) => model.setField("user", value), [model]);
  const setPort = useCallback((value: string) => model.setField("port", value), [model]);
  const handleCancel = useCallback(() => {
    model.close();
    onDone();
  }, [model, onDone]);
  const handleSave = useCallback(async () => {
    const machine = await model.submit();
    if (!machine) return;
    if (!model.isClosed()) onDone();
    // Save and check remains the submitted intent after the form closes.
    api.check.mutate(machine.machineId);
  }, [api.check, model, onDone]);
  const submitError = formErrorText(state.errors, null, t);

  return (
    <View style={[settingsStyles.card, styles.form]} testID="ssh-machine-add-form">
      <Field
        label={t("sshMachines.hostLabel")}
        hint={t("sshMachines.hostHint")}
        error={formErrorText(state.errors, "host", t)}
      >
        <FormTextInput
          initialValue={state.values.host}
          onChangeText={setHost}
          placeholder="my-server"
          autoCapitalize="none"
          autoCorrect={false}
          testID="ssh-machine-host"
        />
      </Field>
      <Field label={t("sshMachines.nameLabel")}>
        <FormTextInput
          initialValue={state.values.displayName}
          onChangeText={setName}
          autoCorrect={false}
          testID="ssh-machine-name"
        />
      </Field>
      <View style={styles.inline}>
        <View style={styles.inlineField}>
          <Field label={t("sshMachines.userLabel")} error={formErrorText(state.errors, "user", t)}>
            <FormTextInput
              initialValue={state.values.user}
              onChangeText={setUser}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        </View>
        <View style={styles.inlineField}>
          <Field label={t("sshMachines.portLabel")} error={formErrorText(state.errors, "port", t)}>
            <FormTextInput
              initialValue={state.values.port}
              onChangeText={setPort}
              keyboardType="number-pad"
            />
          </Field>
        </View>
      </View>
      {submitError ? <Text style={settingsStyles.rowError}>{submitError}</Text> : null}
      <View style={styles.actions}>
        <Button size="sm" variant="ghost" onPress={handleCancel}>
          {t("sshMachines.cancel")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onPress={handleSave}
          loading={state.status === "submitting"}
          disabled={!state.canSubmit}
          testID="ssh-machine-save"
        >
          {t("sshMachines.saveAndCheck")}
        </Button>
      </View>
    </View>
  );
}

function connectionLabel(machine: SshMachine, t: (key: string) => string): string {
  return t(`sshMachines.state.${machine.connection.state}`);
}

function MachineCard({
  serverId,
  api,
  machine,
}: {
  serverId: string;
  api: SshMachinesApi;
  machine: SshMachine;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<"none" | "policy" | "workspace">("none");
  const [actionError, setActionError] = useState<string | null>(null);
  const connection = machine.connection;
  // Without daemon.read the daemon sends a summary: no target, no policy, no management.
  // Management needs daemon.manage; a full projection (daemon.read) alone only shows details.
  const canManageHost = useHostPermission(serverId, "daemon.manage");
  const canCreateWorkspace = useHostPermission(serverId, "workspace.manage");
  const canManage =
    canManageHost && machine.access !== "summary" && Boolean(machine.target && machine.policy);
  const target = machine.target
    ? [
        machine.target.user ? `${machine.target.user}@` : "",
        machine.target.host,
        machine.target.port ? `:${machine.target.port}` : "",
      ].join("")
    : t("sshMachines.targetHidden");

  const handleTrust = useCallback(async () => {
    const hostKey = connection.hostKey;
    if (!hostKey) return;
    const confirmed = await confirmDialog({
      title: t("sshMachines.trustTitle"),
      message: hostKey.fingerprints.join("\n"),
      confirmLabel: t("sshMachines.trust"),
    });
    if (!confirmed) return;
    api.trust.mutate(
      {
        machineId: machine.machineId,
        revision: machine.revision,
        candidateId: hostKey.candidateId,
      },
      {
        onSuccess: () => setActionError(null),
        onError: (error) =>
          setActionError(`${t("sshMachines.trustFailed")}: ${toErrorMessage(error)}`),
      },
    );
  }, [api.trust, connection.hostKey, machine.machineId, machine.revision, t]);

  const handleRemove = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("sshMachines.removeTitle"),
      message:
        machine.activeWorkspaceIds.length > 0
          ? t("sshMachines.removeMessageInUse", { count: machine.activeWorkspaceIds.length })
          : t("sshMachines.removeMessage"),
      confirmLabel: t("sshMachines.remove"),
      destructive: true,
    });
    if (!confirmed) return;
    api.remove.mutate(machine.machineId, {
      onError: (error) =>
        setActionError(`${t("sshMachines.removeFailed")}: ${toErrorMessage(error)}`),
    });
  }, [api.remove, machine.activeWorkspaceIds.length, machine.machineId, t]);
  const handleCheck = useCallback(
    () => api.check.mutate(machine.machineId),
    [api.check, machine.machineId],
  );
  const togglePolicy = useCallback(
    () => setPanel((current) => (current === "policy" ? "none" : "policy")),
    [],
  );
  const toggleWorkspace = useCallback(
    () => setPanel((current) => (current === "workspace" ? "none" : "workspace")),
    [],
  );
  const closePanel = useCallback(() => setPanel("none"), []);

  return (
    <View style={settingsStyles.card} testID={`ssh-machine-${machine.machineId}`}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{machine.displayName}</Text>
          <Text style={settingsStyles.rowHint}>
            {target} · {connectionLabel(machine, t)}
            {connection.probe ? ` · ${connection.probe.user} · ${connection.probe.os}` : ""}
          </Text>
          {connection.detail && connection.state !== "ready" ? (
            <Text style={settingsStyles.rowError}>{connection.detail}</Text>
          ) : null}
          {connection.hostKey ? (
            <Text style={settingsStyles.rowHint}>{connection.hostKey.fingerprints.join("\n")}</Text>
          ) : null}
        </View>
      </View>
      {actionError ? (
        <Text style={[settingsStyles.rowError, styles.rowActions]}>{actionError}</Text>
      ) : null}
      {canManage ? null : (
        <Text style={[settingsStyles.rowHint, styles.rowActions]}>
          {t("sshMachines.summaryOnly")}
        </Text>
      )}
      <MachineActions
        api={api}
        machine={machine}
        canManage={canManage}
        canCreateWorkspace={canCreateWorkspace}
        onTrust={handleTrust}
        onCheck={handleCheck}
        onTogglePolicy={togglePolicy}
        onToggleWorkspace={toggleWorkspace}
        onRemove={handleRemove}
      />
      {panel === "policy" && canManage ? <MachinePolicyEditor api={api} machine={machine} /> : null}
      {panel === "workspace" ? (
        <NewWorkspaceForm serverId={serverId} api={api} machine={machine} onDone={closePanel} />
      ) : null}
    </View>
  );
}

function MachineActions({
  api,
  machine,
  canManage,
  canCreateWorkspace,
  onTrust,
  onCheck,
  onTogglePolicy,
  onToggleWorkspace,
  onRemove,
}: {
  api: SshMachinesApi;
  machine: SshMachine;
  canManage: boolean;
  canCreateWorkspace: boolean;
  onTrust: () => void;
  onCheck: () => void;
  onTogglePolicy: () => void;
  onToggleWorkspace: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.actions, styles.rowActions]}>
      {machine.connection.state === "needs_trust" && canManage ? (
        <Button size="sm" variant="default" onPress={onTrust} loading={api.trust.isPending}>
          {t("sshMachines.trust")}
        </Button>
      ) : null}
      {canManage ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={onCheck}
          loading={api.check.isPending && api.check.variables === machine.machineId}
          disabled={machine.disabled}
        >
          {t("sshMachines.check")}
        </Button>
      ) : null}
      {canManage ? (
        <Button size="sm" variant="ghost" onPress={onTogglePolicy}>
          {t("sshMachines.toolRouting")}
        </Button>
      ) : null}
      {canCreateWorkspace ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={onToggleWorkspace}
          disabled={machine.connection.state !== "ready"}
          testID="ssh-machine-new-workspace"
        >
          {t("sshMachines.newWorkspace")}
        </Button>
      ) : null}
      {canManage ? (
        <Button size="sm" variant="ghost" onPress={onRemove}>
          {t("sshMachines.remove")}
        </Button>
      ) : null}
    </View>
  );
}

function MachinePolicyEditor({ api, machine }: { api: SshMachinesApi; machine: SshMachine }) {
  const policy = machine.policy!;
  const baseline = useMemo(
    () => ({
      scope: "machine" as const,
      revision: policy.revision,
      localTools: policy.localTools,
      disabledTools: policy.disabledTools,
      localSkills: policy.localSkills,
      localMcpServers: policy.localMcpServers ?? [],
    }),
    [policy],
  );
  const save = useCallback(
    async (values: {
      expectedRevision: number;
      localTools: string[] | null;
      disabledTools: string[] | null;
      localSkills: boolean | null;
      localMcpServers: string[] | null;
    }) => {
      const saved = await api.setPolicy.mutateAsync({
        machineId: machine.machineId,
        expectedRevision: values.expectedRevision,
        localTools: values.localTools ?? [],
        disabledTools: values.disabledTools ?? [],
        localSkills: values.localSkills ?? false,
        localMcpServers: values.localMcpServers ?? [],
      });
      const next = saved.policy!;
      return {
        scope: "machine" as const,
        revision: next.revision,
        localTools: next.localTools,
        disabledTools: next.disabledTools,
        localSkills: next.localSkills,
        localMcpServers: next.localMcpServers ?? [],
      };
    },
    [api.setPolicy, machine.machineId],
  );
  const load = useCallback(async () => {
    const fresh = (await api.reload()).find((entry) => entry.machineId === machine.machineId);
    const next = fresh?.policy;
    if (!next) return null;
    return {
      scope: "machine" as const,
      revision: next.revision,
      localTools: next.localTools,
      disabledTools: next.disabledTools,
      localSkills: next.localSkills,
      localMcpServers: next.localMcpServers ?? [],
    };
  }, [api, machine.machineId]);
  return <SshRoutingEditor baseline={baseline} save={save} load={load} />;
}

function NewWorkspaceForm({
  serverId,
  api,
  machine,
  onDone,
}: {
  serverId: string;
  api: SshMachinesApi;
  machine: SshMachine;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { model, state } = useFormModel(() =>
    openSshWorkspaceForm({
      create: (directory) =>
        api.createWorkspace.mutateAsync({ machineId: machine.machineId, directory }),
    }),
  );
  const handleCreate = useCallback(async () => {
    const result = await model.submit();
    if (!result || model.isClosed()) return;
    onDone();
    navigateToWorkspace({ serverId, workspaceId: result.workspaceId });
  }, [model, onDone, serverId]);
  const submitError = formErrorText(state.errors, null, t);

  return (
    <View style={styles.form}>
      <Field
        label={t("sshMachines.directoryLabel")}
        hint={t("sshMachines.directoryHint")}
        error={formErrorText(state.errors, "directory", t)}
      >
        <FormTextInput
          initialValue={state.directory}
          onChangeText={model.setDirectory}
          placeholder="~/project"
          autoCapitalize="none"
          autoCorrect={false}
          testID="ssh-workspace-directory"
        />
      </Field>
      {submitError ? <Text style={settingsStyles.rowError}>{submitError}</Text> : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="default"
          onPress={handleCreate}
          loading={state.status === "submitting"}
          disabled={!state.canSubmit}
          testID="ssh-workspace-create"
        >
          {t("sshMachines.createWorkspace")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  inline: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  inlineField: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  rowActions: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
}));
