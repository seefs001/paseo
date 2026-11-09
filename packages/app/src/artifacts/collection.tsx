import type { Artifact } from "@getpaseo/protocol/messages";
import { Ellipsis, Files, ListChecks } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useArtifactHostState, useWorkspaceArtifacts, type ArtifactHost } from "./store";
import { ArtifactRow } from "./row";
import { useMultiSelect } from "./multi-select";
import { useArtifactBulkActions } from "./use-artifact-bulk-actions";
import { Button } from "@/components/ui/button";
import { DensityIcon } from "@/components/ui/density-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { EditingTextInput } from "@/components/ui/text-input";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";

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
  const { serverId, workspaceId, openPreferredTarget, openFileInWorkspace } = usePaneContext();
  const host = useArtifactHostState(serverId);
  const collection = useWorkspaceArtifacts(serverId, workspaceId);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return collection.filter((artifact) =>
      `${artifact.title}\n${artifact.fileName}\n${artifact.sourcePath ?? ""}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [collection, search]);
  const rowIds = useMemo(() => rows.map((artifact) => artifact.id), [rows]);
  const selection = useMultiSelect(rowIds);
  const bulk = useArtifactBulkActions(serverId);
  const selectedArtifacts = useMemo(
    () => rows.filter((artifact) => selection.selected.has(artifact.id)),
    [rows, selection.selected],
  );
  const open = useCallback(
    (artifactId: string) => {
      openPreferredTarget({ kind: "artifact", artifactId }, "explorerFiles");
    },
    [openPreferredTarget],
  );
  const openFile = useCallback(
    (path: string) => {
      openFileInWorkspace({ location: { path }, disposition: "preferred" });
    },
    [openFileInWorkspace],
  );
  // A drag from a selected row carries the whole selection, like a file manager.
  const dragPathsFor = useCallback(
    (artifact: Artifact): string[] => {
      const carried = selection.selected.has(artifact.id) ? selectedArtifacts : [artifact];
      return carried.flatMap((entry) =>
        entry.sourcePath && entry.workspaceId === workspaceId ? [entry.sourcePath] : [],
      );
    },
    [selectedArtifacts, selection.selected, workspaceId],
  );
  const removeSelected = useCallback(async () => {
    if (await bulk.remove(selectedArtifacts, "selected")) selection.clear();
  }, [bulk, selectedArtifacts, selection]);
  const clearAll = useCallback(async () => {
    if (await bulk.remove(collection, "all")) selection.clear();
  }, [bulk, collection, selection]);
  const downloadSelected = useCallback(
    () => void bulk.download(selectedArtifacts),
    [bulk, selectedArtifacts],
  );
  const copySelectedPaths = useCallback(
    () => void bulk.copyPaths(selectedArtifacts),
    [bulk, selectedArtifacts],
  );
  const rowSelection = useCallback(
    (artifactId: string) => ({
      active: selection.active,
      selected: selection.selected.has(artifactId),
      onPress: selection.press,
    }),
    [selection.active, selection.press, selection.selected],
  );
  if (host?.status !== "ready") return <ArtifactHostState host={host} />;
  const busy = bulk.pending !== null;
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
        <Text style={styles.meta}>{t("artifacts.pill", { count: rows.length })}</Text>
        <ToolbarButton
          label={t("artifacts.selection.select")}
          selected={selection.active}
          onPress={selection.toggleMode}
          disabled={rows.length === 0}
          testID="artifacts-select-mode"
        >
          <DensityIcon icon={ListChecks} size="sm" color="foregroundMuted" />
        </ToolbarButton>
        <DropdownMenu>
          <ToolbarButton
            kind="menu"
            label={t("workspace.fileActions.moreActions")}
            disabled={busy}
            testID="artifacts-more"
          >
            <DensityIcon icon={Ellipsis} size="sm" color="foregroundMuted" />
          </ToolbarButton>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={selection.selectAll} disabled={rows.length === 0}>
              {t("artifacts.selection.selectAll")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={clearAll}
              disabled={collection.length === 0}
              destructive
              testID="artifacts-clear-all"
            >
              {t("artifacts.selection.clearAll")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneContentToolbar>
      {selection.active ? (
        <SelectionBar
          count={selectedArtifacts.length}
          total={rows.length}
          canCopyPaths={selectedArtifacts.some((artifact) => artifact.sourcePath !== null)}
          pending={bulk.pending}
          onSelectAll={selection.selectAll}
          onDownload={downloadSelected}
          onCopyPaths={copySelectedPaths}
          onRemove={removeSelected}
          onDone={selection.clear}
        />
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.meta}>
            {search.trim() ? t("common.empty.noResults") : t("artifacts.collection.empty")}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.list}>
          {rows.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              serverId={serverId}
              artifact={artifact}
              onOpen={open}
              onOpenFile={openFile}
              selection={rowSelection(artifact.id)}
              dragPaths={dragPathsFor(artifact)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SelectionBar({
  count,
  total,
  canCopyPaths,
  pending,
  onSelectAll,
  onDownload,
  onCopyPaths,
  onRemove,
  onDone,
}: {
  count: number;
  total: number;
  canCopyPaths: boolean;
  pending: "remove" | "download" | "copyPaths" | null;
  onSelectAll: () => void;
  onDownload: () => void;
  onCopyPaths: () => void;
  onRemove: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const none = count === 0;
  const busy = pending !== null;
  return (
    <View style={styles.selectionBar} testID="artifacts-selection-bar">
      <Text style={styles.selectionCount}>{t("artifacts.selection.count", { count })}</Text>
      {count < total ? (
        <Button size="sm" variant="ghost" onPress={onSelectAll} disabled={busy}>
          {t("artifacts.selection.selectAll")}
        </Button>
      ) : null}
      <View style={styles.selectionSpacer} />
      <Button
        size="sm"
        variant="ghost"
        onPress={onDownload}
        disabled={none || busy}
        loading={pending === "download"}
      >
        {t("artifacts.interaction.download")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onPress={onCopyPaths}
        disabled={none || busy || !canCopyPaths}
        loading={pending === "copyPaths"}
      >
        {t("artifacts.selection.copyPaths")}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onPress={onRemove}
        disabled={none || busy}
        loading={pending === "remove"}
        testID="artifacts-remove-selected"
      >
        {t("artifacts.selection.remove")}
      </Button>
      <Button size="sm" variant="outline" onPress={onDone} disabled={busy}>
        {t("artifacts.selection.done")}
      </Button>
    </View>
  );
}

export const artifactsPanelRegistration = definePanel("artifacts", {
  component: ArtifactsPanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  search: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[4] },
  list: { padding: theme.spacing[2] },
  selectionBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  selectionCount: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  selectionSpacer: { flex: 1 },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
