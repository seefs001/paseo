export interface ArtifactDragSourceInput {
  serverId: string;
  workspaceId: string;
  /** Workspace-relative source files the drag carries; an empty list makes the row not draggable. */
  paths: readonly string[];
}
