import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useWorkspaceArtifacts } from "@/artifacts/store";
import { useBoardTasks } from "@/board/tasks";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { usePaneContext } from "@/panels/pane-context";
import { formatTimeAgo } from "@/utils/time";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openWorkspaceTargetAtLocation } from "@/workspace-tabs/open-beside";

/**
 * The workspace's Artifacts collection as a pill beside Git changes: plans, notes, diagrams,
 * screenshots and reports the agents registered, newest first with summaries on top. Each row says
 * which goal and tasks it serves; pressing it opens the artifact in a pane beside the conversation
 * (a sheet on compact layouts).
 */
export function ArtifactsTrack({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const { tabId } = usePaneContext();
  const all = useWorkspaceArtifacts(serverId, workspaceId);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const open = useCallback(
    (artifactId: string) =>
      openWorkspaceTargetAtLocation({
        workspaceKey,
        target: { kind: "artifact", artifactId },
        location: "side",
        parentTabId: tabId,
      }),
    [tabId, workspaceKey],
  );
  const fromThisSession = useMemo(
    () => all.filter((artifact) => artifact.sourceAgentId === agentId),
    [agentId, all],
  );
  const [sessionOnly, setSessionOnly] = useState(false);
  const toggle = useCallback(() => setSessionOnly((value) => !value), []);
  const rows = sessionOnly ? fromThisSession : all;
  const segments = useMemo(
    () => [{ bucket: null, text: t("artifacts.pill", { count: all.length }) }],
    [all.length, t],
  );

  if (all.length === 0) return null;
  // The filter only earns a row when it would change the list.
  const canFilter = fromThisSession.length > 0 && fromThisSession.length < all.length;

  return (
    <ComposerTrackPill
      testID="artifacts-track"
      segments={segments}
      panelTitle={t("artifacts.title")}
    >
      {canFilter ? (
        <ComposerTrackActions>
          <ComposerTrackRow onPress={toggle} closeOnSelect={false} testID="artifacts-filter">
            <Text style={styles.filter} numberOfLines={1}>
              {sessionOnly
                ? t("artifacts.filter.showAll", { count: all.length })
                : t("artifacts.filter.sessionOnly", { count: fromThisSession.length })}
            </Text>
          </ComposerTrackRow>
        </ComposerTrackActions>
      ) : null}
      {rows.map((artifact) => (
        <ArtifactRow key={artifact.id} serverId={serverId} artifact={artifact} onOpen={open} />
      ))}
    </ComposerTrackPill>
  );
}

function ArtifactRow({
  serverId,
  artifact,
  onOpen,
}: {
  serverId: string;
  artifact: Artifact;
  onOpen: (artifactId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => onOpen(artifact.id), [artifact.id, onOpen]);
  const relations = useArtifactRelations(serverId, artifact);
  return (
    <ComposerTrackRow onPress={open} testID={`artifact-row-${artifact.id}`}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {artifact.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {t("artifacts.row.meta", {
            kind: t(`artifacts.kinds.${artifact.kind}`),
            revision: artifact.revision,
            time: formatTimeAgo(new Date(artifact.updatedAt)),
          })}
          {relations ? ` · ${relations}` : ""}
        </Text>
      </View>
    </ComposerTrackRow>
  );
}

/** "G-1 · T-1, T-2": the Desk records an artifact serves, as references the user knows. */
function useArtifactRelations(serverId: string, artifact: Artifact): string {
  const host = useBoardTasks((state) => state.hosts[serverId]);
  if (host?.status !== "ready") return "";
  const goal = artifact.goalId ? host.goals.get(artifact.goalId) : undefined;
  const tasks = artifact.taskIds
    .map((id) => host.tasks.get(id))
    .filter((task) => task !== undefined)
    .map((task) => `T-${task.number}`);
  return [goal ? `G-${goal.number}` : null, tasks.length > 0 ? tasks.join(", ") : null]
    .filter(Boolean)
    .join(" · ");
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    gap: 2,
  },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  filter: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
