import { useCallback, useEffect, useRef, useState, type RefCallback } from "react";
import type { View } from "react-native";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import {
  serializeWorkspaceFilesDragPayload,
  WORKSPACE_FILES_DRAG_MIME,
} from "@/attachments/workspace-file-drag";
import type { ArtifactDragSourceInput } from "./drag-source.types";

/**
 * Drags the artifacts' source files into a composer as workspace file references, the same
 * thing dragging them from the file explorer does. Artifacts without a source file stay put.
 */
export function useArtifactDragSource({
  serverId,
  workspaceId,
  paths,
}: ArtifactDragSourceInput): RefCallback<View> {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: View | null) => {
    setElement(node as unknown as HTMLElement | null);
  }, []);
  // Read at drag start so a selection change does not rebind the listener.
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const draggable = paths.length > 0;

  useEffect(() => {
    if (!element) return;
    element.draggable = draggable;
    if (!draggable) return;
    function handleDragStart(event: DragEvent) {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        WORKSPACE_FILES_DRAG_MIME,
        serializeWorkspaceFilesDragPayload(
          pathsRef.current.map((path) => ({
            version: 1,
            serverId,
            workspaceId,
            attachment: createWorkspaceFileAttachment({ path }),
          })),
        ),
      );
    }
    element.addEventListener("dragstart", handleDragStart);
    return () => {
      element.draggable = false;
      element.removeEventListener("dragstart", handleDragStart);
    };
  }, [draggable, element, serverId, workspaceId]);

  return ref;
}
