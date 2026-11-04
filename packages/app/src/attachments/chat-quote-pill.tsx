import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { getChatQuoteSourceLabel } from "@/attachments/chat-quote";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";

interface ChatQuotePreviewProps {
  text: string;
  source: ChatQuoteContextAttachment["source"];
  onOpenSource?: () => void;
  /** Shown as an editable field when set; otherwise the quote is read-only. */
  comment?: {
    value: string;
    onChange: (value: string) => void;
    editable: boolean;
  };
}

export function ChatQuotePreview({ text, source, onOpenSource, comment }: ChatQuotePreviewProps) {
  const { t } = useTranslation();
  const openSource = useCallback(() => {
    onOpenSource?.();
    navigateToAgent({ serverId: source.serverId, agentId: source.agentId });
  }, [onOpenSource, source.agentId, source.serverId]);
  return (
    <View style={styles.preview} testID="chat-quote-preview">
      <Text style={styles.label}>{t("composer.attachments.chatQuote")}</Text>
      <Text style={styles.quote} selectable>
        {text}
      </Text>
      {comment ? (
        <Field label={t("composer.attachments.chatQuoteComment")}>
          <FormTextInput
            testID="chat-quote-comment-input"
            initialValue={comment.value}
            onChangeText={comment.onChange}
            editable={comment.editable}
            multiline
            placeholder={t("composer.attachments.chatQuoteCommentPlaceholder")}
            style={styles.commentInput}
          />
        </Field>
      ) : null}
      <Text style={styles.label}>{t("composer.attachments.chatQuoteSource")}</Text>
      <Text style={styles.source} selectable>
        {getChatQuoteSourceLabel(source)}
      </Text>
      <View style={styles.sourceAction}>
        <Button variant="outline" size="sm" onPress={openSource}>
          {t("composer.attachments.openChatQuoteSource")}
        </Button>
      </View>
    </View>
  );
}

interface ChatQuoteAttachmentPillProps {
  attachment: ChatQuoteContextAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
  onChangeComment: (index: number, comment: string) => void;
}

export function ChatQuoteAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
  onChangeComment,
}: ChatQuoteAttachmentPillProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(attachment.comment ?? "");
  const openPreview = useCallback(() => {
    setCommentDraft(attachment.comment ?? "");
    setPreviewOpen(true);
  }, [attachment.comment]);
  // The draft commits on close so typing does not rewrite the composer draft per keystroke.
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    if (commentDraft.trim() !== (attachment.comment ?? "")) onChangeComment(index, commentDraft);
  }, [attachment.comment, commentDraft, index, onChangeComment]);
  const commentField = useMemo(
    () => ({ value: commentDraft, onChange: setCommentDraft, editable: !disabled }),
    [commentDraft, disabled],
  );
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const header = useMemo<SheetHeader>(() => ({ title: t("composer.attachments.chatQuote") }), [t]);
  const title = `“${attachment.selectedText.replace(/\s+/g, " ").trim()}”`;
  const sourceLabel = attachment.comment ?? getChatQuoteSourceLabel(attachment.source);
  return (
    <>
      <AttachmentPill
        testID="composer-chat-quote-attachment-pill"
        disabled={disabled}
        onOpen={openPreview}
        onRemove={remove}
        openAccessibilityLabel={t("composer.attachments.openChatQuote", {
          ...attachment.source,
          text: attachment.selectedText,
        })}
        removeAccessibilityLabel={t("composer.attachments.removeChatQuote")}
      >
        <AttachmentLabel icon={quoteIcon} title={title} subtitle={sourceLabel} />
      </AttachmentPill>
      <AdaptiveModalSheet header={header} visible={previewOpen} onClose={closePreview}>
        <ChatQuotePreview
          text={attachment.selectedText}
          source={attachment.source}
          onOpenSource={closePreview}
          comment={commentField}
        />
      </AdaptiveModalSheet>
    </>
  );
}

const ThemedQuote = withUnistyles(MessageSquare);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const quoteIcon = <ThemedQuote size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;

const styles = StyleSheet.create((theme) => ({
  preview: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  quote: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    marginBottom: theme.spacing[2],
  },
  commentInput: {
    minHeight: 72,
  },
  source: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sourceAction: {
    alignItems: "flex-start",
    marginTop: theme.spacing[1],
  },
}));
