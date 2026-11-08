import { Fragment, useCallback, useMemo } from "react";
import { Text } from "react-native";
import { isWeb } from "@/constants/platform";
import { StyleSheet } from "react-native-unistyles";
import type { MessageReference } from "./model";

/** A quote written into the message, as a range of the decoded text. */
export interface MessageQuote {
  key: string;
  start: number;
  end: number;
  /** Opens where the quote came from; absent when the source is unknown. */
  onOpen?: () => void;
  accessibilityLabel?: string;
  testID: string;
}

interface ProfileReferenceMessageProps {
  text: string;
  references: MessageReference[];
  onOpenReference: (reference: MessageReference) => void;
  quotes?: readonly MessageQuote[];
}

type Segment =
  | { kind: "reference"; start: number; end: number; reference: MessageReference }
  | { kind: "quote"; start: number; end: number; quote: MessageQuote };

function segments(references: MessageReference[], quotes: readonly MessageQuote[]): Segment[] {
  const all: Segment[] = [
    ...references.map((reference) => ({
      kind: "reference" as const,
      start: reference.start,
      end: reference.end,
      reference,
    })),
    ...quotes.map((quote) => ({
      kind: "quote" as const,
      start: quote.start,
      end: quote.end,
      quote,
    })),
  ].sort((left, right) => left.start - right.start);
  let end = 0;
  return all.filter((segment) => {
    if (segment.start < end) return false;
    end = segment.end;
    return true;
  });
}

export function ProfileReferenceMessage({
  text,
  references,
  onOpenReference,
  quotes = [],
}: ProfileReferenceMessageProps) {
  let offset = 0;
  const content = segments(references, quotes).map((segment) => {
    const precedingText = text.slice(offset, segment.start);
    offset = segment.end;
    const label = text.slice(segment.start, segment.end);
    return (
      <Fragment key={`${segment.kind}:${segment.start}`}>
        {precedingText}
        {segment.kind === "reference" ? (
          <ProfileReferenceText
            reference={segment.reference}
            onOpenReference={onOpenReference}
            label={label}
          />
        ) : (
          <QuoteText quote={segment.quote} label={label} />
        )}
      </Fragment>
    );
  });

  return (
    <>
      {content}
      {text.slice(offset)}
    </>
  );
}

interface ProfileReferenceTextProps {
  reference: MessageReference;
  label: string;
  onOpenReference: (reference: MessageReference) => void;
}

function referenceTestKind(reference: MessageReference): string {
  const inline = reference.reference;
  return inline.kind === "resource_link" ? inline.resource : inline.kind.replace("_reference", "");
}

function ProfileReferenceText({ reference, label, onOpenReference }: ProfileReferenceTextProps) {
  const handlePress = useCallback(() => {
    onOpenReference(reference);
  }, [onOpenReference, reference]);
  const dataSet = useMemo(
    () => ({ paseoReferenceMarkdown: reference.markdown, paseoReferenceLabel: label }),
    [label, reference],
  );

  return (
    <Text
      style={styles.reference}
      onPress={handlePress}
      accessibilityRole="button"
      dataSet={dataSet}
      testID={`user-message-${referenceTestKind(reference)}-reference`}
    >
      {label}
    </Text>
  );
}

/** Selecting quoted text must not open its source: a click that ends a selection does nothing. */
function selectionIsActive(): boolean {
  if (!isWeb || typeof window === "undefined") return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

function QuoteText({ quote, label }: { quote: MessageQuote; label: string }) {
  const { onOpen } = quote;
  const handlePress = useCallback(() => {
    if (selectionIsActive()) return;
    onOpen?.();
  }, [onOpen]);
  return (
    <Text
      style={[styles.quote, isWeb ? webQuoteStyle : null]}
      onPress={onOpen ? handlePress : undefined}
      accessibilityRole={onOpen ? "link" : undefined}
      accessibilityLabel={quote.accessibilityLabel}
      testID={quote.testID}
    >
      {label}
    </Text>
  );
}

// A bar on every line the quote wraps to; React Native has no inline borders.
const webQuoteStyle = {
  boxShadow: "inset 2px 0 0 var(--colors-border-accent, var(--colors-border))",
  boxDecorationBreak: "clone",
  WebkitBoxDecorationBreak: "clone",
  paddingLeft: 6,
  cursor: "pointer",
} as object;

const styles = StyleSheet.create((theme) => ({
  quote: {
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface0,
  },
  reference: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
