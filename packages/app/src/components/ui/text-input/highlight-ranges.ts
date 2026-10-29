import type { EditingTextInputProps } from "./types";

interface HighlightedTextPart {
  start: number;
  text: string;
  highlighted: boolean;
}

export function splitHighlightedText(
  text: string,
  highlights: NonNullable<EditingTextInputProps["highlights"]>,
): HighlightedTextPart[] {
  const parts: HighlightedTextPart[] = [];
  let cursor = 0;
  for (const range of [...highlights].sort((a, b) => a.start - b.start)) {
    // DOM text can be newer than the parent's ranges during composition/publication.
    const start = Math.max(cursor, range.start);
    const end = Math.min(text.length, range.end);
    if (end <= start) continue;
    if (start > cursor) {
      parts.push({ start: cursor, text: text.slice(cursor, start), highlighted: false });
    }
    parts.push({ start, text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push({ start: cursor, text: text.slice(cursor), highlighted: false });
  }
  return parts;
}
