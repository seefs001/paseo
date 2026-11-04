import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Text, View, type TextInputKeyPressEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { computePosition } from "@/components/ui/anchor";
import { FormTextInput } from "@/components/ui/form-field";
import {
  getOverlayRoot,
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
import type { AnchoredChatTextSelection } from "./selection.web";

interface ChatQuoteCommentCardProps {
  selection: AnchoredChatTextSelection;
  /** Adds the quote with the typed comment; an empty comment adds a plain quote. */
  onCommit: (comment: string) => void;
  onDiscard: () => void;
}

const CARD_WIDTH = 320;

/**
 * Comment step of "Add to conversation". Enter or a press outside adds the quote,
 * Shift+Enter adds a line, Escape drops it.
 */
export function ChatQuoteCommentCard({
  selection,
  onCommit,
  onDiscard,
}: ChatQuoteCommentCardProps) {
  const { t } = useTranslation();
  const layer = useOverlayLayer("floating");
  const cardRef = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState("");
  const commentRef = useRef(comment);
  commentRef.current = comment;
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      onDiscard();
      return true;
    },
    [onDiscard],
  );
  const registerOverlay = useWebOverlayRegistration({ active: true, layer, onKeyDown });
  const setCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      registerOverlay(node);
    },
    [registerOverlay],
  );

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      onCommit(commentRef.current);
    };
    document.addEventListener("pointerdown", pointerDown, true);
    return () => document.removeEventListener("pointerdown", pointerDown, true);
  }, [onCommit]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const next = computePosition({
      triggerRect: selection.anchor,
      contentSize: { width: rect.width, height: rect.height },
      displayArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      placement: "bottom",
      alignment: "start",
      offset: 8,
    });
    setPosition({ x: next.x, y: next.y });
  }, [selection.anchor]);

  const handleKeyPress = useCallback(
    (event: TextInputKeyPressEvent) => {
      const native = event.nativeEvent as TextInputKeyPressEvent["nativeEvent"] & {
        shiftKey?: boolean;
        isComposing?: boolean;
      };
      if (native.key !== "Enter" || native.shiftKey || native.isComposing) return;
      event.preventDefault();
      onCommit(commentRef.current);
    },
    [onCommit],
  );

  const frameStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      left: position?.x ?? -9999,
      top: position?.y ?? -9999,
      visibility: position ? "visible" : "hidden",
      width: CARD_WIDTH,
      maxWidth: "calc(100vw - 16px)",
      pointerEvents: "auto",
      zIndex: layer,
    }),
    [position, layer],
  );
  const preview = selection.text.replace(/\s+/g, " ").trim();

  return createPortal(
    <OverlayLayerProvider layer={layer}>
      <div
        ref={setCardRef}
        role="dialog"
        aria-label={t("message.selection.commentLabel")}
        data-testid="chat-quote-comment-card"
        style={frameStyle}
      >
        <View style={styles.card}>
          <Text style={styles.quote} numberOfLines={2}>
            {`“${preview}”`}
          </Text>
          <FormTextInput
            testID="chat-quote-comment-card-input"
            initialValue=""
            onChangeText={setComment}
            onKeyPress={handleKeyPress}
            multiline
            autoFocus
            size="sm"
            placeholder={t("message.selection.commentPlaceholder")}
            style={styles.input}
          />
          <Text style={styles.hint}>{t("message.selection.commentHint")}</Text>
        </View>
      </div>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadow.md,
  },
  quote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  input: {
    minHeight: 56,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
