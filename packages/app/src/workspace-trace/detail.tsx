import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkspaceTraceEdge, WorkspaceTraceNode } from "@getpaseo/protocol/workspace-trace";
import { openChatQuoteSource } from "@/attachments/chat-quote-jump";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTraceTime, TraceKindIcon, TraceNodeBadges } from "./lane-view";
import type { TraceView } from "./view-model";

interface TraceDetailProps {
  serverId: string;
  view: TraceView;
  node: WorkspaceTraceNode;
  isFocus: boolean;
  onFocus: (node: WorkspaceTraceNode) => void;
  onSelect: (id: string) => void;
  /** Resolved by the panel: the compact sheet renders outside the pane's context. */
  onOpenArtifact: (artifactId: string) => void;
  /** Dismisses the compact sheet so the conversation it opens is visible. */
  onLeave: () => void;
}

function behaviorText(node: WorkspaceTraceNode, t: TFunction): string | null {
  if (node.behavior) return t(`workspaceTrace.behavior.${node.behavior}`);
  if (node.requestedBehavior) return t(`workspaceTrace.requested.${node.requestedBehavior}`);
  return null;
}

export function TraceDetail({
  serverId,
  view,
  node,
  isFocus,
  onFocus,
  onSelect,
  onOpenArtifact,
  onLeave,
}: TraceDetailProps) {
  const { t } = useTranslation();
  const lane = view.lanesById.get(node.laneId);
  const behavior = behaviorText(node, t);
  const focus = useCallback(() => onFocus(node), [node, onFocus]);
  return (
    <ScrollView contentContainerStyle={styles.container} testID="workspace-trace-detail">
      <View style={styles.titleLine}>
        <TraceKindIcon kind={node.kind} />
        <Text style={styles.title}>{view.nodeLabel(node, t)}</Text>
      </View>
      <TraceNodeBadges node={node} />
      <Field
        label={t("workspaceTrace.detail.kind")}
        value={t(`workspaceTrace.kind.${node.kind}`)}
      />
      <Field label={t("workspaceTrace.detail.agent")} value={view.laneTitle(node.laneId, t)} />
      {lane && lane.availability !== "local" ? (
        <Field
          label={t("workspaceTrace.detail.availability")}
          value={t(`workspaceTrace.availability.${lane.availability}`)}
        />
      ) : null}
      <Field label={t("workspaceTrace.detail.time")} value={formatTraceTime(node.at)} />
      <Field
        label={t("workspaceTrace.detail.evidence")}
        value={t(`workspaceTrace.evidenceDetail.${node.evidence}`)}
      />
      <Field
        label={t("workspaceTrace.detail.status")}
        value={t(`workspaceTrace.statusDetail.${node.status}`)}
      />
      {behavior ? <Field label={t("workspaceTrace.detail.behavior")} value={behavior} /> : null}
      {node.notificationEvent ? (
        <Field
          label={t("workspaceTrace.detail.notification")}
          value={t(`workspaceTrace.notification.${node.notificationEvent}`)}
        />
      ) : null}
      {node.messageIds.length > 1 ? (
        <Field
          label={t("workspaceTrace.detail.batch")}
          value={t("workspaceTrace.detail.batchCount", { count: node.messageIds.length })}
        />
      ) : null}
      <EdgeList
        title={t("workspaceTrace.detail.incoming")}
        edges={view.incoming.get(node.id) ?? []}
        endpoint="sourceNodeId"
        view={view}
        onSelect={onSelect}
      />
      <EdgeList
        title={t("workspaceTrace.detail.outgoing")}
        edges={view.outgoing.get(node.id) ?? []}
        endpoint="targetNodeId"
        view={view}
        onSelect={onSelect}
      />
      <View style={styles.actions}>
        <SourceAction
          serverId={serverId}
          view={view}
          node={node}
          onOpenArtifact={onOpenArtifact}
          onLeave={onLeave}
        />
        {isFocus ? null : (
          <Button size="sm" variant="ghost" onPress={focus} testID="workspace-trace-focus">
            {t("workspaceTrace.focusHere")}
          </Button>
        )}
      </View>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function EdgeList({
  title,
  edges,
  endpoint,
  view,
  onSelect,
}: {
  title: string;
  edges: WorkspaceTraceEdge[];
  endpoint: "sourceNodeId" | "targetNodeId";
  view: TraceView;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (edges.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {edges.map((edge) => {
        const other = view.nodesById.get(edge[endpoint]);
        if (!other) {
          return (
            <Text key={edge.id} style={styles.fieldValue}>
              {t("workspaceTrace.detail.outsideWindow")}
            </Text>
          );
        }
        return <EdgeRow key={edge.id} edge={edge} other={other} view={view} onSelect={onSelect} />;
      })}
    </View>
  );
}

function EdgeRow({
  edge,
  other,
  view,
  onSelect,
}: {
  edge: WorkspaceTraceEdge;
  other: WorkspaceTraceNode;
  view: TraceView;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(other.id), [onSelect, other.id]);
  return (
    <PressHighlight
      onPress={select}
      style={styles.edgeRow}
      accessibilityRole="button"
      testID={`workspace-trace-edge-${edge.id}`}
    >
      <TraceKindIcon kind={other.kind} />
      <Text style={styles.edgeText} numberOfLines={1}>
        {`${t(`workspaceTrace.edge.${edge.kind}`)} · ${view.laneTitle(other.laneId, t)} · ${formatTraceTime(other.at)}`}
      </Text>
    </PressHighlight>
  );
}

function SourceAction({
  serverId,
  view,
  node,
  onOpenArtifact,
  onLeave,
}: {
  serverId: string;
  view: TraceView;
  node: WorkspaceTraceNode;
  onOpenArtifact: (artifactId: string) => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const anchor = node.anchor;
  const lane = view.lanesById.get(node.laneId);
  const reachable = lane?.availability === "local" || lane?.availability === "archived";
  const openSource = useCallback(() => {
    if (anchor?.kind !== "agent") return;
    onLeave();
    if (anchor.callId) {
      openChatQuoteSource({
        serverId: anchor.serverId,
        agentId: anchor.agentId,
        callId: anchor.callId,
      });
      return;
    }
    navigateToAgent({ serverId: anchor.serverId, agentId: anchor.agentId });
  }, [anchor, onLeave]);
  const openArtifact = useCallback(() => {
    if (anchor?.kind !== "artifact") return;
    onOpenArtifact(anchor.artifactId);
  }, [anchor, onOpenArtifact]);

  if (anchor?.kind === "artifact") {
    return (
      <Button
        size="sm"
        variant="secondary"
        onPress={openArtifact}
        testID="workspace-trace-open-artifact"
      >
        {t("workspaceTrace.openArtifact")}
      </Button>
    );
  }
  if (!anchor || !reachable || anchor.serverId !== serverId) {
    return <Text style={styles.fieldValue}>{t("workspaceTrace.sourceUnavailable")}</Text>;
  }
  return (
    <View style={styles.sourceAction}>
      <Button
        size="sm"
        variant="secondary"
        onPress={openSource}
        testID="workspace-trace-open-source"
      >
        {anchor.callId ? t("workspaceTrace.showSource") : t("workspaceTrace.openConversation")}
      </Button>
      {anchor.callId ? null : (
        <Text style={styles.hint}>{t("workspaceTrace.sourceItemNotAddressable")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { padding: theme.spacing[3], gap: theme.spacing[2] },
  titleLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  field: { flexDirection: "row", gap: theme.spacing[2] },
  fieldLabel: { width: 96, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  fieldValue: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  section: { gap: theme.spacing[1], paddingTop: theme.spacing[2] },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  edgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[1],
  },
  edgeText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[3],
  },
  sourceAction: { gap: theme.spacing[1] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
