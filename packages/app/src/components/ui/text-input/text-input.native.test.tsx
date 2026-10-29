// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomSheetScope } from "@/components/ui/bottom-sheet-scope";
import { EditingTextInput } from "./text-input.native";
import type { EditingTextInputHandle } from "./types";

const bottomSheetTextInputRender = vi.hoisted(() => vi.fn());
const pasteInputRender = vi.hoisted(() => vi.fn());

vi.mock("@gorhom/bottom-sheet", async () => {
  const ReactModule = await import("react");
  return {
    BottomSheetTextInput: ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
      (props, ref) => {
        bottomSheetTextInputRender(props);
        if (props.children) {
          return ReactModule.createElement("div", { ref }, props.children as React.ReactNode);
        }
        return ReactModule.createElement("input", {
          ...props,
          ref,
          "data-bottom-sheet-input": true,
        });
      },
    ),
  };
});

vi.mock("@mattermost/react-native-paste-input", async () => {
  const ReactModule = await import("react");
  return {
    default: ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>((props, ref) => {
      pasteInputRender(props);
      if (props.children) {
        return ReactModule.createElement("div", { ref }, props.children as React.ReactNode);
      }
      return ReactModule.createElement("input", { ...props, ref });
    }),
  };
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  bottomSheetTextInputRender.mockClear();
  pasteInputRender.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root && container) {
    act(() => {
      root?.unmount();
    });
    container.remove();
  }
  root = null;
  container = null;
});

function noop() {}

function createHandleRecorder() {
  const handleRef = createRef<EditingTextInputHandle>();
  const received: (EditingTextInputHandle | null)[] = [];
  function assignHandle(handle: EditingTextInputHandle | null) {
    received.push(handle);
    handleRef.current = handle;
  }
  return { handleRef, received, assignHandle };
}

describe("EditingTextInputNative", () => {
  it.each(["paste", "bottom-sheet"] as const)(
    "renders one source of text for highlighted %s inputs and keeps replacements current",
    (variant) => {
      const handleRef = createRef<EditingTextInputHandle>();
      const onChangeText = vi.fn();
      const inputProps = variant === "paste" ? { onPasteError: noop } : { variant };
      const recorder = variant === "paste" ? pasteInputRender : bottomSheetTextInputRender;
      const initialValue = "😀 #Claude Opus 继续";
      act(() => {
        root?.render(
          <EditingTextInput
            {...inputProps}
            ref={handleRef}
            initialValue={initialValue}
            highlights={[{ start: 3, end: 15 }]}
            onChangeText={onChangeText}
            multiline
          />,
        );
      });
      const handle = handleRef.current;
      const input = container?.firstElementChild;
      expect(container?.textContent).toBe(initialValue);
      const props = recorder.mock.lastCall?.[0];
      expect(props).not.toHaveProperty("defaultValue");
      expect(props).not.toHaveProperty("value");
      expect(props).not.toHaveProperty("highlights");
      expect(
        Array.from(container?.querySelectorAll("span") ?? [], (node) => node.textContent),
      ).toEqual(["😀 ", "#Claude Opus", " 继续"]);

      act(() => props.onChangeText("😀 #Claude Opus 你好"));
      expect(container?.textContent).toBe("😀 #Claude Opus 你好");
      expect(onChangeText).toHaveBeenCalledExactlyOnceWith("😀 #Claude Opus 你好");
      expect(handle?.getText()).toBe("😀 #Claude Opus 你好");
      act(() => handle?.replaceText("#New", { start: 4, end: 4 }));
      expect(container?.textContent).toBe("#New");
      expect(handle?.getText()).toBe("#New");
      expect(container?.firstElementChild).toBe(input);
      expect(handleRef.current).toBe(handle);
      expect(onChangeText).toHaveBeenCalledTimes(1);
      act(() => handle?.replaceText(""));
      expect(container?.textContent).toBe("");
      expect(container?.firstElementChild).toBe(input);
      act(() => handle?.reset());
      expect(container?.textContent).toBe("");
      expect(container?.firstElementChild).not.toBe(input);
      expect(handleRef.current).toBe(handle);
    },
  );

  it.each(["paste", "bottom-sheet"] as const)(
    "keeps empty highlights on defaultValue and switches %s text sources atomically",
    (variant) => {
      const handleRef = createRef<EditingTextInputHandle>();
      const inputProps = variant === "paste" ? { onPasteError: noop } : { variant };
      const recorder = variant === "paste" ? pasteInputRender : bottomSheetTextInputRender;
      act(() =>
        root?.render(
          <EditingTextInput
            {...inputProps}
            ref={handleRef}
            initialValue="#Profile"
            highlights={[]}
          />,
        ),
      );
      const handle = handleRef.current;
      expect(recorder.mock.lastCall?.[0]).toHaveProperty("defaultValue", "#Profile");
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("children");
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("value");

      act(() =>
        root?.render(
          <EditingTextInput
            {...inputProps}
            ref={handleRef}
            initialValue="stale"
            highlights={[{ start: 0, end: 8 }]}
          />,
        ),
      );
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("defaultValue");
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("value");
      expect(container?.textContent).toBe("#Profile");
      expect(handleRef.current).toBe(handle);

      act(() => recorder.mock.lastCall?.[0].onChangeText("plain text"));
      act(() =>
        root?.render(
          <EditingTextInput {...inputProps} ref={handleRef} initialValue="stale" highlights={[]} />,
        ),
      );
      expect(recorder.mock.lastCall?.[0]).toHaveProperty("defaultValue", "plain text");
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("children");
      expect(recorder.mock.lastCall?.[0]).not.toHaveProperty("value");
      expect(handle?.getText()).toBe("plain text");
      expect(handleRef.current).toBe(handle);
    },
  );

  it("uses the bottom-sheet input only inside a bottom sheet", () => {
    act(() => {
      root?.render(
        <>
          <EditingTextInput testID="outside" />
          <BottomSheetScope>
            <EditingTextInput testID="inside" />
          </BottomSheetScope>
        </>,
      );
    });

    expect(
      container?.querySelector('[data-testid="outside"]')?.getAttribute("data-bottom-sheet-input"),
    ).toBeNull();
    expect(bottomSheetTextInputRender).toHaveBeenCalledOnce();
    expect(bottomSheetTextInputRender.mock.calls[0]?.[0]).toMatchObject({ testID: "inside" });
  });

  it("keeps its editing handle and selection when native editing rerenders the leaf", () => {
    const { handleRef, received, assignHandle } = createHandleRecorder();
    act(() =>
      root?.render(
        <EditingTextInput ref={assignHandle} initialValue="initial" highlights={[]} multiline />,
      ),
    );
    const input = container?.querySelector("textarea");
    if (!input) throw new Error("Expected native editing surface");
    const handle = handleRef.current;
    act(() => {
      handle?.focus();
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setValue) throw new Error("Expected input value setter");
      setValue.call(input, "native edit");
      input.setSelectionRange(2, 5);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "native edit" }));
    });
    expect(handleRef.current).toBe(handle);
    expect(received).toEqual([handle]);
    expect(handle?.getText()).toBe("native edit");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(input);
    act(() => root?.unmount());
    root = null;
    expect(received).toEqual([handle, null]);
  });

  it("clears text via clear() when replaceText receives an empty string", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(<EditingTextInput ref={handleRef} initialValue="initial" onChangeText={noop} />);
    });

    expect(handleRef.current?.getText()).toBe("initial");

    act(() => {
      handleRef.current?.replaceText("");
    });

    expect(handleRef.current?.getText()).toBe("");
  });

  it("replaces the native input when resetting the editor", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(
        <EditingTextInput
          ref={handleRef}
          initialValue="line one\nline two\nline three"
          onChangeText={noop}
        />,
      );
    });
    const grownInput = container?.querySelector("input");
    const handle = handleRef.current;

    act(() => {
      handleRef.current?.reset();
    });

    expect(container?.querySelector("input")).not.toBe(grownInput);
    expect(handleRef.current).toBe(handle);
  });

  it("restores focus after replacing a reset native input", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(<EditingTextInput ref={handleRef} initialValue="message" />);
    });
    const originalInput = container?.querySelector("input");
    if (!originalInput) throw new Error("Expected native input");
    Object.assign(originalInput, { isFocused: () => true });
    originalInput.focus();

    act(() => {
      handleRef.current?.reset();
    });

    expect(document.activeElement).toBe(container?.querySelector("input"));
  });

  it("focuses the replacement input when focus is requested before an editor reset remounts", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(<EditingTextInput ref={handleRef} initialValue="stale" />);
    });
    const originalInput = container?.querySelector("input");
    if (!originalInput) throw new Error("Expected native input");
    const originalFocus = vi.spyOn(originalInput, "focus");

    act(() => {
      handleRef.current?.reset();
      handleRef.current?.focus();
    });

    const replacementInput = container?.querySelector("input");
    expect(replacementInput).not.toBe(originalInput);
    expect(originalFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(replacementInput);
  });

  it("drops a pending focus restore when blur is requested before an editor reset remounts", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(<EditingTextInput ref={handleRef} initialValue="stale" />);
    });
    const originalInput = container?.querySelector("input");
    if (!originalInput) throw new Error("Expected native input");
    Object.assign(originalInput, { isFocused: () => true });
    originalInput.focus();

    act(() => {
      handleRef.current?.reset();
      handleRef.current?.blur();
    });

    expect(document.activeElement).not.toBe(container?.querySelector("input"));
  });

  it("updates textRef and text when replaceText receives non-empty text", () => {
    const handleRef = createRef<EditingTextInputHandle>();

    act(() => {
      root?.render(<EditingTextInput ref={handleRef} initialValue="hello" />);
    });

    expect(handleRef.current?.getText()).toBe("hello");

    act(() => {
      handleRef.current?.replaceText("world", { start: 0, end: 5 });
    });

    expect(handleRef.current?.getText()).toBe("world");
  });
});
