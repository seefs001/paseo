import { useCallback, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";

const REFERENCE_MARKDOWN_ATTRIBUTE = "data-paseo-reference-markdown";
const REFERENCE_LABEL_ATTRIBUTE = "data-paseo-reference-label";
const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

/**
 * A rendered reference shows only its label. When a selection covers a whole reference, the
 * copied text gets the reference's Markdown link back, so pasting it keeps the resource.
 */
/**
 * The label's span measured from its first to its last text character. A selection made by
 * dragging over the label starts and ends inside the text node, which the DOM orders after
 * the element's own content boundaries, so those cannot be compared directly.
 */
function labelTextRange(element: Element): Range | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (!first) return null;
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
  const range = element.ownerDocument.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.textContent?.length ?? 0);
  return range;
}

export function ReferenceCopySurface({ children }: { children: ReactNode }) {
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const root = event.currentTarget;
    if (!root.contains(range.commonAncestorContainer)) return;
    // Measure against the live DOM: a selection inside one reference's text node clones to a
    // bare Text node that has lost the reference's attributes.
    let text = range.toString();
    let changed = false;
    const references = Array.from(root.querySelectorAll(`[${REFERENCE_MARKDOWN_ATTRIBUTE}]`));
    for (const element of references.toReversed()) {
      const markdown = element.getAttribute(REFERENCE_MARKDOWN_ATTRIBUTE);
      const label = element.getAttribute(REFERENCE_LABEL_ATTRIBUTE);
      if (!markdown || label === null || element.textContent !== label) continue;
      const contents = labelTextRange(element);
      if (!contents) continue;
      const coversElement =
        range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0;
      if (!coversElement) continue;
      const before = element.ownerDocument.createRange();
      before.setStart(range.startContainer, range.startOffset);
      before.setEnd(contents.startContainer, contents.startOffset);
      const offset = before.toString().length;
      if (text.slice(offset, offset + label.length) !== label) continue;
      text = text.slice(0, offset) + markdown + text.slice(offset + label.length);
      changed = true;
    }
    if (!changed) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }, []);

  return (
    <div onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      {children}
    </div>
  );
}
