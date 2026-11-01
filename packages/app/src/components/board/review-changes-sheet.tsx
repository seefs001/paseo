import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

type Submission =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "failed"; message: string };

/** Sends text as the agent's next prompt, the same way the composer does. */
export async function sendBoardAgentPrompt(input: {
  serverId: string;
  agentId: string;
  text: string;
}): Promise<void> {
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client) throw new Error(i18n.t("board.review.hostOffline"));
  await dispatchComposerAgentMessage({
    client,
    agentId: input.agentId,
    text: input.text,
    attachments: [],
    encodeImages: async () => [],
    submission: createMessageSubmissionWriter(input.serverId),
  });
}

/** Request changes on a Review card: one prompt for the workspace's main agent. */
export function BoardReviewChangesSheet({
  serverId,
  agentId,
  taskTitle,
  visible,
  onClose,
  onDismiss,
}: {
  serverId: string;
  agentId: string;
  taskTitle: string;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const [text, setText] = useState("");
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const isSending = submission.status === "sending";
  const canSend = text.trim().length > 0 && !isSending;

  const send = useCallback(async () => {
    setSubmission({ status: "sending" });
    try {
      await sendBoardAgentPrompt({ serverId, agentId, text: text.trim() });
      onClose();
    } catch (error) {
      setSubmission({ status: "failed", message: toErrorMessage(error) });
    }
  }, [agentId, onClose, serverId, text]);
  const sendPress = useCallback(() => {
    void send();
  }, [send]);

  const header = useMemo<SheetHeader>(() => ({ title: t("board.review.changes.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSending}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={sendPress}
          disabled={!canSend}
          loading={isSending}
          testID="board-review-changes-send"
        >
          {isSending ? t("board.review.changes.sending") : t("board.review.changes.send")}
        </Button>
      </View>
    ),
    [canSend, isSending, onClose, sendPress, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissible={!isSending}
      footer={footer}
      testID="board-review-changes-sheet"
    >
      <View style={styles.body}>
        <Field label={t("board.review.changes.label")} hint={taskTitle}>
          <FormTextInput
            size={controlSize}
            initialValue=""
            onChangeText={setText}
            placeholder={t("board.review.changes.placeholder")}
            accessibilityLabel={t("board.review.changes.label")}
            style={styles.input}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            autoFocus
            testID="board-review-changes-input"
          />
        </Field>
        {submission.status === "failed" ? (
          <Text style={styles.error}>
            {t("board.review.changes.failed", { message: submission.message })}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  input: {
    minHeight: 112,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
