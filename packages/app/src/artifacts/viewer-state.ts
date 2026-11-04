import { create } from "zustand";

type ArtifactViewerState =
  | { status: "closed"; openCount: number }
  | { status: "open"; openCount: number; visible: boolean; serverId: string; artifactId: string };

/**
 * One app-wide artifact viewer. It reads the daemon's copy by id, so the Artifacts pill and a
 * goal open the same view, including after the workspace that made it is archived.
 */
export const useArtifactViewer = create<ArtifactViewerState>(() => ({
  status: "closed",
  openCount: 0,
}));

export function openArtifactViewer(serverId: string, artifactId: string): void {
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
