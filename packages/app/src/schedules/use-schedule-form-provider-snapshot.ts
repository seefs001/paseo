import { useEffect } from "react";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ScheduleFormModel, ScheduleFormState } from "./schedule-form-model";

export function useScheduleFormProviderSnapshot(
  model: ScheduleFormModel,
  state: ScheduleFormState,
) {
  const request = state.providerSnapshotRequest;
  const serverId = request?.serverId ?? state.selectedServerId;
  const cwd = request?.cwd ?? state.workingDir;
  const enabled = state.targetKind === "new-agent" && Boolean(serverId && cwd.trim());
  const snapshot = useProvidersSnapshot(serverId ?? null, {
    cwd,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !serverId || !snapshot.entries) {
      return;
    }
    const current = model.getState();
    const matchesScope =
      current.targetKind === "new-agent" &&
      current.selectedServerId === serverId &&
      current.workingDir.trim() === cwd.trim();
    if (!matchesScope || current.providerSnapshotRequest !== request) {
      return;
    }
    model.applyProviderSnapshot(serverId, { entries: snapshot.entries });
  }, [cwd, enabled, model, request, serverId, snapshot.entries]);

  return snapshot;
}
