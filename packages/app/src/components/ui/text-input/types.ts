import type { TextInputProps } from "react-native";
import type { NativePastedFile } from "@/composer/native-pasted-image";

/** Stable for the mounted editor lifetime; reset() owns any inner input replacement. */
export interface EditingTextInputHandle {
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  getText(): string;
  replaceText(text: string, selection?: { start: number; end: number }): void;
  setSelection(selection: { start: number; end: number }): void;
  /** Clear the editor and reset its intrinsic layout, preserving focus intent. */
  reset(): void;
  getNativeRef(): unknown;
}

export interface EditingTextInputProps extends Omit<
  TextInputProps,
  "defaultValue" | "onChangeText" | "value"
> {
  initialValue?: string;
  /** Background-only highlights, in UTF-16 half-open text intervals. */
  highlights?: readonly { start: number; end: number }[];
  /** A collapsed caret press that landed on a highlight. Index is a UTF-16 offset. */
  onHighlightPress?: (index: number) => void;
  onChangeText?: (text: string, selectionBefore?: { start: number; end: number }) => void;
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  onPasteError?: (message: string) => void;
  variant?: "default" | "bottom-sheet";
}
