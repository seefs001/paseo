import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useReducer,
  useState,
} from "react";
import { Text, TextInput } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import PasteInput, {
  type PastedFile,
  type PasteTextInputInstance,
} from "@mattermost/react-native-paste-input";
import { useIsInsideBottomSheet } from "@/components/ui/bottom-sheet-scope";
import type { EditingTextInputHandle, EditingTextInputProps } from "./types";
import { splitHighlightedText } from "./highlight-ranges";

type NativeInput = (TextInput | PasteTextInputInstance) & {
  blur(): void;
  focus(): void;
  isFocused?(): boolean;
  clear?(): void;
  replaceText?(text: string, selection?: { start: number; end: number }): void;
  setNativeProps?(props: { text?: string; selection?: { start: number; end: number } }): void;
  setSelection?(start: number, end: number): void;
  getNativeRef?(): unknown;
};

export const EditingTextInput = forwardRef<EditingTextInputHandle, EditingTextInputProps>(
  function EditingTextInputNative(allProps, ref) {
    const isInsideBottomSheet = useIsInsideBottomSheet();
    const {
      initialValue = "",
      highlights,
      onHighlightPress,
      onChangeText,
      onPasteImages,
      onPasteError,
      variant = isInsideBottomSheet ? "bottom-sheet" : "default",
      value: _,
      defaultValue: __,
      ...props
    } = allProps as EditingTextInputProps & { value?: unknown; defaultValue?: unknown };
    const inputRef = useRef<NativeInput | null>(null);
    const initialTextRef = useRef(initialValue);
    const textRef = useRef(initialTextRef.current);
    // Resetting the editor swaps the native input to reset intrinsic multiline
    // sizing. Text replacement (including an empty buffer) keeps the input mounted.
    // Until React commits that swap, `inputRef` still points at the doomed
    // instance: focusing it asks Android for the keyboard and then tears the
    // focused view down, which cancels the show. Fabric also runs view
    // commands before mount items, so a focus command sent alongside the swap
    // reaches a view that is not attached yet and the IME ignores it. Focus is
    // therefore carried by the replacement's `autoFocus`, which native applies
    // once the view is attached.
    const isAwaitingReplacementRef = useRef(false);
    const [replacement, setReplacement] = useState({ revision: 0, autoFocus: false });
    // Fabric re-measures the Android input when its `text` prop changes. A native edit only
    // refreshes a cached spannable, and batched IME deletes (Gboard hold-to-delete) leave the
    // measured height at the previous content, so an emptied draft keeps several lines. Render
    // again after every edit so `defaultValue` (or highlighted children) carries the text and is
    // re-measured. Only this leaf renders; the composer stays isolated from typing.
    const [, bumpTextRevision] = useReducer((revision: number) => revision + 1, 0);

    const assignInputRef = useCallback((input: NativeInput | null) => {
      inputRef.current = input;
      if (input) isAwaitingReplacementRef.current = false;
    }, []);

    const setReplacementFocus = useCallback((autoFocus: boolean) => {
      setReplacement((current) => ({ ...current, autoFocus }));
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (isAwaitingReplacementRef.current) {
            setReplacementFocus(true);
            return;
          }
          inputRef.current?.focus();
        },
        blur: () => {
          if (isAwaitingReplacementRef.current) {
            setReplacementFocus(false);
            return;
          }
          inputRef.current?.blur();
        },
        isFocused: () => inputRef.current?.isFocused?.() ?? false,
        getText: () => textRef.current,
        replaceText: (nextText, selection) => {
          textRef.current = nextText;
          bumpTextRevision();
          if (inputRef.current?.replaceText) {
            inputRef.current.replaceText(nextText, selection);
            return;
          }
          if (nextText === "") {
            inputRef.current?.clear?.();
            return;
          }
          inputRef.current?.setNativeProps?.({
            text: nextText,
            ...(selection ? { selection } : {}),
          });
          if (selection) inputRef.current?.setSelection?.(selection.start, selection.end);
        },
        setSelection: (selection) => {
          if (inputRef.current?.setSelection) {
            inputRef.current.setSelection(selection.start, selection.end);
            return;
          }
          inputRef.current?.setNativeProps?.({ selection });
        },
        reset: () => {
          textRef.current = "";
          const autoFocus = inputRef.current?.isFocused?.() ?? false;
          if (inputRef.current?.replaceText) {
            inputRef.current.replaceText("");
          } else {
            inputRef.current?.clear?.();
          }
          isAwaitingReplacementRef.current = true;
          setReplacement((current) => ({ revision: current.revision + 1, autoFocus }));
        },
        getNativeRef: () => inputRef.current?.getNativeRef?.() ?? inputRef.current,
      }),
      [setReplacementFocus],
    );

    const handleChangeText = useCallback(
      (nextText: string) => {
        textRef.current = nextText;
        onChangeText?.(nextText);
        bumpTextRevision();
      },
      [onChangeText],
    );
    const handlePaste = useCallback(
      (error: string | null | undefined, files: PastedFile[]) => {
        if (error) {
          onPasteError?.(error);
        } else if (files.length > 0) {
          onPasteImages?.(files);
        }
      },
      [onPasteError, onPasteImages],
    );

    const autoFocus = replacement.revision === 0 ? props.autoFocus : replacement.autoFocus;
    // Fabric concatenates text and children. Removing the last highlight swaps the
    // sources in one render; its attributed-string comparison also clears the old styling.
    const contentProps = highlights?.length
      ? {
          children: (
            <Text>
              {splitHighlightedText(textRef.current, highlights).map((part) => (
                <HighlightedInputText
                  key={part.start}
                  part={part}
                  onHighlightPress={onHighlightPress}
                />
              ))}
            </Text>
          ),
        }
      : { defaultValue: textRef.current };

    if (onPasteImages || onPasteError) {
      return (
        <PasteInput
          {...props}
          autoFocus={autoFocus}
          key={replacement.revision}
          ref={assignInputRef as React.Ref<PasteTextInputInstance>}
          {...contentProps}
          onChangeText={handleChangeText}
          onPaste={handlePaste}
        />
      );
    }
    if (variant === "bottom-sheet") {
      return (
        <BottomSheetTextInput
          {...props}
          autoFocus={autoFocus}
          key={replacement.revision}
          ref={assignInputRef as unknown as React.Ref<never>}
          {...contentProps}
          onChangeText={handleChangeText}
        />
      );
    }
    return (
      <TextInput
        {...props}
        autoFocus={autoFocus}
        key={replacement.revision}
        ref={assignInputRef as React.Ref<TextInput>}
        {...contentProps}
        onChangeText={handleChangeText}
      />
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  highlight: { backgroundColor: theme.colors.interactionHighlight },
}));

function HighlightedInputText({ part, onHighlightPress }: HighlightedInputTextProps) {
  const handlePress = useCallback(() => {
    onHighlightPress?.(part.start);
  }, [onHighlightPress, part.start]);
  return (
    <Text
      style={part.highlighted ? styles.highlight : undefined}
      onPress={part.highlighted && onHighlightPress ? handlePress : undefined}
      suppressHighlighting
    >
      {part.text}
    </Text>
  );
}

interface HighlightedInputTextProps {
  part: { start: number; text: string; highlighted: boolean };
  onHighlightPress: EditingTextInputProps["onHighlightPress"];
}
