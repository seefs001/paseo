import { useRef, useSyncExternalStore } from "react";

const CHAT_SCROLL_SELECTOR = '[data-testid="agent-chat-scroll"]';
const CONTROL_SELECTOR = "button, input, textarea, select, [role='button']";

let held = false;
let pointerIsDown = false;
const listeners = new Set<() => void>();
let installed = false;

function canHoldDomSelection(): boolean {
  return typeof document !== "undefined" && typeof document.addEventListener === "function";
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/** Text inside the chat feed. Presses on the scroller itself and on controls are not selections. */
export function isChatTextSelectionTarget(target: EventTarget | null): boolean {
  const element = targetElement(target);
  if (!element) return false;
  const scroll = element.closest(CHAT_SCROLL_SELECTOR);
  if (!scroll || element === scroll) return false;
  if (element.closest(CONTROL_SELECTOR)) return false;
  return true;
}

function selectionInsideChat(): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return isChatTextSelectionTarget(anchor) || isChatTextSelectionTarget(focus);
}

function setHeld(next: boolean): void {
  if (held === next) return;
  held = next;
  for (const listener of listeners) listener();
}

function releaseIfSelectionGone(): void {
  if (!pointerIsDown && !selectionInsideChat()) setHeld(false);
}

function ensureInstalled(): void {
  if (installed || !canHoldDomSelection()) return;
  installed = true;

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (!isChatTextSelectionTarget(event.target)) return;
      pointerIsDown = true;
      setHeld(true);
    },
    true,
  );

  const endPointer = () => {
    if (!pointerIsDown) return;
    pointerIsDown = false;
    // mouseup can update the selection after the event. Wait one microtask.
    queueMicrotask(releaseIfSelectionGone);
  };
  document.addEventListener("pointerup", endPointer, true);
  document.addEventListener("pointercancel", endPointer, true);
  document.addEventListener("selectionchange", () => {
    if (selectionInsideChat()) setHeld(true);
    else releaseIfSelectionGone();
  });
}

// Focus decisions need the live selection: the reveal snapshot can outlast removeAllRanges()
// until the browser dispatches selectionchange.
export function isChatTextSelectionActive(): boolean {
  return canHoldDomSelection() && (pointerIsDown || selectionInsideChat());
}

export function isTextSelectionHoldingReveal(): boolean {
  return held;
}

export function subscribeTextSelectionHold(listener: () => void): () => void {
  if (!canHoldDomSelection()) return () => {};
  listeners.add(listener);
  ensureInstalled();
  return () => {
    listeners.delete(listener);
  };
}

/** Keep the string that was on screen when a chat text selection started. */
export function useTextStableDuringSelection(text: string): string {
  const hold = useSyncExternalStore(
    subscribeTextSelectionHold,
    isTextSelectionHoldingReveal,
    () => false,
  );
  const frozenRef = useRef(text);
  if (!hold) frozenRef.current = text;
  return hold ? frozenRef.current : text;
}
