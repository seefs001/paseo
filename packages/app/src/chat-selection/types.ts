export interface ChatTextSelection {
  messageId: string;
  text: string;
}

export interface ChatSelectionActions {
  addToChat: (selection: ChatTextSelection) => void;
  askInSideConversation: (selection: ChatTextSelection) => void;
  /** Missing when the host cannot store Board tasks. */
  addToBoard?: (selection: ChatTextSelection) => void;
}
