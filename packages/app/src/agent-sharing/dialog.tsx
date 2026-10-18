import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AgentShareModel } from "./model";

export function AgentShareDialog({
  model,
  visible,
  onClose,
}: {
  model: AgentShareModel;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const copying = state.status === "success" && state.feedback.status === "copying";
  const pending = state.status === "pending";
  const header = useMemo(() => ({ title: t("sessionShare.title") }), [t]);
  const close = useCallback(() => {
    if (model.close()) onClose();
  }, [model, onClose]);
  const copyLink = useCallback(() => void model.copyLink(), [model]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          disabled={pending || copying}
          onPress={close}
          testID="agent-share-close"
        >
          {t("common.actions.close")}
        </Button>
        {state.status === "error" ? (
          <Button variant="default" onPress={model.retry} testID="agent-share-retry">
            {t("common.actions.retry")}
          </Button>
        ) : null}
        {state.status === "success" ? (
          <Button
            variant="default"
            disabled={copying}
            loading={copying}
            onPress={copyLink}
            testID="agent-share-copy"
          >
            {state.feedback.status === "copied"
              ? t("common.states.copied")
              : t("common.actions.copy")}
          </Button>
        ) : null}
      </View>
    ),
    [close, copying, copyLink, model, pending, state, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={close}
      dismissible={!pending && !copying}
      header={header}
      testID="agent-share-dialog"
      contextBridge={null}
      footer={footer}
    >
      <Text style={styles.hint}>{t("sessionShare.privacy")}</Text>
      {pending ? (
        <View style={styles.pending} testID="agent-share-pending">
          <ThemedLoadingSpinner size="small" uniProps={spinnerColor} />
          <Text style={styles.text}>{t("sessionShare.uploading")}</Text>
        </View>
      ) : null}
      {state.status === "error" ? (
        <View style={styles.result}>
          <Alert
            variant="error"
            title={t("sessionShare.failed")}
            description={state.message}
            testID="agent-share-error"
          />
          <Text style={styles.hint}>{t("sessionShare.retryHint")}</Text>
        </View>
      ) : null}
      {state.status === "success" ? (
        <View style={styles.result} testID="agent-share-result">
          <View style={styles.link}>
            <ExternalLink
              href={state.result.viewerUrl}
              label={t("sessionShare.link")}
              onError={model.reportActionError}
            />
            <Text selectable style={styles.text} testID="agent-share-url">
              {state.result.viewerUrl}
            </Text>
          </View>
          <View style={styles.link}>
            <ExternalLink
              href={state.result.gistUrl}
              label="GitHub Gist"
              onError={model.reportActionError}
            />
            <Text selectable style={styles.text}>
              {state.result.gistUrl}
            </Text>
          </View>
          {state.feedback.status === "error" ? (
            <Alert variant="error" description={state.feedback.message} />
          ) : null}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  result: {
    gap: theme.spacing[4],
  },
  link: {
    gap: theme.spacing[2],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
  },
}));
