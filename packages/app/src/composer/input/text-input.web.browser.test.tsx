import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { EditingTextInput as ComposerTextInput } from "@/components/ui/text-input/text-input.web";
import type { EditingTextInputHandle as ComposerTextInputHandle } from "@/components/ui/text-input";
import type { EditingTextInputProps } from "@/components/ui/text-input/types";
import { lightTheme, darkTheme } from "@/styles/theme";

interface MountedInput {
  root: Root;
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  inputRef: React.MutableRefObject<ComposerTextInputHandle | null>;
}

interface TextRecorder {
  changes: string[];
  onChangeText: (text: string) => void;
}

const mountedInputs: MountedInput[] = [];

function mountInput(
  onChangeText: NonNullable<EditingTextInputProps["onChangeText"]>,
  inputRef: React.MutableRefObject<ComposerTextInputHandle | null> = React.createRef(),
  props: Partial<EditingTextInputProps> = {},
): MountedInput {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.style.position = "relative";
  container.style.setProperty(
    "--colors-interaction-highlight",
    lightTheme.colors.interactionHighlight,
  );
  const root = createRoot(container);

  act(() => {
    root.render(
      <ComposerTextInput
        ref={inputRef}
        initialValue=""
        multiline={true}
        onChangeText={onChangeText}
        testID="composer-input"
        {...props}
      />,
    );
  });

  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Composer text input did not render a textarea");
  }

  const mounted = { root, container, textarea, inputRef };
  mountedInputs.push(mounted);
  return mounted;
}

function dispatchComposition(
  textarea: HTMLTextAreaElement,
  type: "compositionstart" | "compositionend",
) {
  textarea.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

function typeFromIme(textarea: HTMLTextAreaElement, text: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("HTML textarea value setter is unavailable");
  }
  valueSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

function ignoreTextChange(): void {}

function createTextRecorder(): TextRecorder {
  const changes: string[] = [];
  return {
    changes,
    onChangeText: (text) => changes.push(text),
  };
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

function getHighlights(mounted: MountedInput): HTMLElement {
  const overlay = mounted.container.querySelector<HTMLElement>("[data-text-input-highlights]");
  if (!overlay) throw new Error("Expected text highlight background");
  return overlay;
}

function getMirror(mounted: MountedInput): HTMLElement {
  const mirror = getHighlights(mounted).firstElementChild;
  if (!(mirror instanceof HTMLElement)) throw new Error("Expected text highlight mirror");
  return mirror;
}

describe("ComposerTextInput web highlights", () => {
  it("opens a highlight from a collapsed caret press, not from the boundary before it or a range selection", () => {
    const onHighlightPress = vi.fn();
    const mounted = mountInput(ignoreTextChange, React.createRef(), {
      initialValue: "😀 请用 #Claude Opus 继续",
      highlights: [{ start: 6, end: 18 }],
      onHighlightPress,
    });
    function clickAt(start: number, end = start) {
      act(() => {
        mounted.textarea.focus();
        mounted.textarea.setSelectionRange(start, end);
        mounted.textarea.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    clickAt(6);
    clickAt(10);
    clickAt(18);
    clickAt(8, 14);

    expect(onHighlightPress.mock.calls).toEqual([[10], [18]]);
  });

  it("does not add a layout wrapper or overlay when highlights are absent", () => {
    const mounted = mountInput(ignoreTextChange);
    expect(Array.from(mounted.container.children)).toEqual([mounted.textarea]);
  });

  it("highlights UTF-16 ranges without changing text, selection, focus or the editing handle", () => {
    const initialValue = "😀 请用 #Claude Opus 继续";
    const highlights = [{ start: 6, end: 18 }];
    const mounted = mountInput(ignoreTextChange, React.createRef(), { initialValue, highlights });
    const handle = mounted.inputRef.current;
    const overlay = getHighlights(mounted);
    const span = overlay.querySelector("span");
    if (!span) throw new Error("Expected highlighted text");
    expect(overlay.textContent).toBe(initialValue);
    expect(span.textContent).toBe(initialValue.slice(6, 18));
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(window.getComputedStyle(overlay).pointerEvents).toBe("none");
    expect(window.getComputedStyle(span).color).toBe("rgba(0, 0, 0, 0)");
    expect(window.getComputedStyle(span).backgroundColor).toBe(
      lightTheme.colors.interactionHighlight,
    );
    mounted.container.style.setProperty(
      "--colors-interaction-highlight",
      darkTheme.colors.interactionHighlight,
    );
    expect(window.getComputedStyle(span).backgroundColor).toBe(
      darkTheme.colors.interactionHighlight,
    );

    act(() => {
      handle?.focus();
      handle?.replaceText("😀 #New Profile", { start: 3, end: 7 });
    });
    expect(overlay.textContent).toBe(mounted.textarea.value);
    expect(handle?.getText()).toBe("😀 #New Profile");
    expect([mounted.textarea.selectionStart, mounted.textarea.selectionEnd]).toEqual([3, 7]);
    expect(document.activeElement).toBe(mounted.textarea);
    act(() => handle?.setSelection({ start: 2, end: 2 }));
    expect(mounted.textarea.selectionStart).toBe(2);

    act(() => handle?.reset());
    expect(overlay.textContent).toBe("");
    expect(mounted.textarea.value).toBe("");
    expect(mounted.inputRef.current).toBe(handle);
    expect(handle?.getNativeRef()).toBe(mounted.textarea);
    expect(document.activeElement).toBe(mounted.textarea);
  });

  it("follows live IME candidates and range updates without publishing or replacing the input", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText, React.createRef(), {
      highlights: [{ start: 0, end: 2 }],
    });
    const handle = mounted.inputRef.current;
    act(() => {
      handle?.focus();
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "你");
    });
    expect(getHighlights(mounted).textContent).toBe("你");
    act(() => typeFromIme(mounted.textarea, "你好"));
    expect(getHighlights(mounted).textContent).toBe("你好");
    expect(recorder.changes).toEqual([]);
    act(() => {
      mounted.textarea.setSelectionRange(1, 2);
      mounted.root.render(
        <ComposerTextInput
          ref={mounted.inputRef}
          initialValue="stale publication"
          multiline
          highlights={[{ start: 1, end: 2 }]}
          onChangeText={recorder.onChangeText}
        />,
      );
    });
    expect(getHighlights(mounted).querySelector("span")?.textContent).toBe("好");
    expect(mounted.textarea.value).toBe("你好");
    expect([mounted.textarea.selectionStart, mounted.textarea.selectionEnd]).toEqual([1, 2]);
    expect(document.activeElement).toBe(mounted.textarea);
    expect(mounted.inputRef.current).toBe(handle);
    expect(recorder.changes).toEqual([]);
    act(() => dispatchComposition(mounted.textarea, "compositionend"));
    expect(recorder.changes).toEqual(["你好"]);
    act(() => {
      mounted.root.render(<ComposerTextInput ref={mounted.inputRef} multiline highlights={[]} />);
    });
    expect(Array.from(mounted.container.children)).toEqual([mounted.textarea]);
    expect(mounted.textarea.value).toBe("你好");
    expect(document.activeElement).toBe(mounted.textarea);
  });

  it("mirrors text metrics, resize and both scroll axes without intercepting pointer targets", async () => {
    const text = `${"请用 #Claude Opus 继续 ".repeat(12)}\n`.repeat(8);
    const mounted = mountInput(ignoreTextChange, React.createRef(), {
      initialValue: text,
      highlights: [{ start: 3, end: 15 }],
      style: {
        width: 240,
        height: 100,
        padding: 8,
        borderWidth: 2,
        fontSize: 16,
        lineHeight: 24,
        fontFamily: "monospace",
      },
    });
    const overlay = getHighlights(mounted);
    const mirror = getMirror(mounted);
    const textareaStyle = window.getComputedStyle(mounted.textarea);
    const mirrorStyle = window.getComputedStyle(mirror);
    for (const property of [
      "fontFamily",
      "fontSize",
      "lineHeight",
      "paddingTop",
      "paddingLeft",
      "whiteSpace",
    ] as const) {
      expect(mirrorStyle[property]).toBe(textareaStyle[property]);
    }
    expect(overlay.clientWidth).toBe(mounted.textarea.clientWidth);
    expect(overlay.clientHeight).toBe(mounted.textarea.clientHeight);
    const rect = mounted.textarea.getBoundingClientRect();
    expect(overlay.getBoundingClientRect().left).toBe(rect.left + mounted.textarea.clientLeft);
    expect(overlay.getBoundingClientRect().top).toBe(rect.top + mounted.textarea.clientTop);
    expect(document.elementFromPoint(rect.left + 12, rect.top + 12)).toBe(mounted.textarea);
    mounted.textarea.scrollTop = 48;
    mounted.textarea.dispatchEvent(new Event("scroll"));
    expect(mirror.style.transform).toBe("translate(0px, -48px)");

    mounted.textarea.style.width = "180px";
    await expect.poll(() => overlay.clientWidth).toBe(mounted.textarea.clientWidth);
    mounted.textarea.style.whiteSpace = "pre";
    await expect.poll(() => window.getComputedStyle(mirror).whiteSpace).toBe("pre");
    mounted.textarea.scrollLeft = 40;
    mounted.textarea.dispatchEvent(new Event("scroll"));
    expect(mounted.textarea.scrollLeft).toBe(40);
    expect(mirror.style.transform).toBe(`translate(-40px, ${-mounted.textarea.scrollTop}px)`);
    expect(overlay.textContent).toBe(text);
  });
});

describe("ComposerTextInput web editing selections", () => {
  it("reports the selected occurrence when deleting the first of identical tokens", async () => {
    const onChangeText = vi.fn();
    const mounted = mountInput(onChangeText, React.createRef(), { initialValue: "#A #A" });
    act(() => {
      mounted.inputRef.current?.focus();
      mounted.textarea.setSelectionRange(0, 3);
    });

    await act(async () => userEvent.keyboard("{Backspace}"));

    expect(mounted.textarea.value).toBe("#A");
    expect(onChangeText).toHaveBeenCalledExactlyOnceWith("#A", { start: 0, end: 3 });
  });

  it("reports the original composition selection instead of intermediate candidate selections", () => {
    const onChangeText = vi.fn();
    const mounted = mountInput(onChangeText, React.createRef(), { initialValue: "#A #A" });
    act(() => {
      mounted.inputRef.current?.focus();
      mounted.textarea.setSelectionRange(0, 3);
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "你#A");
      mounted.textarea.setSelectionRange(0, 1);
      mounted.textarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
      typeFromIme(mounted.textarea, "你好#A");
    });
    expect(onChangeText).not.toHaveBeenCalled();
    act(() => dispatchComposition(mounted.textarea, "compositionend"));
    expect(onChangeText).toHaveBeenCalledExactlyOnceWith("你好#A", { start: 0, end: 3 });
  });

  it.each(["replaceText", "reset"] as const)(
    "clears pending editing selections on %s",
    (operation) => {
      const onChangeText = vi.fn();
      const mounted = mountInput(onChangeText, React.createRef(), { initialValue: "#A #A" });
      act(() => {
        mounted.textarea.setSelectionRange(0, 3);
        mounted.textarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
        if (operation === "replaceText") {
          mounted.inputRef.current?.replaceText("");
        } else {
          mounted.inputRef.current?.reset();
        }
        typeFromIme(mounted.textarea, "new text");
      });
      expect(onChangeText).toHaveBeenCalledExactlyOnceWith("new text", undefined);
    },
  );
});

describe("ComposerTextInput web IME composition", () => {
  it("resets the composer text while preserving focus", () => {
    const mounted = mountInput(ignoreTextChange);
    act(() => {
      mounted.inputRef.current?.focus();
      typeFromIme(mounted.textarea, "line one\nline two");
    });

    act(() => mounted.inputRef.current?.reset());

    expect(mounted.textarea.value).toBe("");
    expect(mounted.inputRef.current?.getText()).toBe("");
    expect(document.activeElement).toBe(mounted.textarea);
  });

  it("keeps its editing handle and selection across a rerender during composition", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText);
    const handle = mounted.inputRef.current;
    act(() => {
      handle?.focus();
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "你好");
      mounted.textarea.setSelectionRange(1, 2);
      mounted.root.render(
        <ComposerTextInput
          ref={mounted.inputRef}
          initialValue="stale publication"
          multiline
          onChangeText={recorder.onChangeText}
          placeholder="updated presentation"
        />,
      );
    });
    expect(mounted.inputRef.current).toBe(handle);
    expect(handle?.getNativeRef()).toBe(mounted.textarea);
    expect([mounted.textarea.selectionStart, mounted.textarea.selectionEnd]).toEqual([1, 2]);
    expect(document.activeElement).toBe(mounted.textarea);
    expect(recorder.changes).toEqual([]);
    act(() => dispatchComposition(mounted.textarea, "compositionend"));
    expect(recorder.changes).toEqual(["你好"]);
    expect(handle?.getText()).toBe("你好");
  });

  it("keeps locally typed text when its parent rerenders with a stale value", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText);

    act(() => {
      typeFromIme(mounted.textarea, "locally typed");
      mounted.root.render(
        <ComposerTextInput
          initialValue=""
          multiline={true}
          onChangeText={recorder.onChangeText}
          placeholder="rerender with stale publication"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("locally typed");
    expect(recorder.changes).toEqual(["locally typed"]);
  });

  it("keeps the DOM-owned candidate during composition and reports the committed text", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你好";
      mounted.root.render(
        <ComposerTextInput
          initialValue=""
          multiline={true}
          onChangeText={recorder.onChangeText}
          placeholder="rerender while composing"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("你好");

    act(() => {
      dispatchComposition(mounted.textarea, "compositionend");
    });

    expect(recorder.changes).toEqual(["你好"]);
  });

  it("keeps the latest candidate across consecutive compositions", () => {
    const mounted = mountInput(ignoreTextChange);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你";
      dispatchComposition(mounted.textarea, "compositionend");
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你好";
      mounted.root.render(
        <ComposerTextInput
          initialValue="你"
          multiline={true}
          onChangeText={ignoreTextChange}
          placeholder="second composition"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("你好");
  });

  it("defers Korean IME input events until composition commits", () => {
    const changes: string[] = [];
    const mounted = mountInput((text) => changes.push(text));

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "ㅎ");
      typeFromIme(mounted.textarea, "하");
      typeFromIme(mounted.textarea, "한");
    });

    expect(changes).toEqual([]);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionend");
    });

    expect(changes).toEqual(["한"]);
  });

  it("reads the live DOM value for send-path text extraction during composition", () => {
    const inputRef = React.createRef<ComposerTextInputHandle>();
    const mounted = mountInput(ignoreTextChange, inputRef);
    let queuedText = "";

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "old한");
      queuedText = mounted.inputRef.current?.getText() ?? "";
    });

    expect(queuedText).toBe("old한");
    expect(mounted.textarea.value).toBe("old한");

    act(() => {
      mounted.inputRef.current?.replaceText("");
    });

    expect(mounted.textarea.value).toBe("");
  });
});
