import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { passwordDraftError } from "./daemon-password-form";
import { addHostname, removeHostname } from "./hostnames-config";

const NO_HOSTNAMES: string[] = [];

export function HostDaemonAccessSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const canEditHostnames = useHostFeature(serverId, "daemonHostnames");
  const canSetPassword = useHostFeature(serverId, "daemonPassword");

  if (!isConnected) return null;
  if (!canEditHostnames && !canSetPassword) {
    return (
      <View style={styles.section}>
        <Alert
          size="sm"
          variant="warning"
          title={t("settings.host.access.updateHost")}
          testID="host-daemon-access-update"
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {canEditHostnames ? <HostnamesCard serverId={serverId} /> : null}
      {canSetPassword ? <DaemonPasswordCard serverId={serverId} /> : null}
    </View>
  );
}

function HostnamesCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const input = useRef<EditingTextInputHandle>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const hostnames = Array.isArray(config?.hostnames) ? config.hostnames : NO_HOSTNAMES;
  const allowsAnyHost = config?.hostnames === true;
  const mutation = useMutation({
    mutationFn: async (next: true | string[]) => {
      const saved = await patchConfig({ hostnames: next });
      if (!saved) throw new Error(t("workspace.terminal.hostDisconnected"));
      return saved;
    },
    onSuccess: () => {
      setErrorText(null);
      input.current?.reset();
    },
    onError: (error: unknown) => {
      setErrorText(error instanceof Error ? error.message : t("settings.host.access.saveFailed"));
    },
  });

  const save = useCallback(
    (next: true | string[]) => {
      setErrorText(null);
      mutation.mutate(next);
    },
    [mutation],
  );
  const useAllowlist = useCallback(() => {
    save([]);
  }, [save]);
  const add = useCallback(() => {
    const result = addHostname(hostnames, input.current?.getText() ?? "");
    if (!result.ok) {
      setErrorText(t("settings.host.access.invalid"));
      return;
    }
    if (result.hostnames.length === hostnames.length) {
      input.current?.reset();
      return;
    }
    save(result.hostnames);
  }, [hostnames, save, t]);

  if (!config) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-hostnames-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.access.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.access.hint")}</Text>
        </View>
      </View>
      {allowsAnyHost ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowHint}>{t("settings.host.access.allowAny")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={useAllowlist}
            disabled={mutation.isPending}
            testID="host-page-hostnames-allowlist"
          >
            {t("settings.host.access.useAllowlist")}
          </Button>
        </View>
      ) : (
        <>
          {hostnames.length === 0 ? (
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <Text style={settingsStyles.rowHint}>{t("settings.host.access.empty")}</Text>
            </View>
          ) : (
            hostnames.map((hostname) => (
              <HostnameRow
                key={hostname}
                hostname={hostname}
                disabled={mutation.isPending}
                onRemove={save}
                hostnames={hostnames}
              />
            ))
          )}
          <View style={[styles.editor, settingsStyles.rowBorder]}>
            <EditingTextInput
              ref={input}
              initialValue=""
              placeholder={t("settings.host.access.placeholder")}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={add}
              accessibilityLabel={t("settings.host.access.title")}
              testID="host-page-hostname-input"
            />
            <Button
              variant="outline"
              size="sm"
              onPress={add}
              disabled={mutation.isPending}
              testID="host-page-hostname-add"
            >
              {t("settings.host.access.add")}
            </Button>
          </View>
        </>
      )}
      {errorText ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowError} testID="host-page-hostnames-error">
            {errorText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DaemonPasswordCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const { config } = useDaemonConfig(serverId);
  const password = useRef<EditingTextInputHandle>(null);
  const confirm = useRef<EditingTextInputHandle>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: async (next: string) => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.setDaemonPassword(next);
    },
    onSuccess: () => {
      setErrorText(null);
      setSaved(true);
      password.current?.reset();
      confirm.current?.reset();
    },
    onError: (error: unknown) => {
      setSaved(false);
      setErrorText(
        error instanceof Error ? error.message : t("settings.host.daemonPassword.saveFailed"),
      );
    },
  });
  const save = useCallback(() => {
    const draft = passwordDraftError(
      password.current?.getText() ?? "",
      confirm.current?.getText() ?? "",
    );
    if (draft === "empty") {
      setSaved(false);
      setErrorText(t("settings.host.daemonPassword.empty"));
      return;
    }
    if (draft === "mismatch") {
      setSaved(false);
      setErrorText(t("settings.host.daemonPassword.mismatch"));
      return;
    }
    setErrorText(null);
    mutation.mutate(password.current?.getText() ?? "");
  }, [mutation, t]);

  if (!config) return null;

  return (
    <View style={[settingsStyles.card, styles.cardGap]} testID="host-page-password-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemonPassword.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.daemonPassword.hint")}</Text>
          <Text style={settingsStyles.rowHint}>
            {config.passwordSet
              ? t("settings.host.daemonPassword.set")
              : t("settings.host.daemonPassword.unset")}
          </Text>
        </View>
      </View>
      <View style={[styles.editor, settingsStyles.rowBorder]}>
        <EditingTextInput
          ref={password}
          initialValue=""
          placeholder={t("settings.host.daemonPassword.placeholder")}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t("settings.host.daemonPassword.placeholder")}
          testID="host-page-password-input"
        />
      </View>
      <View style={[styles.editor, settingsStyles.rowBorder]}>
        <EditingTextInput
          ref={confirm}
          initialValue=""
          placeholder={t("settings.host.daemonPassword.confirmPlaceholder")}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          onSubmitEditing={save}
          accessibilityLabel={t("settings.host.daemonPassword.confirmPlaceholder")}
          testID="host-page-password-confirm"
        />
        <Button
          variant="outline"
          size="sm"
          onPress={save}
          disabled={mutation.isPending}
          testID="host-page-password-save"
        >
          {mutation.isPending
            ? t("settings.host.daemonPassword.saving")
            : t("settings.host.daemonPassword.save")}
        </Button>
      </View>
      {saved ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint} testID="host-page-password-saved">
            {t("settings.host.daemonPassword.saved")}
          </Text>
        </View>
      ) : null}
      {errorText ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowError} testID="host-page-password-error">
            {errorText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HostnameRow({
  hostname,
  hostnames,
  disabled,
  onRemove,
}: {
  hostname: string;
  hostnames: readonly string[];
  disabled: boolean;
  onRemove: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(() => {
    onRemove(removeHostname(hostnames, hostname));
  }, [hostname, hostnames, onRemove]);

  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID={`host-page-hostname-${hostname}`}
    >
      <Text style={[settingsStyles.rowTitle, styles.hostname]}>{hostname}</Text>
      <Button
        variant="ghost"
        size="sm"
        onPress={remove}
        disabled={disabled}
        accessibilityLabel={t("settings.host.access.remove", { hostname })}
      >
        {t("settings.host.access.removeAction")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginTop: theme.spacing[6],
  },
  hostname: {
    flex: 1,
  },
  editor: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  input: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    minHeight: 36,
  },
  cardGap: {
    marginTop: theme.spacing[3],
  },
}));
