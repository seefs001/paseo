import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useGoalArtifacts } from "@/artifacts/store";
import { openArtifactViewer } from "@/artifacts/viewer-state";
import { closeDeskGoalSheet } from "@/board/goal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { formatTimeAgo } from "@/utils/time";

/**
 * What a goal has produced so far, across every workspace that worked on it. The entries live
 * with the daemon, so a goal keeps its deliverables after its workspaces are archived.
 */
export function GoalArtifacts({
  serverId,
  goalId,
}: {
  serverId: string;
  goalId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const list = useGoalArtifacts(serverId, goalId);
  if (list.length === 0) return null;
  return (
    <View style={styles.section} testID="goal-artifacts">
      <Text style={styles.heading}>{t("artifacts.title")}</Text>
      {list.map((artifact) => (
        <GoalArtifactRow key={artifact.id} serverId={serverId} artifact={artifact} />
      ))}
    </View>
  );
}

function GoalArtifactRow({
  serverId,
  artifact,
}: {
  serverId: string;
  artifact: Artifact;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    closeDeskGoalSheet();
    openArtifactViewer(serverId, artifact.id);
  }, [artifact.id, serverId]);
  return (
    <PressHighlight
      accessibilityRole="button"
      onPress={open}
      style={styles.row}
      testID={`goal-artifact-${artifact.id}`}
    >
      <Text style={styles.title} numberOfLines={1}>
        {artifact.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {t("artifacts.row.meta", {
          kind: t(`artifacts.kinds.${artifact.kind}`),
          revision: artifact.revision,
          time: formatTimeAgo(new Date(artifact.updatedAt)),
        })}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  heading: {
    paddingTop: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  row: {
    gap: 2,
    paddingVertical: theme.spacing[1],
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
