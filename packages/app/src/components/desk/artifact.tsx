import { ArrowRight, FileText } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { openArtifactViewer } from "@/artifacts/viewer-state";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { DeskArtifact } from "@/desk/model";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";

/** Opens the app-wide artifact viewer. Reading an artifact accepts nothing and restores nothing. */
function useOpenArtifact(entry: DeskArtifact): () => void {
  return useCallback(
    () => openArtifactViewer(entry.serverId, entry.artifact.id),
    [entry.artifact.id, entry.serverId],
  );
}

/** An artifact under the session that registered it. */
export function DeskArtifactChip({ entry }: { entry: DeskArtifact }): ReactElement {
  const open = useOpenArtifact(entry);
  return (
    <Button
      size="sm"
      variant="outline"
      leftIcon={FileText}
      onPress={open}
      disabled={!entry.canOpen}
      testID={`desk-artifact-${entry.artifact.id}`}
    >
      {entry.artifact.title}
    </Button>
  );
}

/**
 * An artifact not shown under a recent reply. It belongs to its workspace; the Desk never guesses
 * which agent made it. A recorded source agent that is no longer in the active list (archived,
 * closed) is still its source, so the row can return to it through the agent id alone.
 */
export function DeskArtifactRow({ entry }: { entry: DeskArtifact }): ReactElement {
  const { t } = useTranslation();
  const open = useOpenArtifact(entry);
  const { artifact, workspace, sourceSession } = entry;
  const workspaceName = workspace ? (workspace.title ?? workspace.name) : null;
  const parts = [
    workspaceName ? t("desk.artifact.inWorkspace", { workspace: workspaceName }) : null,
    entry.serverName,
    sourceLabel(entry, t),
    formatTimeAgo(new Date(artifact.updatedAt)),
  ].filter((part): part is string => part !== null);
  const sourceAgentId = artifact.sourceAgentId;
  return (
    <View style={styles.row}>
      <PressHighlight
        accessibilityRole="button"
        onPress={open}
        disabled={!entry.canOpen}
        style={styles.main}
        testID={`desk-artifact-row-${artifact.id}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          {artifact.title}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {parts.join(" · ")}
        </Text>
      </PressHighlight>
      {sourceAgentId ? (
        <ReturnToSource
          serverId={entry.serverId}
          agentId={sourceAgentId}
          workspaceId={sourceSession ? (sourceSession.agent.workspaceId ?? null) : null}
        />
      ) : null}
    </View>
  );
}

function sourceLabel(entry: DeskArtifact, t: TFunction): string {
  if (entry.sourceSession) {
    return t("desk.artifact.fromSession", {
      session: entry.sourceSession.agent.title ?? t("desk.session.untitled"),
    });
  }
  if (entry.artifact.sourceAgentId) return t("desk.artifact.sourceNotActive");
  return t("desk.artifact.noSource");
}

/** Uses only a workspace taken from the live session; a stale hint would open the wrong place. */
function ReturnToSource({
  serverId,
  agentId,
  workspaceId,
}: {
  serverId: string;
  agentId: string;
  workspaceId: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(
    () => navigateToAgent({ serverId, agentId, workspaceId }),
    [agentId, serverId, workspaceId],
  );
  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={ArrowRight}
      onPress={open}
      testID={`desk-artifact-source-${agentId}`}
    >
      {t("desk.artifact.openSource")}
    </Button>
  );
}

/** Lines the title up with session titles, which sit after a status dot and its gap. */
const DOT_COLUMN = 19;

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
    paddingLeft: theme.spacing[4] + DOT_COLUMN,
    paddingVertical: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
