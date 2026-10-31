import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useAssistantFileLinkEnvironment } from "@/assistant-file-links";
import { FileReferenceSelectionToolbar } from "../reference/toolbar.web";
import { createMarkdownSourceMap, readMarkdownReferenceSelection } from "./selection-map.web";
import type { MarkdownReferenceSelectionProps } from "./selection";

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

export function MarkdownReferenceSelection({
  source,
  body,
  filePath,
  children,
}: MarkdownReferenceSelectionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { workspaceRoot } = useAssistantFileLinkEnvironment();
  const blocks = useMemo(
    () => createMarkdownSourceMap({ source, body, workspaceRoot }),
    [source, body, workspaceRoot],
  );
  const readSelection = useCallback(() => {
    const root = rootRef.current;
    if (!root || !blocks) return null;
    return readMarkdownReferenceSelection({ root, blocks });
  }, [blocks]);

  return (
    <div ref={rootRef} style={DISPLAY_CONTENTS}>
      {children}
      <FileReferenceSelectionToolbar filePath={filePath} readSelection={readSelection} />
    </div>
  );
}
