import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { splitHighlightedText } from "./highlight-ranges";
import type { EditingTextInputProps } from "./types";

// The same text metrics as composer/input/height.web.ts, plus horizontal alignment.
const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
  "wordBreak",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "textAlign",
  "direction",
] as const;

export function useTextInputHighlights(
  inputRef: RefObject<unknown>,
  highlights: EditingTextInputProps["highlights"],
): () => void {
  const refreshRef = useRef<(() => void) | null>(null);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const enabled = Boolean(highlights?.length);

  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!enabled || !(element instanceof HTMLTextAreaElement)) return;
    const input = element;

    // A positioned sibling leaves the textarea's flex sizing, ref and identity untouched.
    // Paint before the textarea so its glyphs, caret and IME decorations stay on top.
    const viewport = document.createElement("div");
    viewport.setAttribute("aria-hidden", "true");
    viewport.dataset.textInputHighlights = "true";
    Object.assign(viewport.style, {
      position: "absolute",
      pointerEvents: "none",
      userSelect: "none",
      overflow: "hidden",
      color: "transparent",
    });
    const mirror = document.createElement("div");
    Object.assign(mirror.style, { boxSizing: "border-box", margin: "0", border: "0" });
    viewport.append(mirror);
    input.before(viewport);

    function syncScroll() {
      mirror.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    }

    function syncLayout() {
      const computed = window.getComputedStyle(input);
      for (const property of COPIED_STYLES) {
        mirror.style[property] = computed[property];
      }
      viewport.style.top = `${input.offsetTop + input.clientTop}px`;
      viewport.style.left = `${input.offsetLeft + input.clientLeft}px`;
      viewport.style.width = `${input.clientWidth}px`;
      viewport.style.height = `${input.clientHeight}px`;
      mirror.style.width = `${input.clientWidth}px`;
      mirror.style.minHeight = `${input.scrollHeight}px`;
      syncScroll();
    }

    function refresh() {
      const fragment = document.createDocumentFragment();
      for (const part of splitHighlightedText(input.value, highlightsRef.current ?? [])) {
        if (part.highlighted) {
          const span = document.createElement("span");
          // Unistyles' live CSS token follows theme changes without subscribing the editor.
          span.style.backgroundColor = "var(--colors-interaction-highlight)";
          span.textContent = part.text;
          fragment.append(span);
        } else {
          fragment.append(document.createTextNode(part.text));
        }
      }
      mirror.replaceChildren(fragment);
      syncLayout();
    }

    refreshRef.current = refresh;
    refresh();
    input.addEventListener("input", refresh);
    input.addEventListener("compositionend", refresh);
    input.addEventListener("scroll", syncScroll);
    const resizeObserver = new ResizeObserver(syncLayout);
    resizeObserver.observe(input);
    const styleObserver = new MutationObserver(syncLayout);
    styleObserver.observe(input, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      refreshRef.current = null;
      input.removeEventListener("input", refresh);
      input.removeEventListener("compositionend", refresh);
      input.removeEventListener("scroll", syncScroll);
      resizeObserver.disconnect();
      styleObserver.disconnect();
      viewport.remove();
    };
  }, [enabled, inputRef]);

  useLayoutEffect(() => {
    refreshRef.current?.();
  });

  return useCallback(() => refreshRef.current?.(), []);
}
