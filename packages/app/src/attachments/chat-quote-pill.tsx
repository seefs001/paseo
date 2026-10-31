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
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";

interface ChatQuotePreviewProps {
  text: string;
  source: ChatQuoteContextAttachment["source"];
  onOpenSource?: () => void;
}

export function ChatQuotePreview({ text, source, onOpenSource }: ChatQuotePreviewProps) {
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
}

export function ChatQuoteAttachmentPill({
  attachment,
  index,
  disabled,
  onRemove,
}: ChatQuoteAttachmentPillProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = useCallback(() => setPreviewOpen(true), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const header = useMemo<SheetHeader>(() => ({ title: t("composer.attachments.chatQuote") }), [t]);
  const title = `“${attachment.selectedText.replace(/\s+/g, " ").trim()}”`;
  const sourceLabel = getChatQuoteSourceLabel(attachment.source);
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
  source: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sourceAction: {
    alignItems: "flex-start",
    marginTop: theme.spacing[1],
  },
}));
