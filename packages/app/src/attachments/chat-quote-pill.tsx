import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CornerDownRight, Pencil, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { openChatQuoteSource } from "@/attachments/chat-quote-jump";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { ICON_SIZE, type Theme } from "@/styles/theme";

type ChatQuoteSource = ChatQuoteContextAttachment["source"];

interface ChatQuoteLineProps {
  text: string;
  comment?: string;
  /** Clip the comment too; the composer does, a sent message shows the whole comment. */
  clampComment?: boolean;
  /** Pressing the excerpt runs this; without it the quote is static. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * The one look for a quote: a muted reply arrow and the excerpt clipped to two lines, with the
 * user's comment under it. Only the excerpt is pressable, so the comment stays selectable text.
 */
export function ChatQuoteLine({
  text,
  comment,
  clampComment = false,
  onPress,
  accessibilityLabel,
  testID,
}: ChatQuoteLineProps) {
  const excerpt = text.replace(/\s+/g, " ").trim();
  return (
    <View style={styles.line}>
      <PressHighlight
        testID={testID}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "link" : undefined}
        accessibilityLabel={accessibilityLabel}
        style={styles.excerptRow}
      >
        <View style={styles.icon}>{quoteIcon}</View>
        <Text style={styles.excerpt} numberOfLines={2}>
          {excerpt}
        </Text>
      </PressHighlight>
      {comment ? (
        <Text
          style={styles.comment}
          selectable={!clampComment}
          numberOfLines={clampComment ? 2 : undefined}
          testID={testID ? `${testID}-comment` : undefined}
        >
          {comment}
        </Text>
      ) : null}
    </View>
  );
}

interface SentChatQuoteProps {
  text: string;
  comment?: string;
  source: ChatQuoteSource | null;
}

/** A quote inside a sent message. Pressing it opens the quoted message in its conversation. */
export function SentChatQuote({ text, comment, source }: SentChatQuoteProps) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    if (source) openChatQuoteSource(source);
  }, [source]);
  return (
    <ChatQuoteLine
      testID="user-message-chat-quote"
      text={text}
      comment={comment}
      onPress={source ? open : undefined}
      accessibilityLabel={source ? t("composer.attachments.openChatQuoteSource") : undefined}
    />
  );
}

interface ChatQuotePreviewProps {
  text: string;
  source: ChatQuoteSource;
}

/** The quote a side conversation was started from. */
export function ChatQuotePreview({ text, source }: ChatQuotePreviewProps) {
  return <SentChatQuote text={text} source={source} />;
}

interface ChatQuoteAttachmentPillProps {
  attachment: ChatQuoteContextAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
  onChangeComment: (index: number, comment: string) => void;
}

/**
 * The quote in the composer, above the input. Pressing it opens a sheet to edit the comment
 * or go to the quoted message; the trailing button removes it.
 */
export function ChatQuoteAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
  onChangeComment,
}: ChatQuoteAttachmentPillProps) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(attachment.comment ?? "");
  const openSheet = useCallback(() => {
    setCommentDraft(attachment.comment ?? "");
    setSheetOpen(true);
  }, [attachment.comment]);
  // The draft commits on close so typing does not rewrite the composer draft per keystroke.
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (commentDraft.trim() !== (attachment.comment ?? "")) onChangeComment(index, commentDraft);
  }, [attachment.comment, commentDraft, index, onChangeComment]);
  const goToSource = useCallback(() => {
    openChatQuoteSource(attachment.source);
  }, [attachment.source]);
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const header = useMemo<SheetHeader>(() => ({ title: t("composer.attachments.chatQuote") }), [t]);
  return (
    <View style={styles.composerRow} testID="composer-chat-quote">
      <ChatQuoteLine
        testID="composer-chat-quote-attachment-pill"
        text={attachment.selectedText}
        comment={attachment.comment}
        clampComment
        onPress={goToSource}
        accessibilityLabel={t("composer.attachments.openChatQuoteSource")}
      />
      <ToolbarButton
        compact
        onPress={openSheet}
        disabled={disabled}
        label={t("composer.attachments.openChatQuote", { text: attachment.selectedText })}
        testID="composer-chat-quote-edit"
      >
        {editIcon}
      </ToolbarButton>
      <ToolbarButton
        compact
        onPress={remove}
        disabled={disabled}
        label={t("composer.attachments.removeChatQuote")}
        testID="composer-chat-quote-remove"
      >
        {removeIcon}
      </ToolbarButton>
      <AdaptiveModalSheet header={header} visible={sheetOpen} onClose={closeSheet}>
        <View style={styles.sheet}>
          <Text style={styles.sheetQuote} selectable>
            {attachment.selectedText}
          </Text>
          <Field label={t("composer.attachments.chatQuoteComment")}>
            <FormTextInput
              testID="chat-quote-comment-input"
              initialValue={commentDraft}
              onChangeText={setCommentDraft}
              editable={!disabled}
              multiline
              placeholder={t("composer.attachments.chatQuoteCommentPlaceholder")}
              style={styles.commentInput}
            />
          </Field>
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

const ThemedQuoteIcon = withUnistyles(CornerDownRight);
const ThemedX = withUnistyles(X);
const ThemedPencil = withUnistyles(Pencil);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const quoteIcon = <ThemedQuoteIcon size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;
const removeIcon = <ThemedX size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;

const styles = StyleSheet.create((theme) => ({
  line: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  excerptRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  icon: {
    paddingTop: 2,
  },
  excerpt: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  comment: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingLeft: ICON_SIZE.sm + theme.spacing[2],
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sheet: {
    gap: theme.spacing[3],
  },
  sheetQuote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.content,
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  commentInput: {
    minHeight: 72,
  },
}));
