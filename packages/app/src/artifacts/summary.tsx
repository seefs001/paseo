import type { Artifact } from "@getpaseo/protocol/messages";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { formatFileSize } from "@/utils/format-file-size";
import { formatTimeAgo } from "@/utils/time";

export function ArtifactMeta({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation();
  return (
    <Text style={styles.meta} numberOfLines={1}>
      {t("artifacts.row.meta", {
        kind: t(`artifacts.kinds.${artifact.kind}`),
        revision: artifact.revision,
        time: formatTimeAgo(new Date(artifact.updatedAt)),
      })}
    </Text>
  );
}

export function ArtifactSummary({ artifact }: { artifact: Artifact }) {
  return (
    <View style={styles.summary}>
      <MaterialFileIcon fileName={artifact.fileName} size={20} />
      <View style={styles.labels}>
        <Text style={styles.title} numberOfLines={1}>
          {artifact.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {artifact.fileName} · {formatFileSize(artifact.size)}
        </Text>
        <ArtifactMeta artifact={artifact} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  labels: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
