import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquareQuote,
  Pencil,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export interface QuoteStackItem {
  key: string;
  kind: "chat" | "artifact";
  /** Human source label: "Conversation" or the artifact title and revision. Never raw ids. */
  sourceLabel: string;
  text: string;
  comment?: string;
  /** Pressing the excerpt opens the source; absent when the source can't be resolved. */
  onOpen?: () => void;
  openLabel?: string;
  onChangeComment?: (comment: string) => void;
  onRemove?: () => void;
}

interface QuoteStackProps {
  items: readonly QuoteStackItem[];
  /** The composer clamps rows and caps the stack height so the typing area keeps its room. */
  variant: "composer" | "sent";
  disabled?: boolean;
  testID?: string;
}

/**
 * One compact block for every quote on a message: numbered rows in send order, each with its
 * source, a clipped excerpt that opens the source, and the comment as selectable text. A row
 * expands in place to the full excerpt, so nobody opens a sheet just to read it.
 */
export function QuoteStack({ items, variant, disabled = false, testID }: QuoteStackProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const rows = items.map((item, index) => (
    <QuoteStackRow
      key={item.key}
      item={item}
      index={index}
      numbered={items.length > 1}
      variant={variant}
      disabled={disabled}
    />
  ));
  return (
    <View style={styles.stack} testID={testID}>
      {items.length > 1 ? (
        <Text style={styles.header}>
          {t("composer.attachments.quotesHeader", { count: items.length })}
        </Text>
      ) : null}
      {variant === "composer" && items.length > 2 ? (
        <ScrollView style={styles.scroll} nestedScrollEnabled>
          {rows}
        </ScrollView>
      ) : (
        rows
      )}
    </View>
  );
}

function QuoteStackRow({
  item,
  index,
  numbered,
  variant,
  disabled,
}: {
  item: QuoteStackItem;
  index: number;
  numbered: boolean;
  variant: "composer" | "sent";
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(item.comment ?? "");
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const openSheet = useCallback(() => {
    setCommentDraft(item.comment ?? "");
    setSheetOpen(true);
  }, [item.comment]);
  const { onChangeComment } = item;
  // The draft commits on close so typing does not rewrite the composer draft per keystroke.
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (onChangeComment && commentDraft.trim() !== (item.comment ?? "")) {
      onChangeComment(commentDraft);
    }
  }, [commentDraft, item.comment, onChangeComment]);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("composer.attachments.editQuoteComment") }),
    [t],
  );
  const excerpt = expanded ? item.text : item.text.replace(/\s+/g, " ").trim();
  const clampComment = variant === "composer" && !expanded;
  const excerptLines = variant === "composer" ? 1 : 2;
  const testPrefix = item.kind === "chat" ? `${variant}-chat-quote` : `${variant}-artifact-quote`;
  return (
    <View style={styles.row} testID={testPrefix}>
      <View style={styles.gutter}>
        {numbered ? <Text style={styles.number}>{index + 1}</Text> : null}
        <View style={styles.kindIcon}>{item.kind === "chat" ? chatIcon : artifactIcon}</View>
      </View>
      <View style={styles.body}>
        <PressHighlight
          onPress={item.onOpen}
          disabled={!item.onOpen}
          accessibilityRole={item.onOpen ? "link" : undefined}
          accessibilityLabel={item.openLabel}
          testID={`${testPrefix}-open`}
          style={styles.excerptPress}
        >
          <Text style={styles.excerpt} numberOfLines={expanded ? undefined : excerptLines}>
            <Text style={styles.source}>{item.sourceLabel}</Text>
            {"  "}
            {excerpt}
          </Text>
        </PressHighlight>
        {item.comment ? (
          <Text
            style={styles.comment}
            selectable={!clampComment}
            numberOfLines={clampComment ? 2 : undefined}
            testID={`${testPrefix}-comment`}
          >
            {item.comment}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <ToolbarButton
          compact
          onPress={toggle}
          label={t(
            expanded ? "composer.attachments.collapseQuote" : "composer.attachments.expandQuote",
          )}
          testID={`${testPrefix}-expand`}
        >
          {expanded ? collapseIcon : expandIcon}
        </ToolbarButton>
        {item.onChangeComment ? (
          <ToolbarButton
            compact
            onPress={openSheet}
            disabled={disabled}
            label={t("composer.attachments.editQuoteComment")}
            testID={`${testPrefix}-edit`}
          >
            {editIcon}
          </ToolbarButton>
        ) : null}
        {item.onRemove ? (
          <ToolbarButton
            compact
            onPress={item.onRemove}
            disabled={disabled}
            label={t("composer.attachments.removeChatQuote")}
            testID={`${testPrefix}-remove`}
          >
            {removeIcon}
          </ToolbarButton>
        ) : null}
      </View>
      {item.onChangeComment ? (
        <AdaptiveModalSheet header={header} visible={sheetOpen} onClose={closeSheet}>
          <View style={styles.sheet}>
            <Text style={styles.sheetSource}>{item.sourceLabel}</Text>
            <Text style={styles.sheetQuote} selectable>
              {item.text}
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
      ) : null}
    </View>
  );
}

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChat = withUnistyles(MessageSquareQuote, mutedIcon);
const ThemedFile = withUnistyles(FileText, mutedIcon);
const ThemedDown = withUnistyles(ChevronDown, mutedIcon);
const ThemedRight = withUnistyles(ChevronRight, mutedIcon);
const ThemedPencil = withUnistyles(Pencil, mutedIcon);
const ThemedX = withUnistyles(X, mutedIcon);
const chatIcon = <ThemedChat size={ICON_SIZE.sm} />;
const artifactIcon = <ThemedFile size={ICON_SIZE.sm} />;
const expandIcon = <ThemedRight size={ICON_SIZE.sm} />;
const collapseIcon = <ThemedDown size={ICON_SIZE.sm} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} />;
const removeIcon = <ThemedX size={ICON_SIZE.sm} />;

const styles = StyleSheet.create((theme) => ({
  stack: {
    width: "100%",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  header: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm - 1,
  },
  scroll: {
    maxHeight: 176,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  gutter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 24,
  },
  number: {
    minWidth: 10,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm - 1,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  kindIcon: {
    opacity: 0.8,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: 3,
  },
  excerptPress: {
    borderRadius: theme.borderRadius.sm,
  },
  source: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
  },
  excerpt: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  comment: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  sheet: {
    gap: theme.spacing[3],
  },
  sheetSource: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
