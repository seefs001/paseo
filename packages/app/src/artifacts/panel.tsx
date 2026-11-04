import type { Artifact } from "@getpaseo/protocol/messages";
import { List, Sparkles } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useArtifact, useWorkspaceArtifacts } from "@/artifacts/store";
import { ArtifactMeta, ArtifactView } from "@/artifacts/viewer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openWorkspaceTargetAtLocation } from "@/workspace-tabs/open-beside";
import invariant from "tiny-invariant";

const ThemedSparkles = withUnistyles(Sparkles);
const ThemedList = withUnistyles(List, (theme) => ({ color: theme.colors.foregroundMuted }));

const noop = () => {};

/**
 * An artifact beside the conversation, the way chat apps show one: a switcher over the
 * workspace's collection on top, then the artifact's links and content. Picking another
 * artifact opens it in this pane.
 */
function ArtifactPanel(): ReactElement {
  const { serverId, workspaceId, tabId, target } = usePaneContext();
  invariant(target.kind === "artifact", "ArtifactPanel requires an artifact target");
  const artifact = useArtifact(serverId, target.artifactId);
  const collection = useWorkspaceArtifacts(serverId, workspaceId);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const openOther = useCallback(
    (artifactId: string) =>
      openWorkspaceTargetAtLocation({
        workspaceKey,
        target: { kind: "artifact", artifactId },
        location: "main",
        parentTabId: tabId,
      }),
    [tabId, workspaceKey],
  );

  return (
    <View style={styles.container} testID="artifact-panel">
      <PaneContentToolbar style={styles.toolbar}>
        <View style={styles.heading}>
          <Text style={styles.title} numberOfLines={1}>
            {artifact?.title ?? ""}
          </Text>
          {artifact ? <ArtifactMeta artifact={artifact} /> : null}
        </View>
        <ArtifactSwitcher current={artifact} collection={collection} onSelect={openOther} />
      </PaneContentToolbar>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ArtifactView serverId={serverId} artifactId={target.artifactId} onLeave={noop} />
      </ScrollView>
    </View>
  );
}

function ArtifactSwitcher({
  current,
  collection,
  onSelect,
}: {
  current: Artifact | null;
  collection: readonly Artifact[];
  onSelect: (artifactId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" label={t("artifacts.title")} testID="artifact-switcher">
        <ThemedList size={16} />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={320}>
        {collection.map((artifact) => (
          <SwitcherItem
            key={artifact.id}
            artifact={artifact}
            selected={artifact.id === current?.id}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SwitcherItem({
  artifact,
  selected,
  onSelect,
}: {
  artifact: Artifact;
  selected: boolean;
  onSelect: (artifactId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(artifact.id), [artifact.id, onSelect]);
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={select}
      description={`${t(`artifacts.kinds.${artifact.kind}`)} · ${t("artifacts.row.revision", { revision: artifact.revision })}`}
      testID={`artifact-switch-${artifact.id}`}
    >
      {artifact.title}
    </DropdownMenuItem>
  );
}

function useArtifactPanelDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "artifact" }>,
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const artifact = useArtifact(context.serverId, target.artifactId);
  const label = artifact?.title ?? t("artifacts.title");
  return {
    label,
    subtitle: t("artifacts.title"),
    tooltip: label,
    titleState: "ready",
    icon: ThemedSparkles,
    statusBucket: null,
  };
}

export const artifactPanelRegistration = definePanel("artifact", {
  component: ArtifactPanel,
  useDescriptor: useArtifactPanelDescriptor,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  heading: {
    flex: 1,
    minWidth: 0,
    paddingLeft: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
  },
}));
