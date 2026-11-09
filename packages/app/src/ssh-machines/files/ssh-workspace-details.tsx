import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SshOperation } from "@getpaseo/protocol/ssh-workspaces";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { useHostPermission } from "../internal/use-execution-location";
import type { SshRoutingValues } from "../internal/ssh-form-models";
import {
  useSshMachines,
  useSshWorkspaceOperations,
  useSshWorkspaceRouting,
} from "../internal/use-ssh-machines";
import { SshRoutingEditor } from "../settings/ssh-routing-editor";

// Tool routing override for one SSH workspace. Machine defaults come from the daemon with
// their source; the override only stores fields the user set.
export function SshWorkspaceRoutingPanel({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useTranslation();
  const routing = useSshWorkspaceRouting(serverId, workspaceId);
  const { setWorkspaceRouting } = useSshMachines(serverId);
  const canManage = useHostPermission(serverId, "daemon.manage");
  const baseline = useMemo(
    () =>
      routing.data?.effective
        ? {
            scope: "workspace" as const,
            override: routing.data.override,
            effective: routing.data.effective,
          }
        : null,
    [routing.data],
  );
  const save = useCallback(
    async (values: SshRoutingValues & { expectedRevision: number }) => {
      const result = await setWorkspaceRouting.mutateAsync({ workspaceId, ...values });
      if (!result.effective) throw new Error(t("sshMachines.routing.machineMissing"));
      return {
        scope: "workspace" as const,
        override: result.override,
        effective: result.effective,
      };
    },
    [setWorkspaceRouting, t, workspaceId],
  );

  const load = useCallback(async () => {
    const fresh = await routing.refetch();
    if (fresh.error) throw fresh.error;
    const data = fresh.data;
    return data?.effective
      ? { scope: "workspace" as const, override: data.override, effective: data.effective }
      : null;
  }, [routing]);

  if (routing.error) {
    return <Text style={styles.error}>{toErrorMessage(routing.error)}</Text>;
  }
  if (!routing.data) return <Text style={styles.state}>{t("sshMachines.files.loading")}</Text>;
  if (!baseline) return <Text style={styles.state}>{t("sshMachines.routing.machineMissing")}</Text>;
  return <SshRoutingEditor baseline={baseline} save={save} load={load} readOnly={!canManage} />;
}

// Side effects the daemon sent to the machine, newest first. Unknown outcomes block further
// automatic changes until the user's next message.
export function SshWorkspaceOperationsPanel({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement {
  const { t } = useTranslation();
  const operations = useSshWorkspaceOperations(serverId, workspaceId);
  const { acknowledgeOperations } = useSshMachines(serverId);
  const canConfirm = useHostPermission(serverId, "workspace.write");
  const [result, setResult] = useState<string | null>(null);
  const list = operations.data ?? [];
  const unknown = list.filter((operation) => operation.state === "unknown");
  const refresh = useCallback(() => void operations.refetch(), [operations]);
  // Confirms exactly the unknown entries on screen, with the state time the person saw.
  const confirm = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("sshMachines.operations.confirmTitle"),
      message: t("sshMachines.operations.confirmMessage", { count: unknown.length }),
      confirmLabel: t("sshMachines.operations.confirm"),
    });
    if (!confirmed) return;
    setResult(null);
    try {
      const outcome = await acknowledgeOperations.mutateAsync({
        workspaceId,
        operations: unknown.map((operation) => ({
          operationId: operation.operationId,
          at: operation.at,
        })),
      });
      if (outcome.stale.length > 0) {
        setResult(t("sshMachines.operations.stale", { count: outcome.stale.length }));
      }
    } catch (error) {
      setResult(toErrorMessage(error));
    }
  }, [acknowledgeOperations, t, unknown, workspaceId]);
  if (operations.isPending) {
    return <Text style={styles.state}>{t("sshMachines.files.loading")}</Text>;
  }
  if (operations.error) {
    return <Text style={styles.error}>{toErrorMessage(operations.error)}</Text>;
  }
  return (
    <ScrollView style={styles.list}>
      <View style={styles.toolbar}>
        <Button size="sm" variant="ghost" onPress={refresh} loading={operations.isFetching}>
          {t("sshMachines.files.refresh")}
        </Button>
        {unknown.length > 0 && canConfirm ? (
          <Button
            size="sm"
            variant="default"
            onPress={confirm}
            loading={acknowledgeOperations.isPending}
            testID="ssh-operations-confirm"
          >
            {t("sshMachines.operations.confirm")}
          </Button>
        ) : null}
      </View>
      {unknown.length > 0 ? (
        <Text style={styles.warning}>{t("sshMachines.operations.unknownNotice")}</Text>
      ) : null}
      {result ? <Text style={styles.error}>{result}</Text> : null}
      {list.length === 0 ? (
        <Text style={styles.state}>{t("sshMachines.operations.empty")}</Text>
      ) : null}
      {list.map((operation) => (
        <OperationRow key={operation.operationId} operation={operation} />
      ))}
    </ScrollView>
  );
}

function OperationRow({ operation }: { operation: SshOperation }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {operation.kind} · {t(`sshMachines.operations.state.${operation.state}`)}
        {operation.exitCode === null ? "" : ` · ${operation.exitCode}`}
      </Text>
      {operation.path ? (
        <Text style={styles.rowHint} numberOfLines={1}>
          {operation.path}
        </Text>
      ) : null}
      {operation.detail ? <Text style={styles.rowHint}>{operation.detail}</Text> : null}
      <Text style={styles.rowHint}>{new Date(operation.at).toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  row: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  state: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  warning: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
}));
