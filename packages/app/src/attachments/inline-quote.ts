import type {
  ArtifactQuoteContextAttachment,
  ChatQuoteContextAttachment,
} from "@/attachments/types";

export type ComposerQuote = ChatQuoteContextAttachment | ArtifactQuoteContextAttachment;
export type InlineQuote = ComposerQuote & { start: number; end: number };

export function isComposerQuote(attachment: { kind: string }): attachment is ComposerQuote {
  return attachment.kind === "chat_quote" || attachment.kind === "artifact_quote";
}

/** A quote written into the draft text. Quotes from before inline quoting carry no range. */
export function isInlineQuote(attachment: { kind: string }): attachment is InlineQuote {
  return (
    isComposerQuote(attachment) &&
    typeof attachment.start === "number" &&
    typeof attachment.end === "number"
  );
}

/** The range still holds exactly the quoted text; an edit inside it turns it into plain text. */
export function isValidInlineQuote(text: string, quote: InlineQuote): boolean {
  return (
    quote.start >= 0 &&
    quote.end > quote.start &&
    quote.end <= text.length &&
    text.slice(quote.start, quote.end) === quote.selectedText
  );
}

interface TextRange {
  start: number;
  end: number;
}

/** The live selection of each mounted composer, by draft key. Not persisted. */
const composerSelections = new Map<string, TextRange>();
/** Where the caret goes after a quote was written into a draft, by draft key. */
const pendingCarets = new Map<string, TextRange>();

export function reportComposerSelection(draftKey: string, selection: TextRange | null): void {
  if (selection) composerSelections.set(draftKey, selection);
  else composerSelections.delete(draftKey);
}

export function takeQuoteCaret(draftKey: string): TextRange | undefined {
  const caret = pendingCarets.get(draftKey);
  pendingCarets.delete(draftKey);
  return caret;
}

/**
 * Writes a quote into the draft text on its own lines, replacing the selection of the composer
 * showing this draft, or at the end when no composer is showing it. The comment follows as
 * plain text the user can keep editing.
 */
export function insertInlineQuote<T extends ComposerQuote>(input: {
  draftKey: string;
  text: string;
  quote: T;
}): { text: string; quote: T & TextRange; replaced: TextRange } {
  const { text, quote } = input;
  const reported = composerSelections.get(input.draftKey);
  const valid =
    reported &&
    reported.start >= 0 &&
    reported.end >= reported.start &&
    reported.end <= text.length;
  const replaced = valid ? reported : { start: text.length, end: text.length };
  const before = text.slice(0, replaced.start);
  const after = text.slice(replaced.end);
  const { comment, ...rest } = quote;
  const quoted = quote.selectedText.replace(/\r\n/g, "\n");
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const note = comment?.trim() ? `\n${comment.trim()}` : "";
  const trail = after.startsWith("\n") ? "" : "\n";
  const block = `${lead}${quoted}${note}${trail}`;
  const start = before.length + lead.length;
  const caret = before.length + block.length - trail.length;
  pendingCarets.set(input.draftKey, { start: caret, end: caret });
  return {
    text: `${before}${block}${after}`,
    quote: { ...(rest as T), selectedText: quoted, start, end: start + quoted.length } as T &
      TextRange,
    replaced,
  };
}

/** Removes a quote and the line break after it from the text, shifting later ranges. */
export function removeInlineQuoteText(
  text: string,
  quote: InlineQuote,
): { text: string; start: number; removed: number } {
  const end = text[quote.end] === "\n" ? quote.end + 1 : quote.end;
  return {
    text: text.slice(0, quote.start) + text.slice(end),
    start: quote.start,
    removed: end - quote.start,
  };
}
