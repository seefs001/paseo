import type { EditorView } from "@codemirror/view";
import type { FileReferenceSelection } from "./toolbar.web";

export function readSourceReferenceSelection(
  view: EditorView | null,
): FileReferenceSelection | null {
  const selection = window.getSelection();
  if (!view || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const insideSource =
    view.contentDOM.contains(range.startContainer) && view.contentDOM.contains(range.endContainer);
  if (!insideSource) return null;

  const start = view.posAtDOM(range.startContainer, range.startOffset);
  const end = view.posAtDOM(range.endContainer, range.endOffset);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    lineStart: view.state.doc.lineAt(from).number,
    // A selection ending at the start of the next line does not quote that next line.
    lineEnd: view.state.doc.lineAt(to - 1).number,
    anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}
