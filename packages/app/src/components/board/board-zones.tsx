import type { BoardDeskSettings } from "@getpaseo/protocol/messages";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock,
  Plus,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { buildBacklogMoves, type BacklogMove, type BoardCard } from "@/board/columns";
import type {
  DeskAheadEntries,
  DeskCheckpoint,
  DeskGoalFocus,
  DeskGroup,
  DeskModel,
} from "@/board/desk";
import { deskFogCollapseKey, deskGroupCollapseKey, useDeskCollapsed } from "@/board/desk-collapse";
import { useDeskPrefs, type DeskPrefs } from "@/board/desk-prefs";
import type { BoardItem } from "@/board/items";
import {
  DESK_ZONES_TEST_ID,
  checkpointNavKey,
  countDeskZone,
  deskEntryDomId,
  groupCounts,
  type DeskGroupCounts,
  type DeskZoneId,
} from "@/components/board/board-desk";
import { BoardGroupHeader, createTaskInGroup } from "@/components/board/board-group-header";
import { DeskBrief } from "@/components/board/desk-brief";
import {
  DeskDraggable,
  DeskDropTarget,
  DeskRankList,
  useDeskDragActive,
} from "@/components/board/desk-dnd";
import { DeskFlightRow } from "@/components/board/desk-flight-row";
import { DeskLandedRow } from "@/components/board/desk-landed-row";
import { DeskLaterTray } from "@/components/board/desk-later-tray";
import { BoardTaskCard } from "@/components/board/task-card";
import { ResizeHandle } from "@/components/resize-handle";
import { DensityIcon } from "@/components/ui/density-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";

type IconColor = Parameters<typeof DensityIcon>[0]["color"];
type HoverState = PressableStateCallbackType & { hovered?: boolean };
type DeskZoneSetting = BoardDeskSettings["zones"][number];
type Grouping = BoardDeskSettings["grouping"];

/** How each zone reads at a glance: the same state family as the sidebar's status dots. */
export const DESK_ZONE_META: Record<
  DeskZoneId,
  { labelKey: string; icon: typeof Circle; color: IconColor }
> = {
  decide: { labelKey: "board.desk.zones.decide", icon: CircleAlert, color: "statusDotWarning" },
  flight: { labelKey: "board.desk.zones.flight", icon: CircleDot, color: "statusDotRunning" },
  ahead: { labelKey: "board.desk.zones.ahead", icon: Circle, color: "foreground" },
  landed: { labelKey: "board.desk.zones.landed", icon: CircleCheck, color: "foregroundMuted" },
};

/** A host may rename a zone; an empty name falls back to the default label. */
export function deskZoneLabel(zone: DeskZoneSetting, t: TFunction): string {
  const custom = zone.name?.trim();
  return custom ? custom : t(DESK_ZONE_META[zone.id].labelKey);
}

export function DeskZoneIcon({ zone }: { zone: DeskZoneId }): ReactElement {
  const meta = DESK_ZONE_META[zone];
  return <DensityIcon icon={meta.icon} size="sm" color={meta.color} />;
}

/** What every zone needs to draw its rows. */
export interface DeskZoneContext {
  model: DeskModel;
  grouping: Grouping;
  /** Decide, Flight and Ahead counts per goal group, for Ahead headers. */
  groupCounts: ReadonlyMap<string, DeskGroupCounts>;
  showHost: boolean;
  selectedKey: string | null;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
  onOpenDetail: (item: BoardItem) => void;
  onEditTask: (card: BoardCard) => void;
}

export function DeskZoneHeader({
  zone,
  label,
  count,
  snoozedCount,
}: {
  zone: DeskZoneId;
  label: string;
  count: number;
  /** Decide only: how many checkpoints wait in Later. */
  snoozedCount?: number;
}): ReactElement {
  return (
    <View style={styles.zoneHeader} testID={`board-zone-header-${zone}`}>
      <DeskZoneIcon zone={zone} />
      <Text style={styles.zoneTitle} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.zoneCount}>{count}</Text>
      {snoozedCount !== undefined ? <LaterTarget count={snoozedCount} /> : null}
    </View>
  );
}

/** Drop a checkpoint here to put it off; it then waits in the Later tray. */
function LaterTarget({ count }: { count: number }): ReactElement {
  const { t } = useTranslation();
  const drag = useDeskDragActive();
  const dragging = drag?.type === "checkpoint";
  return (
    <DeskDropTarget target={LATER_TARGET} style={styles.laterSlot}>
      <View
        style={[styles.later, dragging && styles.laterArmed]}
        accessible
        accessibilityLabel={t("board.desk.later.label", { count })}
        testID="board-later-target"
      >
        <DensityIcon icon={Clock} size="sm" color="foregroundMuted" />
        <Text style={styles.laterText}>
          {dragging ? t("board.desk.later.drop") : t("board.desk.later.title")}
        </Text>
        {count > 0 && !dragging ? <Text style={styles.zoneCount}>{count}</Text> : null}
      </View>
    </DeskDropTarget>
  );
}

const LATER_TARGET = { type: "later" } as const;

/** A zone's rows, without the header or the scroll container. */
export function DeskZoneBody({
  zone,
  context,
}: {
  zone: DeskZoneId;
  context: DeskZoneContext;
}): ReactElement {
  switch (zone) {
    case "decide":
      return <DecideBody context={context} />;
    case "flight":
      return <ItemGroupsBody zone="flight" groups={context.model.flight} context={context} />;
    case "ahead":
      return <AheadBody context={context} />;
    case "landed":
      return <ItemGroupsBody zone="landed" groups={context.model.landed} context={context} />;
  }
}

function ZoneEmpty({ zone }: { zone: DeskZoneId }): ReactElement {
  const { t } = useTranslation();
  return (
    <Text style={styles.empty} testID={`board-zone-empty-${zone}`}>
      {t(`board.desk.empty.${zone}`)}
    </Text>
  );
}

function DecideBody({ context }: { context: DeskZoneContext }): ReactElement {
  const { model, selectedKey, onOpenDetail } = context;
  return (
    <>
      {model.decide.length === 0 ? <ZoneEmpty zone="decide" /> : null}
      {model.decide.map((checkpoint) => (
        <DecideRow
          key={checkpoint.key}
          checkpoint={checkpoint}
          selected={checkpointNavKey(checkpoint) === selectedKey}
          onOpenDetail={onOpenDetail}
        />
      ))}
      {model.snoozed.length > 0 ? <DeskLaterTray checkpoints={model.snoozed} /> : null}
    </>
  );
}

function DecideRow({
  checkpoint,
  selected,
  onOpenDetail,
}: {
  checkpoint: DeskCheckpoint;
  selected: boolean;
  onOpenDetail: (item: BoardItem) => void;
}): ReactElement {
  const payload = useMemo(() => ({ type: "checkpoint" as const, checkpoint }), [checkpoint]);
  return (
    <View nativeID={deskEntryDomId(checkpointNavKey(checkpoint))}>
      <DeskDraggable payload={payload}>
        <DeskBrief checkpoint={checkpoint} selected={selected} onOpenDetail={onOpenDetail} />
      </DeskDraggable>
    </View>
  );
}

function ItemGroupsBody({
  zone,
  groups,
  context,
}: {
  zone: "flight" | "landed";
  groups: readonly DeskGroup<BoardItem[]>[];
  context: DeskZoneContext;
}): ReactElement {
  if (groups.length === 0) return <ZoneEmpty zone={zone} />;
  return (
    <>
      {groups.map((group) => (
        <ItemGroup key={group.key} zone={zone} group={group} context={context} />
      ))}
    </>
  );
}

function ItemGroup({
  zone,
  group,
  context,
}: {
  zone: "flight" | "landed";
  group: DeskGroup<BoardItem[]>;
  context: DeskZoneContext;
}): ReactElement {
  const { grouping, showHost, selectedKey, focus, onFocus, onOpenDetail, onEditTask } = context;
  const { collapsed, toggle } = useDeskCollapsed(deskGroupCollapseKey(zone, group.key));
  return (
    <View style={styles.group}>
      <BoardGroupHeader
        group={group}
        grouping={grouping}
        collapsed={collapsed}
        onToggleCollapse={toggle}
        counts={null}
        count={group.entries.length}
        showHost={showHost}
        focus={focus}
        onFocus={onFocus}
      />
      {collapsed
        ? null
        : group.entries.map((item) => (
            <View key={item.key} nativeID={deskEntryDomId(item.key)}>
              {zone === "flight" ? (
                <DeskFlightRow
                  item={item}
                  onEditTask={onEditTask}
                  showHost={showHost}
                  showGoal={grouping !== "goal"}
                  selected={item.key === selectedKey}
                  onOpenDetail={onOpenDetail}
                />
              ) : (
                <DeskLandedRow
                  item={item}
                  onEditTask={onEditTask}
                  showHost={showHost}
                  onOpenDetail={onOpenDetail}
                />
              )}
            </View>
          ))}
    </View>
  );
}

function AheadBody({ context }: { context: DeskZoneContext }): ReactElement {
  const { model } = context;
  if (model.ahead.length === 0) return <ZoneEmpty zone="ahead" />;
  return (
    <>
      {model.ahead.map((group) => (
        <AheadGroup key={group.key} group={group} context={context} />
      ))}
    </>
  );
}

function AheadGroup({
  group,
  context,
}: {
  group: DeskGroup<DeskAheadEntries>;
  context: DeskZoneContext;
}): ReactElement {
  const { t } = useTranslation();
  const { grouping, showHost, focus, onFocus } = context;
  const drag = useDeskDragActive();
  const { collapsed, toggle } = useDeskCollapsed(deskGroupCollapseKey("ahead", group.key));
  const fogFold = useDeskCollapsed(deskFogCollapseKey(group.key));
  const { ready, fog } = group.entries;
  const goal = group.subject.type === "goal" ? group.subject.goal : null;
  // Autopilot takes the first frontier task of its goal; ready cards are already in rank order.
  const nextKey = goal?.autopilot?.enabled
    ? (ready.find((card) => card.onFrontier)?.key ?? null)
    : null;
  const createFog = useCallback(
    () => createTaskInGroup({ group, grouping, stage: "fog" }),
    [group, grouping],
  );
  const showFog = fog.length > 0 || drag?.type === "task";
  // A drag unfolds Fog so the task has somewhere to land.
  const fogCollapsed = fogFold.collapsed && drag?.type !== "task";
  const header = (
    <BoardGroupHeader
      group={group}
      grouping={grouping}
      collapsed={collapsed}
      onToggleCollapse={toggle}
      counts={groupCounts(context.groupCounts, group.key)}
      showHost={showHost}
      focus={focus}
      onFocus={onFocus}
    />
  );
  if (collapsed) return <View style={styles.group}>{header}</View>;

  return (
    <View style={styles.group}>
      {header}
      <AheadList
        group={group}
        stage="ready"
        cards={ready}
        nextKey={nextKey}
        // With ideas in Fog an empty Ready list needs no placeholder line.
        emptyLabel={fog.length > 0 ? null : t("board.desk.empty.group")}
        context={context}
      />
      {showFog ? (
        <>
          <View style={styles.stageHeader}>
            <PressHighlight
              accessibilityRole="button"
              accessibilityState={fogCollapsed ? COLLAPSED_STATE : EXPANDED_STATE}
              accessibilityLabel={t(
                fogCollapsed ? "board.ui.expandGroup" : "board.ui.collapseGroup",
                {
                  group: t("board.desk.stages.fog"),
                },
              )}
              onPress={fogFold.toggle}
              style={stageToggleStyle}
              testID={`board-fog-toggle-${group.key}`}
            >
              <DensityIcon
                icon={fogCollapsed ? ChevronRight : ChevronDown}
                size="sm"
                color="foregroundMuted"
              />
              <Text style={styles.stageTitle}>{t("board.desk.stages.fog")}</Text>
              <Text style={styles.zoneCount}>{fog.length}</Text>
            </PressHighlight>
            {group.serverId ? (
              <View style={styles.stageActions}>
                <ToolbarButton
                  compact
                  label={t("board.desk.group.addFog")}
                  onPress={createFog}
                  testID={`board-group-add-fog-${group.key}`}
                >
                  <DensityIcon icon={Plus} size="sm" color="foregroundMuted" />
                </ToolbarButton>
              </View>
            ) : null}
          </View>
          {fogCollapsed ? null : (
            <AheadList
              group={group}
              stage="fog"
              cards={fog}
              nextKey={null}
              emptyLabel={t("board.desk.stages.fogEmpty")}
              context={context}
            />
          )}
        </>
      ) : null}
    </View>
  );
}

/**
 * One stage's cards. On web every card drags and takes a task dropped on it (wait for it), with an
 * insertion slot above each card; on phones a long press reorders within the list.
 */
function AheadList({
  group,
  stage,
  cards,
  nextKey,
  emptyLabel,
  context,
}: {
  group: DeskGroup<DeskAheadEntries>;
  stage: "fog" | "ready";
  cards: readonly BoardCard[];
  nextKey: string | null;
  emptyLabel: string | null;
  context: DeskZoneContext;
}): ReactElement {
  const { t } = useTranslation();
  const { showHost, selectedKey, onOpenDetail, onEditTask, grouping } = context;
  const showGoal = grouping !== "goal";
  const moves = useMemo(() => buildBacklogMoves(cards), [cards]);
  const goalId =
    grouping === "goal" && group.subject.type === "goal" ? group.subject.goal.id : null;
  const renderCard = useCallback(
    (card: BoardCard, state: { isActive: boolean; drag?: () => void }) => (
      <AheadCard
        card={card}
        isNext={card.key === nextKey}
        move={moves.get(card.key)}
        showHost={showHost}
        showGoal={showGoal}
        selected={card.key === selectedKey || state.isActive}
        onOpenDetail={onOpenDetail}
        onEditTask={onEditTask}
        onDragStart={state.drag}
      />
    ),
    [moves, nextKey, onEditTask, onOpenDetail, selectedKey, showGoal, showHost],
  );

  return (
    <View testID={`board-ahead-${stage}-${group.key}`}>
      {stage === "ready" && cards.length > 0 ? (
        <View style={styles.stageHeader}>
          <Text style={styles.stageTitle}>{t("board.desk.stages.ready")}</Text>
          <Text style={styles.zoneCount}>{cards.length}</Text>
        </View>
      ) : null}
      {cards.length === 0 && emptyLabel ? <Text style={styles.slotLabel}>{emptyLabel}</Text> : null}
      {group.serverId ? (
        <DeskRankList
          serverId={group.serverId}
          goalId={goalId}
          stage={stage}
          cards={cards}
          renderCard={renderCard}
        />
      ) : (
        cards.map((card) => <View key={card.key}>{renderCard(card, { isActive: false })}</View>)
      )}
    </View>
  );
}

function AheadCard({
  card,
  isNext,
  move,
  showHost,
  showGoal,
  selected,
  onOpenDetail,
  onEditTask,
  onDragStart,
}: {
  card: BoardCard;
  isNext: boolean;
  move: BacklogMove | undefined;
  showHost: boolean;
  showGoal: boolean;
  selected: boolean;
  onOpenDetail: (item: BoardItem) => void;
  onEditTask: (card: BoardCard) => void;
  onDragStart?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View nativeID={deskEntryDomId(card.key)} style={isNext ? styles.nextCard : undefined}>
      {isNext ? (
        <Text style={styles.nextLabel} testID="board-autopilot-next">
          {t("board.plan.autopilotNext")}
        </Text>
      ) : null}
      <BoardTaskCard
        card={card}
        move={move}
        showHost={showHost}
        showGoal={showGoal}
        onEdit={onEditTask}
        selected={selected}
        onSelect={onOpenDetail}
        onDragStart={onDragStart}
      />
    </View>
  );
}

const COLLAPSED_STATE = { expanded: false };
const EXPANDED_STATE = { expanded: true };

function stageToggleStyle({ hovered = false, pressed }: HoverState) {
  return [styles.stageToggle, (hovered || pressed) && styles.stageToggleHovered];
}

const DEFAULT_ZONE_WIDTHS: Record<DeskZoneId, number> = {
  decide: 380,
  flight: 300,
  ahead: 340,
  landed: 260,
};
const MIN_ZONE_WIDTH = 240;

function zoneSizes(zones: readonly DeskZoneSetting[], widths: DeskPrefs["zoneWidths"]): number[] {
  const weights = zones.map((zone) => widths[zone.id] ?? DEFAULT_ZONE_WIDTHS[zone.id]);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (total > 0 ? weight / total : 1 / zones.length));
}

/**
 * Wide layouts lay the zones out side by side in the host's order. Widths are this device's
 * preference; the dividers between zones resize their two neighbours.
 */
export function BoardWideZones({
  zones,
  context,
}: {
  zones: readonly DeskZoneSetting[];
  context: DeskZoneContext;
}): ReactElement {
  const { t } = useTranslation();
  const { prefs, update } = useDeskPrefs();
  const [viewportWidth, setViewportWidth] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  const [preview, setPreview] = useState<number[] | null>(null);
  const sizes = useMemo(
    () => preview ?? zoneSizes(zones, prefs.zoneWidths),
    [preview, prefs.zoneWidths, zones],
  );
  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
  }, []);
  // A horizontal scroll content sizes to its content's natural width, which lets long rows push
  // the zones past the window. Pinning it to the viewport makes the zones share what is visible
  // and scroll only when every zone is at its minimum.
  const contentStyle = useMemo(() => {
    const minWidth = zones.length * MIN_ZONE_WIDTH;
    return [
      styles.zonesContent,
      viewportWidth > 0 ? { width: Math.max(viewportWidth, minWidth) } : { minWidth },
    ];
  }, [viewportWidth, zones.length]);
  const previewSizes = useCallback((_group: string, next: number[]) => setPreview(next), []);
  const commitSizes = useCallback(
    (_group: string, next: number[]) => {
      setPreview(null);
      if (rowWidth <= 0) return;
      const zoneWidths = { ...prefs.zoneWidths };
      zones.forEach((zone, index) => {
        zoneWidths[zone.id] = Math.round((next[index] ?? 0) * rowWidth);
      });
      update({ zoneWidths });
    },
    [prefs.zoneWidths, rowWidth, update, zones],
  );

  return (
    <ScrollView
      horizontal
      style={styles.zonesScroll}
      contentContainerStyle={contentStyle}
      onLayout={handleViewportLayout}
      showsHorizontalScrollIndicator={false}
      testID={DESK_ZONES_TEST_ID}
    >
      <View style={styles.zonesRow} onLayout={handleLayout}>
        {zones.map((zone, index) => (
          <View
            key={zone.id}
            style={[styles.zoneSlot, { flexGrow: sizes[index] ?? 1 }]}
            testID={`board-zone-${zone.id}`}
          >
            <View style={styles.zone}>
              <DeskZoneHeader
                zone={zone.id}
                label={deskZoneLabel(zone, t)}
                count={countDeskZone(context.model, zone.id)}
                snoozedCount={zone.id === "decide" ? context.model.snoozed.length : undefined}
              />
              <ScrollView
                style={styles.zoneScroll}
                contentContainerStyle={styles.zoneList}
                showsVerticalScrollIndicator={false}
              >
                <DeskZoneBody zone={zone.id} context={context} />
              </ScrollView>
            </View>
            {index < zones.length - 1 ? (
              <ResizeHandle
                testID={`board-zone-resize-${zone.id}`}
                direction="horizontal"
                groupId="desk-zones"
                index={index}
                sizes={sizes}
                containerSize={rowWidth}
                onPreviewResizeSplit={previewSizes}
                onResizeSplit={commitSizes}
              />
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  zonesScroll: {
    flex: 1,
    minHeight: 0,
  },
  zonesContent: {
    flexGrow: 1,
  },
  zonesRow: {
    flex: 1,
    flexDirection: "row",
  },
  zoneSlot: {
    flexBasis: 0,
    flexShrink: 0,
    minWidth: MIN_ZONE_WIDTH,
    minHeight: 0,
    flexDirection: "row",
  },
  zone: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    margin: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  zoneScroll: {
    flex: 1,
    minHeight: 0,
  },
  zoneList: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[6],
  },
  zoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  zoneTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  zoneCount: {
    minWidth: theme.spacing[4],
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  laterSlot: {
    marginLeft: "auto",
  },
  later: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 24,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  laterArmed: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.interactionHighlight,
  },
  laterText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
  },
  group: {
    gap: theme.spacing[2],
  },
  stageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 24,
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  stageTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  stageToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: 24,
    marginLeft: -theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  stageToggleHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  stageActions: {
    marginLeft: "auto",
  },
  slotLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  nextCard: {
    gap: theme.spacing[1],
  },
  nextLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[1],
  },
}));
