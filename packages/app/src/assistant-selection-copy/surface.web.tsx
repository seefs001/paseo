import {
  useCallback,
  useRef,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { createAssistantSelectionClipboardContent } from "./content.web";
import { ChatSelectionToolbar } from "@/chat-selection/toolbar.web";
import type { ChatSelectionActions } from "@/chat-selection/types";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  selectionActions?: ChatSelectionActions;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

export function AssistantSelectionCopySurface({
  children,
  style,
  selectionActions,
}: AssistantSelectionCopySurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  return (
    <div ref={rootRef} onCopy={handleCopy} style={DISPLAY_CONTENTS}>
      <View style={style}>{children}</View>
      {selectionActions && <ChatSelectionToolbar rootRef={rootRef} actions={selectionActions} />}
    </div>
  );
}
