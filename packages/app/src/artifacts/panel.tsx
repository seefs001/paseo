import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useArtifact } from "./store";
import { ArtifactView } from "./viewer";
import { ArtifactQuoteSheet, type ArtifactQuoteInput } from "./quote";
import { createMaterialFileIcon } from "@/components/material-file-icon";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

function stayInPane() {}

function ArtifactPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "artifact", "ArtifactPanel requires an artifact target");
  const artifact = useArtifact(serverId, target.artifactId);
  const [quote, setQuote] = useState<ArtifactQuoteInput | null>(null);
  const closeQuote = useCallback(() => setQuote(null), []);
  const openFile = useCallback(
    (path: string) => {
      openFileInWorkspace({ location: { path }, disposition: "preferred" });
    },
    [openFileInWorkspace],
  );
  const ownsSource = artifact?.workspaceId === workspaceId;
  return (
    <View style={styles.container} testID="artifact-panel">
      <ArtifactView
        serverId={serverId}
        artifactId={target.artifactId}
        onLeave={stayInPane}
        onOpenFile={ownsSource ? openFile : undefined}
        onQuote={setQuote}
      />
      <ArtifactQuoteSheet
        serverId={serverId}
        workspaceId={workspaceId}
        quote={quote}
        onClose={closeQuote}
      />
    </View>
  );
}

function useArtifactPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "artifact" }>,
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const artifact = useArtifact(context.serverId, target.artifactId);
  const label = artifact?.title ?? t("artifacts.title");
  const fileName = artifact?.fileName ?? "artifact.txt";
  const icon = useMemo(() => createMaterialFileIcon(fileName), [fileName]);
  return {
    label,
    subtitle: t("artifacts.title"),
    tooltip: label,
    titleState: "ready",
    icon,
    statusBucket: null,
  };
}

export const artifactPanelRegistration = definePanel("artifact", {
  component: ArtifactPanel,
  useDescriptor: useArtifactPanelDescriptor,
});

const styles = StyleSheet.create(() => ({ container: { flex: 1, minHeight: 0 } }));
