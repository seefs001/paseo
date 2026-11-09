import { Activity } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { WorkspaceTraceNode } from "@getpaseo/protocol/workspace-trace";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useHostFeature } from "@/runtime/host-features";
import { useWorkspaceTrace } from "./use-workspace-trace";
import { TraceDetail } from "./detail";
import { TraceGaps, TraceLaneHeader, TraceRow } from "./lane-view";
import { buildTraceView, type TraceView } from "./view-model";

const ThemedActivity = withUnistyles(Activity);
const presentation = {
  label: (t) => t("workspaceTrace.title"),
  subtitle: (t) => t("workspaceTrace.title"),
  tooltip: (t) => t("workspaceTrace.title"),
  icon: ThemedActivity,
} satisfies PanelPresentation;

function CenterMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <Text style={styles.meta}>{message}</Text>
      {onRetry ? (
        <Button size="sm" variant="ghost" onPress={onRetry}>
          {t("workspaceTrace.retry")}
        </Button>
      ) : null}
    </View>
  );
}

function WorkspaceTracePanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, openPreferredTarget } = usePaneContext();
  const supported = useHostFeature(serverId, "workspaceTrace");
  if (!supported) return <CenterMessage message={t("workspaceTrace.unsupported")} />;
  return (
    <SupportedTracePanel
      serverId={serverId}
      workspaceId={workspaceId}
      openPreferredTarget={openPreferredTarget}
    />
  );
}

interface SupportedTracePanelProps {
  serverId: string;
  workspaceId: string;
  openPreferredTarget: PaneContextValue["openPreferredTarget"];
}

function SupportedTracePanel({
  serverId,
  workspaceId,
  openPreferredTarget,
}: SupportedTracePanelProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useWorkspaceTrace({ serverId, workspaceId, focusNodeId });
  const view = useMemo(() => (query.trace ? buildTraceView(query.trace) : null), [query.trace]);
  const selected = view && selectedId ? (view.nodesById.get(selectedId) ?? null) : null;
  const focusNode = view && focusNodeId ? (view.nodesById.get(focusNodeId) ?? null) : null;

  const sheetTitle = selected && view ? view.nodeLabel(selected, t) : "";
  const sheetHeader = useMemo(() => ({ title: sheetTitle }), [sheetTitle]);
  const focus = useCallback((node: WorkspaceTraceNode) => {
    setFocusNodeId(node.id);
    setSelectedId(node.id);
  }, []);
  const clearFocus = useCallback(() => setFocusNodeId(undefined), []);
  const openArtifact = useCallback(
    (artifactId: string) => {
      setSelectedId(null);
      openPreferredTarget({ kind: "artifact", artifactId }, "explorerFiles");
    },
    [openPreferredTarget],
  );
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const refresh = useCallback(() => void query.refresh(), [query]);
  const loadMore = useCallback(() => void query.loadMore(), [query]);

  if (query.status === "loading") return <CenterMessage message={t("workspaceTrace.loading")} />;
  if (query.status === "error" || !view) {
    return (
      <CenterMessage
        message={query.error?.message ?? t("workspaceTrace.loadFailed")}
        onRetry={refresh}
      />
    );
  }

  const detail = selected ? (
    <TraceDetail
      serverId={serverId}
      view={view}
      node={selected}
      isFocus={selected.id === focusNodeId}
      onFocus={focus}
      onSelect={setSelectedId}
      onOpenArtifact={openArtifact}
      onLeave={closeDetail}
    />
  ) : null;

  return (
    <View style={styles.container} testID="workspace-trace-panel">
      <TraceToolbar
        title={
          focusNode
            ? t("workspaceTrace.focusedOn", { title: view.nodeLabel(focusNode, t) })
            : t("workspaceTrace.recent")
        }
        focused={focusNode !== null}
        count={view.nodes.length}
        refreshing={query.refreshing}
        onClearFocus={clearFocus}
        onRefresh={refresh}
      />
      <View style={styles.body}>
        <View style={styles.main}>
          <TraceGaps view={view} />
          {view.nodes.length === 0 ? (
            <CenterMessage message={t("workspaceTrace.empty")} />
          ) : (
            <TraceStream
              view={view}
              compact={isCompact}
              selectedId={selectedId}
              onSelect={setSelectedId}
              canLoadMore={view.page.nextCursor !== null}
              loadingMore={query.loadingMore}
              onLoadMore={loadMore}
            />
          )}
        </View>
        {!isCompact && detail ? <View style={styles.detailColumn}>{detail}</View> : null}
      </View>
      {isCompact ? (
        <AdaptiveModalSheet
          visible={selected !== null}
          onClose={closeDetail}
          header={sheetHeader}
          testID="workspace-trace-detail-sheet"
        >
          {detail}
        </AdaptiveModalSheet>
      ) : null}
    </View>
  );
}

function TraceToolbar({
  title,
  focused,
  count,
  refreshing,
  onClearFocus,
  onRefresh,
}: {
  title: string;
  focused: boolean;
  count: number;
  refreshing: boolean;
  onClearFocus: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PaneContentToolbar style={styles.toolbar}>
      <Text style={styles.toolbarText} numberOfLines={1}>
        {title}
      </Text>
      {focused ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={onClearFocus}
          testID="workspace-trace-clear-focus"
        >
          {t("workspaceTrace.clearFocus")}
        </Button>
      ) : null}
      <Text style={styles.meta}>{t("workspaceTrace.count", { count })}</Text>
      <Button
        size="sm"
        variant="ghost"
        onPress={onRefresh}
        disabled={refreshing}
        testID="workspace-trace-refresh"
      >
        {refreshing ? t("workspaceTrace.refreshing") : t("workspaceTrace.refresh")}
      </Button>
    </PaneContentToolbar>
  );
}

function TraceStream({
  view,
  compact,
  selectedId,
  onSelect,
  canLoadMore,
  loadingMore,
  onLoadMore,
}: {
  view: TraceView;
  compact: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const rows = (
    <View>
      {view.nodes.map((node) => (
        <TraceRow
          key={node.id}
          view={view}
          node={node}
          compact={compact}
          selected={node.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {canLoadMore ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={onLoadMore}
          disabled={loadingMore}
          testID="workspace-trace-load-more"
        >
          {loadingMore ? t("workspaceTrace.loadingMore") : t("workspaceTrace.loadMore")}
        </Button>
      ) : null}
    </View>
  );
  if (compact) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.list}>
        {rows}
      </ScrollView>
    );
  }
  return (
    <View style={styles.container}>
      <ScrollView horizontal contentContainerStyle={styles.grow}>
        <View style={styles.grow}>
          <TraceLaneHeader view={view} />
          <ScrollView style={styles.container} contentContainerStyle={styles.list}>
            {rows}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

export const workspaceTracePanelRegistration = definePanel("trace", {
  component: WorkspaceTracePanel,
  presentation,
});

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  grow: { flexGrow: 1 },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  detailColumn: {
    width: 340,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  toolbarText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  list: { paddingVertical: theme.spacing[2] },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
