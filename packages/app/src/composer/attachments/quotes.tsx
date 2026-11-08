import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { openChatQuoteSource } from "@/attachments/chat-quote-jump";
import { type ComposerQuote, type InlineQuote, isComposerQuote } from "@/attachments/inline-quote";
import { QuoteStack, type QuoteStackItem } from "@/attachments/quote-stack";
import { openArtifactViewer } from "@/artifacts/viewer-state";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

export { isComposerQuote, type ComposerQuote };

export function openQuoteSource(quote: ComposerQuote): void {
  if (quote.kind === "chat_quote") {
    openChatQuoteSource(quote.source);
    return;
  }
  openArtifactViewer(quote.source.serverId, quote.source.artifactId);
}

function useQuoteSourceLabel() {
  const { t } = useTranslation();
  return useCallback(
    (quote: ComposerQuote) =>
      quote.kind === "chat_quote"
        ? t("composer.attachments.quoteFromConversation")
        : t("composer.attachments.artifactQuoteSource", {
            title: quote.title,
            revision: quote.source.revision,
          }),
    [t],
  );
}

interface LegacyComposerQuotesProps {
  /** Quotes saved before inline quoting, each with its index in `selectedAttachments`. */
  quotes: readonly { attachment: ComposerQuote; index: number }[];
  disabled: boolean;
  onRemove: (index: number) => void;
  onChangeComment: (index: number, comment: string) => void;
}

/** Drafts saved before quotes were written into the text keep their quotes above it. */
export function LegacyComposerQuotes({
  quotes,
  disabled,
  onRemove,
  onChangeComment,
}: LegacyComposerQuotesProps) {
  const { t } = useTranslation();
  const sourceLabel = useQuoteSourceLabel();
  const items = useMemo(
    () =>
      quotes.map(
        ({ attachment, index }): QuoteStackItem => ({
          key: attachment.id,
          kind: attachment.kind === "chat_quote" ? "chat" : "artifact",
          sourceLabel: sourceLabel(attachment),
          text: attachment.selectedText,
          comment: attachment.comment,
          onOpen: () => openQuoteSource(attachment),
          openLabel:
            attachment.kind === "chat_quote"
              ? t("composer.attachments.openChatQuoteSource")
              : t("composer.attachments.openArtifactQuoteSource"),
          onRemove: () => onRemove(index),
          onChangeComment: (comment: string) => onChangeComment(index, comment),
        }),
      ),
    [onChangeComment, onRemove, quotes, sourceLabel, t],
  );
  return (
    <QuoteStack items={items} variant="composer" disabled={disabled} testID="composer-quotes" />
  );
}

interface InlineQuoteSheetProps {
  quote: InlineQuote | null;
  disabled: boolean;
  onClose: () => void;
  onRemove: (quote: InlineQuote) => void;
}

/** Opens from a click on quoted text in the composer: where it came from, open it, or drop it. */
export function InlineQuoteSheet({ quote, disabled, onClose, onRemove }: InlineQuoteSheetProps) {
  const { t } = useTranslation();
  const sourceLabel = useQuoteSourceLabel();
  const header = useMemo<SheetHeader>(
    () => ({ title: quote ? sourceLabel(quote) : t("composer.attachments.chatQuote") }),
    [quote, sourceLabel, t],
  );
  const open = useCallback(() => {
    if (!quote) return;
    onClose();
    openQuoteSource(quote);
  }, [onClose, quote]);
  const remove = useCallback(() => {
    if (!quote) return;
    onClose();
    onRemove(quote);
  }, [onClose, onRemove, quote]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible={quote !== null}
      onClose={onClose}
      testID="composer-inline-quote-sheet"
    >
      <View style={styles.sheet}>
        <Text style={styles.quote} selectable>
          {quote?.selectedText}
        </Text>
        <View style={styles.actions}>
          <Button variant="secondary" size="sm" onPress={open} testID="inline-quote-open">
            {quote?.kind === "artifact_quote"
              ? t("composer.attachments.openArtifactQuoteSource")
              : t("composer.attachments.openChatQuoteSource")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={remove}
            disabled={disabled}
            testID="inline-quote-remove"
          >
            {t("composer.attachments.removeChatQuote")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { gap: theme.spacing[3] },
  quote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.content,
    paddingLeft: theme.spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  actions: { flexDirection: "row", gap: theme.spacing[2], flexWrap: "wrap" },
}));
