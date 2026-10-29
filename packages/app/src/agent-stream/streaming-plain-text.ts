/**
 * Completed lines stay in `head`. The open line stays in `tail`.
 * Returns null when there is no completed line, so the caller keeps one text view.
 */
export function splitLivePlainText(text: string): { head: string; tail: string } | null {
  const boundary = text.lastIndexOf("\n") + 1;
  if (boundary === 0) return null;
  return { head: text.slice(0, boundary - 1), tail: text.slice(boundary) };
}
