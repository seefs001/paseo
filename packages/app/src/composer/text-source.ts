/** Live text is read by editing consumers; containers subscribe only to what they display. */
export interface ComposerTextSource {
  getSnapshot: () => string;
  subscribe: (listener: () => void) => () => void;
  /** Reports the editor's selection so a quote added from elsewhere lands at the caret. */
  reportSelection?: (selection: { start: number; end: number } | null) => void;
}
