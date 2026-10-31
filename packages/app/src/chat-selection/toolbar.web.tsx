import { useCallback, useMemo, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, PanelRightOpen } from "lucide-react-native";
import { SelectionToolbar, type SelectionToolbarAction } from "@/components/selection-toolbar.web";
import { readChatTextSelection, type AnchoredChatTextSelection } from "./selection.web";
import type { ChatSelectionActions } from "./types";

interface ChatSelectionToolbarProps {
  rootRef: RefObject<HTMLDivElement | null>;
  actions: ChatSelectionActions;
}

export function ChatSelectionToolbar({ rootRef, actions }: ChatSelectionToolbarProps) {
  const { t } = useTranslation();
  const readSelection = useCallback(
    () => (rootRef.current ? readChatTextSelection(rootRef.current) : null),
    [rootRef],
  );
  const toolbarActions = useMemo<SelectionToolbarAction<AnchoredChatTextSelection>[]>(
    () => [
      {
        id: "chat-selection-add",
        label: t("message.selection.addToChat"),
        icon: MessageSquarePlus,
        onSelect: actions.addToChat,
      },
      {
        id: "chat-selection-ask",
        label: t("message.selection.askInSideConversation"),
        icon: PanelRightOpen,
        onSelect: actions.askInSideConversation,
      },
    ],
    [actions, t],
  );
  return (
    <SelectionToolbar
      readSelection={readSelection}
      actions={toolbarActions}
      label={t("message.selection.actions")}
      testID="chat-selection-toolbar"
    />
  );
}
