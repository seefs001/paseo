export interface ChatTextSelection {
  messageId: string;
  text: string;
}

export interface ChatSelectionActions {
  addToChat: (selection: ChatTextSelection) => void;
  askInSideConversation: (selection: ChatTextSelection) => void;
}
