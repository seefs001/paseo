import { Bell, Clock, FileText, GitBranch, Inbox, MessageSquare } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { WorkspaceTraceGap, WorkspaceTraceNode } from "@getpaseo/protocol/workspace-trace";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { TraceView } from "./view-model";

const LANE_WIDTH = 112;
const SELECTED_STATE = { selected: true };
const UNSELECTED_STATE = { selected: false };
const TIME_WIDTH = 64;

const KIND_ICONS = {
  message: withUnistyles(MessageSquare),
  delegation: withUnistyles(GitBranch),
  agent_created: withUnistyles(GitBranch),
  notification: withUnistyles(Bell),
  dispatch: withUnistyles(Inbox),
  artifact: withUnistyles(FileText),
  schedule: withUnistyles(Clock),
} satisfies Record<WorkspaceTraceNode["kind"], unknown>;

export function formatTraceTime(at: string): string {
  const date = new Date(at);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function mutedIconProps(theme: { colors: { foregroundMuted: string } }) {
  return { color: theme.colors.foregroundMuted };
}

export function TraceKindIcon({ kind }: { kind: WorkspaceTraceNode["kind"] }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={14} uniProps={mutedIconProps} />;
}

const STATUS_VARIANTS: Record<WorkspaceTraceNode["status"], StatusBadgeVariant | null> = {
  recorded: null,
  queued: "warning",
  dispatched: "muted",
  failed: "error",
  unknown: "muted",
};

/** Status and evidence, worded so queued or dispatched never reads as finished work. */
export function TraceNodeBadges({ node }: { node: WorkspaceTraceNode }) {
  const { t } = useTranslation();
  const variant = STATUS_VARIANTS[node.status];
  return (
    <View style={styles.badges}>
      {variant ? (
        <StatusBadge
          size="xs"
          variant={variant}
          label={t(`workspaceTrace.status.${node.status}`)}
        />
      ) : null}
      {node.evidence === "existing" ? (
        <StatusBadge size="xs" label={t("workspaceTrace.evidence.existing")} />
      ) : null}
    </View>
  );
}

function gapKey(gap: WorkspaceTraceGap): string {
  return `${gap.kind}:${gap.agentId ?? ""}`;
}

export function TraceGaps({ view }: { view: TraceView }) {
  const { t } = useTranslation();
  const gaps = [...new Map(view.page.gaps.map((gap) => [gapKey(gap), gap])).values()];
  if (gaps.length === 0) return null;
  return (
    <View style={styles.gaps} testID="workspace-trace-gaps">
      {gaps.map((gap) => (
        <Text key={gapKey(gap)} style={styles.gapText}>
          {gap.agentId
            ? t("workspaceTrace.gapForAgent", {
                gap: t(`workspaceTrace.gap.${gap.kind}`),
                agent: gap.agentId.slice(0, 8),
              })
            : t(`workspaceTrace.gap.${gap.kind}`)}
        </Text>
      ))}
    </View>
  );
}

export function TraceLaneHeader({ view }: { view: TraceView }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <View style={styles.timeCell} />
      {view.lanes.map((lane) => (
        <View key={lane.id} style={styles.laneHeaderCell}>
          <Text style={styles.laneTitle} numberOfLines={1}>
            {view.laneTitle(lane.id, t)}
          </Text>
          {lane.availability === "local" ? null : (
            <Text style={styles.laneMeta} numberOfLines={1}>
              {t(`workspaceTrace.availability.${lane.availability}`)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

interface TraceRowProps {
  view: TraceView;
  node: WorkspaceTraceNode;
  compact: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

function edgeTargetLaneIndexes(view: TraceView, node: WorkspaceTraceNode): number[] {
  const indexes: number[] = [];
  for (const edge of view.outgoing.get(node.id) ?? []) {
    const target = view.nodesById.get(edge.targetNodeId);
    const index = target ? view.laneIndex.get(target.laneId) : undefined;
    if (index !== undefined && !indexes.includes(index)) indexes.push(index);
  }
  return indexes;
}

function counterpartSummary(view: TraceView, node: WorkspaceTraceNode, t: TFunction) {
  const targets = (view.outgoing.get(node.id) ?? [])
    .map((edge) => view.nodesById.get(edge.targetNodeId))
    .filter((target): target is WorkspaceTraceNode => target !== undefined)
    .map((target) => view.laneTitle(target.laneId, t));
  const sources = (view.incoming.get(node.id) ?? [])
    .map((edge) => view.nodesById.get(edge.sourceNodeId))
    .filter((source): source is WorkspaceTraceNode => source !== undefined)
    .map((source) => view.laneTitle(source.laneId, t));
  const own = view.laneTitle(node.laneId, t);
  if (targets.length > 0) return `${own} → ${[...new Set(targets)].join(", ")}`;
  if (sources.length > 0) return `${[...new Set(sources)].join(", ")} → ${own}`;
  return own;
}

export function TraceRow({ view, node, compact, selected, onSelect }: TraceRowProps) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(node.id), [node.id, onSelect]);
  const laneIndex = view.laneIndex.get(node.laneId) ?? 0;
  const targets = edgeTargetLaneIndexes(view, node);
  const spanStart = Math.min(laneIndex, ...targets);
  const spanEnd = Math.max(laneIndex, ...targets);
  return (
    <PressHighlight
      onPress={select}
      style={[styles.row, selected && styles.rowSelected]}
      accessibilityRole="button"
      accessibilityState={selected ? SELECTED_STATE : UNSELECTED_STATE}
      testID={`workspace-trace-node-${node.id}`}
    >
      <Text style={[styles.time, styles.timeCell]}>{formatTraceTime(node.at)}</Text>
      {compact ? null : (
        <View style={[styles.laneTrack, { width: LANE_WIDTH * view.lanes.length }]}>
          {spanEnd > spanStart ? (
            <View
              style={[
                styles.connector,
                {
                  left: LANE_WIDTH * spanStart + LANE_WIDTH / 2,
                  width: LANE_WIDTH * (spanEnd - spanStart),
                },
              ]}
            />
          ) : null}
          {targets.map((index) => (
            <View
              key={index}
              style={[styles.targetDot, { left: LANE_WIDTH * index + LANE_WIDTH / 2 - 4 }]}
            />
          ))}
          <View style={[styles.sourceDot, { left: LANE_WIDTH * laneIndex + LANE_WIDTH / 2 - 5 }]} />
        </View>
      )}
      <View style={styles.label}>
        <View style={styles.labelLine}>
          <TraceKindIcon kind={node.kind} />
          <Text style={styles.title} numberOfLines={1}>
            {view.nodeLabel(node, t)}
          </Text>
          <TraceNodeBadges node={node} />
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {counterpartSummary(view, node, t)}
        </Text>
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  timeCell: { width: TIME_WIDTH },
  laneHeaderCell: { width: LANE_WIDTH, paddingHorizontal: theme.spacing[1], alignItems: "center" },
  laneTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  laneMeta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
  },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  laneTrack: { height: 44, position: "relative" },
  connector: {
    position: "absolute",
    top: 21,
    height: 2,
    backgroundColor: theme.colors.borderAccent,
  },
  sourceDot: {
    position: "absolute",
    top: 17,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.foreground,
  },
  targetDot: {
    position: "absolute",
    top: 18,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
  },
  label: { flex: 1, minWidth: 200, paddingLeft: theme.spacing[2], gap: 2 },
  labelLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  badges: { flexDirection: "row", gap: theme.spacing[1] },
  gaps: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  gapText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
