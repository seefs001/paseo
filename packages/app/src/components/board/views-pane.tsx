import type { BoardGoal } from "@getpaseo/protocol/messages";
import { Plus } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DeskGoalFocus } from "@/board/desk";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { groupCounts, type DeskGroupCounts } from "@/components/board/board-desk";
import { GoalMenuItems, goalNumber } from "@/components/board/board-group-header";
import { DeskDropTarget } from "@/components/board/desk-dnd";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { PressHighlight } from "@/components/ui/press-highlight";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** A host's unlanded goals in rank order, as the pane and the focus menu list them. */
export interface DeskPaneHost {
  serverId: string;
  serverName: string;
  goals: readonly BoardGoal[];
}

function sameFocus(a: DeskGoalFocus | null, b: DeskGoalFocus | null): boolean {
  if (a === null || b === null) return a === b;
  return a.serverId === b.serverId && a.goalId === b.goalId;
}

function goalKey(serverId: string, goalId: string | null): string {
  return goalId ? `${serverId}:goal:${goalId}` : `${serverId}:loose`;
}

interface BoardViewsPaneProps {
  hosts: readonly DeskPaneHost[];
  showHost: boolean;
  /** Decide, Flight and Ahead counts per goal, unaffected by focus. */
  counts: ReadonlyMap<string, DeskGroupCounts>;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
}

/**
 * The Desk's left pane: every goal with its counts. Selecting a goal
 * focuses the Desk on it; dropping a task on a goal assigns it.
 */
export function BoardViewsPane({
  hosts,
  showHost,
  counts,
  focus,
  onFocus,
}: BoardViewsPaneProps): ReactElement {
  const { t } = useTranslation();
  const showAll = useCallback(() => onFocus(null), [onFocus]);
  const createHost = hosts[0]?.serverId;
  const createGoal = useCallback(() => {
    if (createHost) openDeskGoalSheet({ mode: "create", serverId: createHost });
  }, [createHost]);

  return (
    <View style={styles.pane} testID="board-goals-pane">
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("board.desk.pane.goals")}</Text>
        <PaneRow
          label={t("board.desk.pane.everything")}
          active={focus === null}
          onPress={showAll}
          testID="board-focus-all"
        />
        {hosts.map((host) => (
          <View key={host.serverId} style={styles.hostGroup}>
            {showHost ? (
              <Text style={styles.hostLabel} numberOfLines={1}>
                {host.serverName}
              </Text>
            ) : null}
            {host.goals.map((goal) => (
              <GoalRow
                key={goal.id}
                serverId={host.serverId}
                goal={goal}
                counts={groupCounts(counts, goalKey(host.serverId, goal.id))}
                focus={focus}
                onFocus={onFocus}
              />
            ))}
            <GoalRow
              serverId={host.serverId}
              goal={null}
              counts={groupCounts(counts, goalKey(host.serverId, null))}
              focus={focus}
              onFocus={onFocus}
            />
          </View>
        ))}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          onPress={createGoal}
          disabled={!createHost}
          style={styles.newGoal}
          testID="board-pane-new-goal"
        >
          {t("board.desk.newGoal")}
        </Button>
      </View>
    </View>
  );
}

/** A goal, or Loose work when `goal` is null. */
function GoalRow({
  serverId,
  goal,
  counts,
  focus,
  onFocus,
}: {
  serverId: string;
  goal: BoardGoal | null;
  counts: DeskGroupCounts;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const goalId = goal?.id ?? null;
  const target = useMemo(() => ({ type: "goal" as const, serverId, goalId }), [goalId, serverId]);
  const rowFocus = useMemo(() => ({ serverId, goalId }), [goalId, serverId]);
  const active = sameFocus(focus, rowFocus);
  const press = useCallback(() => onFocus(active ? null : rowFocus), [active, onFocus, rowFocus]);
  const menu = useMemo(
    () =>
      goal ? (
        <GoalMenuItems serverId={serverId} goal={goal} focused={active} onFocus={onFocus} />
      ) : undefined,
    [active, goal, onFocus, serverId],
  );
  return (
    <DeskDropTarget target={target}>
      <PaneRow
        number={goal ? goalNumber(goal) : undefined}
        label={goal ? goal.title : t("board.desk.loose.goal")}
        counts={counts}
        active={active}
        onPress={press}
        menu={menu}
        testID={`board-pane-goal-${goalId ?? `loose-${serverId}`}`}
      />
    </DeskDropTarget>
  );
}

function rowStyle(active: boolean) {
  return ({ hovered, pressed }: HoverState) => [
    styles.row,
    active && styles.rowActive,
    hovered && !active && styles.rowHovered,
    pressed && styles.rowPressed,
  ];
}

function PaneRow({
  number,
  label,
  counts,
  active,
  onPress,
  menu,
  testID,
}: {
  number?: string;
  label: string;
  counts?: DeskGroupCounts;
  active: boolean;
  onPress: () => void;
  /** Rows for a right click on the row. */
  menu?: ReactElement;
  testID: string;
}): ReactElement {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const accessibilityLabel = counts
    ? `${label}, ${t("board.desk.group.countsLabel", {
        decide: counts.decide,
        flight: counts.flight,
        ahead: counts.ahead,
      })}`
    : label;
  const content = (
    <>
      {number ? <Text style={styles.number}>{number}</Text> : null}
      <Text style={active ? styles.rowLabelActive : styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {counts ? (
        <View style={styles.counts}>
          {counts.decide > 0 ? (
            <View style={styles.countItem}>
              <View style={[styles.dot, styles.dotDecide]} />
              <Text style={styles.decideCount}>{counts.decide}</Text>
            </View>
          ) : null}
          {counts.flight > 0 ? (
            <View style={styles.countItem}>
              <View style={[styles.dot, styles.dotFlight]} />
              <Text style={styles.count}>{counts.flight}</Text>
            </View>
          ) : null}
          <Text style={styles.count}>{counts.ahead}</Text>
        </View>
      ) : null}
    </>
  );
  if (menu) {
    return (
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger
          // The row is also a drop target for dragged tasks; long press stays with drag.
          enabledOnMobile={false}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={accessibilityLabel}
          onPress={onPress}
          style={rowStyle(active || menuOpen)}
          highlightStyle={styles.rowPressed}
          testID={testID}
        >
          {content}
        </ContextMenuTrigger>
        <ContextMenuContent align="start" width={220} testID={`${testID}-context`}>
          {menu}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={rowStyle(active)}
      highlightStyle={styles.rowPressed}
      testID={testID}
    >
      {content}
    </PressHighlight>
  );
}

/** Compact layouts focus a goal from the header instead of the pane. */
export function BoardFocusMenu({
  hosts,
  showHost,
  focus,
  onFocus,
}: {
  hosts: readonly DeskPaneHost[];
  showHost: boolean;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const showAll = useCallback(() => onFocus(null), [onFocus]);
  const focusedGoal = focus
    ? hosts
        .find((host) => host.serverId === focus.serverId)
        ?.goals.find((goal) => goal.id === focus.goalId)
    : undefined;
  let label = t("board.desk.pane.everything");
  if (focusedGoal) label = `${goalNumber(focusedGoal)} ${focusedGoal.title}`;
  else if (focus) label = t("board.desk.loose.goal");

  return (
    <DropdownMenu>
      <DropdownTrigger size="sm" testID="board-focus-picker">
        {label}
      </DropdownTrigger>
      <DropdownMenuContent align="end" sheetTitle={t("board.desk.pane.goals")}>
        <DropdownMenuItem selected={focus === null} onSelect={showAll} testID="board-focus-all">
          {t("board.desk.pane.everything")}
        </DropdownMenuItem>
        {hosts.map((host) => (
          <FocusHostItems
            key={host.serverId}
            host={host}
            showHost={showHost}
            focus={focus}
            onFocus={onFocus}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FocusHostItems({
  host,
  showHost,
  focus,
  onFocus,
}: {
  host: DeskPaneHost;
  showHost: boolean;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const suffix = showHost ? ` (${host.serverName})` : "";
  return (
    <>
      {host.goals.map((goal) => (
        <FocusItem
          key={goal.id}
          focus={focus}
          serverId={host.serverId}
          goalId={goal.id}
          label={`${goalNumber(goal)} ${goal.title}${suffix}`}
          onFocus={onFocus}
        />
      ))}
      <FocusItem
        focus={focus}
        serverId={host.serverId}
        goalId={null}
        label={`${t("board.desk.loose.goal")}${suffix}`}
        onFocus={onFocus}
      />
    </>
  );
}

function FocusItem({
  focus,
  serverId,
  goalId,
  label,
  onFocus,
}: {
  focus: DeskGoalFocus | null;
  serverId: string;
  goalId: string | null;
  label: string;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const target = useMemo(() => ({ serverId, goalId }), [goalId, serverId]);
  const select = useCallback(() => onFocus(target), [onFocus, target]);
  return (
    <DropdownMenuItem
      selected={sameFocus(focus, target)}
      onSelect={select}
      testID={`board-focus-${target.goalId ?? `loose-${target.serverId}`}`}
    >
      {label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: {
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  section: {
    gap: theme.spacing[0.5],
  },
  sectionLabel: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  hostGroup: {
    gap: theme.spacing[0.5],
  },
  hostLabel: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  number: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowLabelActive: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  counts: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  countItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  dot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  dotDecide: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotFlight: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  decideCount: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  newGoal: {
    alignSelf: "flex-start",
  },
}));
