import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { TextInput } from "react-native";
import type { EditingTextInputHandle, EditingTextInputProps } from "./types";
import { useTextInputHighlights } from "./highlights.web";

interface WebTextInputElement extends TextInput {
  value?: string;
  setSelectionRange?: (start: number, end: number) => void;
  addEventListener(type: "compositionstart" | "compositionend", listener: EventListener): void;
  removeEventListener(type: "compositionstart" | "compositionend", listener: EventListener): void;
}

export const EditingTextInput = forwardRef<EditingTextInputHandle, EditingTextInputProps>(
  function EditingTextInputWeb(allProps, ref) {
    const {
      initialValue = "",
      highlights,
      onHighlightPress,
      onChangeText,
      onPasteImages: _,
      onPasteError: __,
      variant: ___,
      value: ____,
      defaultValue: _____,
      ...props
    } = allProps as EditingTextInputProps & { value?: unknown; defaultValue?: unknown };
    const inputRef = useRef<TextInput | null>(null);
    const refreshHighlights = useTextInputHighlights(inputRef, highlights);
    const initialTextRef = useRef(initialValue);
    const textRef = useRef(initialTextRef.current);
    const isComposingRef = useRef(false);
    const selectionBeforeRef = useRef<
      Parameters<EditingTextInputHandle["setSelection"]>[0] | undefined
    >(undefined);
    const onChangeTextRef = useRef(onChangeText);
    onChangeTextRef.current = onChangeText;
    const onHighlightPressRef = useRef(onHighlightPress);
    onHighlightPressRef.current = onHighlightPress;
    const highlightsRef = useRef(highlights);
    highlightsRef.current = highlights;

    useEffect(() => {
      const element = inputRef.current;
      const isTextInput =
        element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
      if (!isTextInput) return;
      const input = element;

      const recordSelection = () => {
        const { selectionStart, selectionEnd } = input;
        if (selectionStart === null || selectionEnd === null) {
          selectionBeforeRef.current = undefined;
          return;
        }
        selectionBeforeRef.current = { start: selectionStart, end: selectionEnd };
      };
      const beforeInput = () => {
        if (!isComposingRef.current) recordSelection();
      };
      const startComposition = () => {
        recordSelection();
        isComposingRef.current = true;
      };
      const endComposition = () => {
        isComposingRef.current = false;
        const selectionBefore = selectionBeforeRef.current;
        selectionBeforeRef.current = undefined;
        const nextText = input.value;
        if (nextText === textRef.current) return;
        textRef.current = nextText;
        onChangeTextRef.current?.(nextText, selectionBefore);
      };

      const pressHighlight = () => {
        const { selectionStart, selectionEnd } = input;
        if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
          return;
        }
        const ranges = highlightsRef.current;
        if (!ranges?.length || !onHighlightPressRef.current) return;
        const hit = ranges.some(
          (range) => selectionStart > range.start && selectionStart <= range.end,
        );
        if (hit) onHighlightPressRef.current(selectionStart);
      };

      input.addEventListener("beforeinput", beforeInput);
      input.addEventListener("compositionstart", startComposition);
      input.addEventListener("compositionend", endComposition);
      input.addEventListener("click", pressHighlight);
      return () => {
        input.removeEventListener("beforeinput", beforeInput);
        input.removeEventListener("compositionstart", startComposition);
        input.removeEventListener("compositionend", endComposition);
        input.removeEventListener("click", pressHighlight);
      };
    }, []);

    const handleChangeText = useCallback((nextText: string) => {
      if (isComposingRef.current) return;
      const selectionBefore = selectionBeforeRef.current;
      selectionBeforeRef.current = undefined;
      if (nextText === textRef.current) return;
      textRef.current = nextText;
      onChangeTextRef.current?.(nextText, selectionBefore);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
        isFocused: () => document.activeElement === inputRef.current,
        getText: () => {
          const input = inputRef.current as WebTextInputElement | null;
          const nextText = input?.value ?? textRef.current;
          textRef.current = nextText;
          return nextText;
        },
        replaceText: (nextText, selection) => {
          selectionBeforeRef.current = undefined;
          textRef.current = nextText;
          const input = inputRef.current as WebTextInputElement | null;
          if (input && "value" in input) input.value = nextText;
          if (selection && typeof input?.setSelectionRange === "function") {
            input.setSelectionRange(selection.start, selection.end);
          }
          refreshHighlights();
        },
        setSelection: (selection) => {
          const input = inputRef.current as WebTextInputElement | null;
          input?.setSelectionRange?.(selection.start, selection.end);
        },
        reset: () => {
          selectionBeforeRef.current = undefined;
          textRef.current = "";
          const input = inputRef.current as WebTextInputElement | null;
          if (input && "value" in input) input.value = "";
          refreshHighlights();
        },
        getNativeRef: () => inputRef.current,
      }),
      [refreshHighlights],
    );

    return (
      <TextInput
        {...props}
        style={highlights?.length ? [props.style, { position: "relative" }] : props.style}
        ref={inputRef}
        defaultValue={initialTextRef.current}
        onChangeText={handleChangeText}
      />
    );
  },
);
