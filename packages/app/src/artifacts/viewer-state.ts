import { create } from "zustand";
import { useArtifacts } from "./store";
import { useSessionStore } from "@/stores/session-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

type ArtifactViewerState =
  | { status: "closed"; openCount: number }
  | { status: "open"; openCount: number; visible: boolean; serverId: string; artifactId: string };

/** The reading shell for saved artifacts whose workspace is no longer available. */
export const useArtifactViewer = create<ArtifactViewerState>(() => ({
  status: "closed",
  openCount: 0,
}));

export function openArtifactViewer(serverId: string, artifactId: string): void {
  const host = useArtifacts.getState().hosts[serverId];
  const artifact = host?.status === "ready" ? host.artifacts.get(artifactId) : null;
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  if (artifact && workspaces?.has(artifact.workspaceId)) {
    navigateToWorkspace({
      serverId,
      workspaceId: artifact.workspaceId,
      target: { kind: "artifact", artifactId },
    });
    return;
  }
  useArtifactViewer.setState((previous) => ({
    status: "open",
    openCount: previous.openCount + 1,
    visible: true,
    serverId,
    artifactId,
  }));
}

export function closeArtifactViewer(): void {
  useArtifactViewer.setState((previous) =>
    previous.status === "open" ? { ...previous, visible: false } : previous,
  );
}

export function dismissArtifactViewer(): void {
  useArtifactViewer.setState((previous) => ({ status: "closed", openCount: previous.openCount }));
}
