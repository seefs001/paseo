import type { Artifact } from "@getpaseo/protocol/messages";
import { Files } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useArtifacts, useWorkspaceArtifacts, type ArtifactHost } from "./store";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput } from "@/components/ui/text-input";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { formatTimeAgo } from "@/utils/time";

const ThemedFiles = withUnistyles(Files);
const presentation = {
  label: (t) => t("artifacts.title"),
  subtitle: (t) => t("artifacts.title"),
  tooltip: (t) => t("artifacts.title"),
  icon: ThemedFiles,
} satisfies PanelPresentation;

export function ArtifactHostState({
  host,
}: {
  host: Exclude<ArtifactHost, { status: "ready" }> | undefined;
}) {
  const { t } = useTranslation();
  let message = t("artifacts.viewer.loading");
  if (host?.status === "offline") message = t("artifacts.errors.offline");
  if (host?.status === "unsupported") message = t("artifacts.collection.unsupported");
  if (host?.status === "error") message = host.message;
  return (
    <View style={styles.center}>
      <Text style={styles.meta}>{message}</Text>
    </View>
  );
}

function ArtifactsPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, openPreferredTarget } = usePaneContext();
  const host = useArtifacts((state) => state.hosts[serverId]);
  const collection = useWorkspaceArtifacts(serverId, workspaceId);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return collection.filter((artifact) =>
      `${artifact.title}\n${artifact.fileName}`.toLocaleLowerCase().includes(query),
    );
  }, [collection, search]);
  const open = useCallback(
    (artifactId: string) => {
      openPreferredTarget({ kind: "artifact", artifactId }, "explorerFiles");
    },
    [openPreferredTarget],
  );
  if (host?.status !== "ready") return <ArtifactHostState host={host} />;
  return (
    <View style={styles.container} testID="artifacts-panel">
      <PaneContentToolbar style={styles.toolbar}>
        <EditingTextInput
          style={styles.search}
          placeholder={t("artifacts.collection.search")}
          accessibilityLabel={t("artifacts.collection.search")}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          testID="artifacts-search"
        />
      </PaneContentToolbar>
      {rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.meta}>
            {search.trim() ? t("common.empty.noResults") : t("artifacts.collection.empty")}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.list}>
          {rows.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} onOpen={open} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ArtifactRow({ artifact, onOpen }: { artifact: Artifact; onOpen: (id: string) => void }) {
  const open = useCallback(() => onOpen(artifact.id), [artifact.id, onOpen]);
  return (
    <PressHighlight
      onPress={open}
      accessibilityRole="button"
      style={styles.row}
      testID={`artifact-row-${artifact.id}`}
    >
      <MaterialFileIcon fileName={artifact.fileName} size={20} />
      <View style={styles.labels}>
        <Text style={styles.title} numberOfLines={1}>
          {artifact.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {artifact.fileName} · {formatTimeAgo(new Date(artifact.updatedAt))}
        </Text>
      </View>
    </PressHighlight>
  );
}

export const artifactsPanelRegistration = definePanel("artifacts", {
  component: ArtifactsPanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  toolbar: { paddingHorizontal: theme.spacing[3] },
  search: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[4] },
  list: { padding: theme.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  labels: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
