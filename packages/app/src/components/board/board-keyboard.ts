import type { DeskNavEntry } from "@/components/board/board-desk";

export interface BoardKeyboardInput {
  enabled: boolean;
  /** Visible zones' rows, zones in screen order. */
  lanes: readonly (readonly DeskNavEntry[])[];
  selectedKey: string | null;
  onSelect: (entry: DeskNavEntry) => void;
  onOpen: (entry: DeskNavEntry) => void;
  onToggleDetail: () => void;
  onEscape: () => void;
}

/** Desk keyboard navigation is a web feature; native has no hardware-key path here. */
export function useBoardKeyboard(_input: BoardKeyboardInput): void {}
