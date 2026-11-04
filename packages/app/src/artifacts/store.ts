import type { ArtifactReadPayload, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Artifact } from "@getpaseo/protocol/messages";
import { useMemo } from "react";
import { create } from "zustand";
import { i18n } from "@/i18n/i18next";
import { toErrorMessage } from "@/utils/error-messages";

export type ArtifactHost =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "ready"; artifacts: ReadonlyMap<string, Artifact> };

interface ArtifactsState {
  hosts: Readonly<Record<string, ArtifactHost>>;
}

/** Each connected host's Artifacts collection. The host runtime keeps every host subscribed. */
export const useArtifacts = create<ArtifactsState>(() => ({ hosts: {} }));

function setHost(serverId: string, value: ArtifactHost): void {
  useArtifacts.setState((state) => ({ hosts: { ...state.hosts, [serverId]: value } }));
}

function editArtifacts(serverId: string, edit: (artifacts: Map<string, Artifact>) => void): void {
  const current = useArtifacts.getState().hosts[serverId];
  if (current?.status !== "ready") return;
  const artifacts = new Map(current.artifacts);
  edit(artifacts);
  setHost(serverId, { status: "ready", artifacts });
}

interface HostConnection {
  client: DaemonClient;
  unsubscribe: () => void;
}

class ArtifactsController {
  private readonly connections = new Map<string, HostConnection>();

  async connect(input: {
    serverId: string;
    client: DaemonClient;
    supportsArtifacts: boolean;
  }): Promise<void> {
    const { serverId, client } = input;
    const live = useArtifacts.getState().hosts[serverId]?.status !== "error";
    if (this.connections.get(serverId)?.client === client && input.supportsArtifacts && live) {
      return;
    }
    this.disconnect(serverId);
    if (!input.supportsArtifacts) {
      setHost(serverId, { status: "unsupported" });
      return;
    }
    setHost(serverId, { status: "loading" });
    const subscription = client.observeArtifacts();
    this.connections.set(serverId, {
      client,
      unsubscribe: () => {
        void subscription.release().catch(() => undefined);
      },
    });
    subscription.subscribe({
      snapshot: (payload) => {
        setHost(serverId, {
          status: "ready",
          artifacts: new Map(payload.artifacts.map((artifact) => [artifact.id, artifact])),
        });
      },
      update: (message) => {
        if (message.type !== "artifact.update") return;
        const change = message.payload;
        if (change.kind === "upsert") {
          editArtifacts(serverId, (artifacts) =>
            artifacts.set(change.artifact.id, change.artifact),
          );
        } else {
          editArtifacts(serverId, (artifacts) => artifacts.delete(change.artifactId));
        }
      },
      error: (error) => {
        setHost(serverId, { status: "error", message: toErrorMessage(error) });
      },
    });
    await subscription.ready;
  }

  disconnect(serverId: string): void {
    this.connections.get(serverId)?.unsubscribe();
    this.connections.delete(serverId);
    if (useArtifacts.getState().hosts[serverId]) setHost(serverId, { status: "offline" });
  }

  requireClient(serverId: string): DaemonClient {
    const client = this.connections.get(serverId)?.client;
    if (!client?.isConnected) throw new Error(i18n.t("artifacts.errors.offline"));
    return client;
  }
}

export const artifacts = new ArtifactsController();

export function readArtifact(serverId: string, artifactId: string): Promise<ArtifactReadPayload> {
  return artifacts.requireClient(serverId).readArtifact({ artifactId });
}

/** Takes the entry out of the collection. The workspace file it was copied from stays. */
export async function removeArtifact(serverId: string, artifactId: string): Promise<void> {
  await artifacts.requireClient(serverId).removeArtifact({ artifactId });
  editArtifacts(serverId, (map) => map.delete(artifactId));
}

/** Summaries first, then the most recently updated. */
export function sortArtifacts(list: readonly Artifact[]): Artifact[] {
  return [...list].sort((a, b) => {
    if ((a.kind === "summary") !== (b.kind === "summary")) return a.kind === "summary" ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

const EMPTY: readonly Artifact[] = [];

function useHostArtifacts(serverId: string): ReadonlyMap<string, Artifact> | null {
  return useArtifacts((state) => {
    const host = state.hosts[serverId];
    return host?.status === "ready" ? host.artifacts : null;
  });
}

/** The collection a workspace owns. Same-folder workspaces each see only their own. */
export function useWorkspaceArtifacts(serverId: string, workspaceId: string): readonly Artifact[] {
  const map = useHostArtifacts(serverId);
  return useMemo(() => {
    if (!map) return EMPTY;
    return sortArtifacts([...map.values()].filter((a) => a.workspaceId === workspaceId));
  }, [map, workspaceId]);
}

/** Every artifact that serves a goal, whichever workspace made it and whether it still exists. */
export function useGoalArtifacts(serverId: string, goalId: string | null): readonly Artifact[] {
  const map = useHostArtifacts(serverId);
  return useMemo(() => {
    if (!map || !goalId) return EMPTY;
    return sortArtifacts([...map.values()].filter((a) => a.goalId === goalId));
  }, [goalId, map]);
}

export function useArtifact(serverId: string, artifactId: string): Artifact | null {
  return useArtifacts((state) => {
    const host = state.hosts[serverId];
    return host?.status === "ready" ? (host.artifacts.get(artifactId) ?? null) : null;
  });
}
