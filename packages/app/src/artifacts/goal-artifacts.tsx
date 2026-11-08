import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useGoalArtifacts } from "@/artifacts/store";
import { openArtifactViewer } from "@/artifacts/viewer-state";
import { closeDeskGoalSheet } from "@/board/goal-sheet";
import { ArtifactRow } from "./row";

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
  const open = useCallback(
    (artifactId: string) => {
      closeDeskGoalSheet();
      openArtifactViewer(serverId, artifactId);
    },
    [serverId],
  );
  if (list.length === 0) return null;
  return (
    <View style={styles.section} testID="goal-artifacts">
      <Text style={styles.heading}>{t("artifacts.title")}</Text>
      {list.map((artifact) => (
        <ArtifactRow
          key={artifact.id}
          serverId={serverId}
          artifact={artifact}
          onOpen={open}
          testID={`goal-artifact-${artifact.id}`}
        />
      ))}
    </View>
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
    fontWeight: theme.fontWeight.medium,
  },
}));
