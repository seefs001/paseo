import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquareQuote } from "lucide-react-native";
import {
  SelectionToolbar,
  type AnchoredSelection,
  type SelectionToolbarAction,
} from "@/components/selection-toolbar.web";
import type { ArtifactSelectionProps } from "./selection";

interface ArtifactTextSelection extends AnchoredSelection {
  text: string;
}

const CONTENTS = { display: "contents" } as const;

export function ArtifactSelection({ children, onQuote }: ArtifactSelectionProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const readSelection = useCallback((): ArtifactTextSelection | null => {
    const selection = window.getSelection();
    if (!root.current || !selection || selection.isCollapsed || selection.rangeCount !== 1)
      return null;
    const range = selection.getRangeAt(0);
    if (!root.current.contains(range.commonAncestorContainer)) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const rect = range.getBoundingClientRect();
    return { text, anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }, []);
  const actions = useMemo<SelectionToolbarAction<ArtifactTextSelection>[]>(
    () => [
      {
        id: "artifact-quote",
        label: t("artifacts.interaction.quote"),
        icon: MessageSquareQuote,
        onSelect: (selection) => onQuote?.(selection.text),
      },
    ],
    [onQuote, t],
  );
  return (
    <div ref={root} style={CONTENTS}>
      {children}
      {onQuote ? (
        <SelectionToolbar
          readSelection={readSelection}
          actions={actions}
          label={t("artifacts.interaction.quote")}
          testID="artifact-selection-toolbar"
          clearSelectionOnInvoke
        />
      ) : null}
    </div>
  );
}
