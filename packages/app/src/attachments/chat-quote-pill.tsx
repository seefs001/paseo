import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CornerDownRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { openChatQuoteSource } from "@/attachments/chat-quote-jump";
import { PressHighlight } from "@/components/ui/press-highlight";
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

const ThemedQuoteIcon = withUnistyles(CornerDownRight);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const quoteIcon = <ThemedQuoteIcon size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />;

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
}));
