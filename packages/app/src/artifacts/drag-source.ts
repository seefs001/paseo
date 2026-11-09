import type { RefCallback } from "react";
import type { View } from "react-native";
import type { ArtifactDragSourceInput } from "./drag-source.types";

/** Dragging artifacts into the composer is a web/desktop gesture. */
export function useArtifactDragSource(
  _input: ArtifactDragSourceInput,
): RefCallback<View> | undefined {
  return undefined;
}
