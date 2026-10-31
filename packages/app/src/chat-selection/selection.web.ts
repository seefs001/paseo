import type { Rect } from "@/components/ui/anchor";
import { createAssistantSelectionClipboardContent } from "@/assistant-selection-copy/content.web";
import type { ChatTextSelection } from "./types";

export interface AnchoredChatTextSelection extends ChatTextSelection {
  anchor: Rect;
}

function assistantMessage(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('[data-testid="assistant-message"]') ?? null;
}

export function readChatTextSelection(root: HTMLElement): AnchoredChatTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const message = assistantMessage(range.startContainer);
  const sameMessage = message !== null && message === assistantMessage(range.endContainer);
  if (!sameMessage || !root.contains(message)) return null;

  const messageId = message.closest("[data-message-id]")?.getAttribute("data-message-id");
  if (!messageId) return null;
  const content = createAssistantSelectionClipboardContent(selection);
  if (!content) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    messageId,
    text: content.plainText,
    anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}
