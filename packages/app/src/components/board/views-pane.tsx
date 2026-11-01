import type { BoardGoal } from "@getpaseo/protocol/messages";
import { Bookmark, Plus } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DeskGoalFocus } from "@/board/desk";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { hasBoardFilters, type BoardFilters } from "@/board/items";
import {
  BOARD_BUILTIN_VIEWS,
  boardViewLabel,
  useSavedBoardViews,
  type BoardView,
} from "@/board/views";
import { groupCounts, type DeskGroupCounts } from "@/components/board/board-desk";
import { GoalMenuItems, goalNumber } from "@/components/board/board-group-header";
import { DeskDropTarget } from "@/components/board/desk-dnd";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { FormTextInput } from "@/components/ui/form-field";
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
  activeViewId: string;
  onSelectView: (view: BoardView) => void;
  filters: BoardFilters;
}

/**
 * The Desk's left pane: saved filter views, then every goal with its counts. Selecting a goal
 * focuses the Desk on it; dropping a task on a goal assigns it.
 */
export function BoardViewsPane({
  hosts,
  showHost,
  counts,
  focus,
  onFocus,
  activeViewId,
  onSelectView,
  filters,
}: BoardViewsPaneProps): ReactElement {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const { save } = useSavedBoardViews();
  const startNaming = useCallback(() => setNaming(true), []);
  const stopNaming = useCallback(() => setNaming(false), []);
  const saveView = useCallback(
    (name: string) => {
      const view = save(name, filters);
      setNaming(false);
      onSelectView(view);
    },
    [filters, onSelectView, save],
  );
  const showAll = useCallback(() => onFocus(null), [onFocus]);
  const createHost = hosts[0]?.serverId;
  const createGoal = useCallback(() => {
    if (createHost) openDeskGoalSheet({ mode: "create", serverId: createHost });
  }, [createHost]);
  // A view that narrows nothing would duplicate All.
  const canSave = hasBoardFilters(filters);

  return (
    <View style={styles.pane} testID="board-goals-pane">
      <View style={styles.viewsRow}>
        <BoardViewMenu activeViewId={activeViewId} onSelectView={onSelectView} />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={Bookmark}
          onPress={startNaming}
          disabled={!canSave}
          accessibilityLabel={t("board.desk.views.save")}
          accessibilityHint={canSave ? undefined : t("board.desk.views.saveHint")}
          testID="board-views-save"
        />
      </View>
      {naming ? <SaveViewForm onSave={saveView} onCancel={stopNaming} /> : null}
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
          size="xs"
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

/** Saved filter views: pick one, or remove one from the page below. */
export function BoardViewMenu({
  activeViewId,
  onSelectView,
}: {
  activeViewId: string;
  onSelectView: (view: BoardView) => void;
}): ReactElement {
  const { t } = useTranslation();
  const saved = useSavedBoardViews();
  const views = useMemo(() => [...BOARD_BUILTIN_VIEWS, ...saved.views], [saved.views]);
  const active = views.find((view) => view.id === activeViewId) ?? BOARD_BUILTIN_VIEWS[0];
  const { remove } = saved;
  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: "remove",
        title: t("board.desk.views.removeTitle"),
        content: (
          <>
            {saved.views.map((view) => (
              <RemoveViewItem key={view.id} view={view} onRemove={remove} />
            ))}
          </>
        ),
      },
    ],
    [remove, saved.views, t],
  );
  return (
    <DropdownMenu>
      <DropdownTrigger size="xs" testID="board-view-picker">
        {active ? boardViewLabel(active, t) : t("board.desk.views.all")}
      </DropdownTrigger>
      <DropdownMenuContent
        align="start"
        width={240}
        pages={pages}
        sheetTitle={t("board.desk.views.title")}
      >
        {views.map((view) => (
          <ViewItem
            key={view.id}
            view={view}
            selected={view.id === active?.id}
            onSelectView={onSelectView}
          />
        ))}
        {saved.views.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSubTrigger id="remove" testID="board-views-remove">
              {t("board.desk.views.removeTitle")}
            </DropdownMenuSubTrigger>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewItem({
  view,
  selected,
  onSelectView,
}: {
  view: BoardView;
  selected: boolean;
  onSelectView: (view: BoardView) => void;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => onSelectView(view), [onSelectView, view]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select} testID={`board-view-${view.id}`}>
      {boardViewLabel(view, t)}
    </DropdownMenuItem>
  );
}

function RemoveViewItem({
  view,
  onRemove,
}: {
  view: BoardView;
  onRemove: (id: string) => void;
}): ReactElement {
  const remove = useCallback(() => onRemove(view.id), [onRemove, view.id]);
  return (
    <DropdownMenuItem destructive onSelect={remove} testID={`board-view-remove-${view.id}`}>
      {view.name}
    </DropdownMenuItem>
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
      <DropdownTrigger size="xs" testID="board-focus-picker">
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

function SaveViewForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string) => void;
  onCancel: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const canSave = name.trim().length > 0;
  const submit = useCallback(() => {
    if (canSave) onSave(name);
  }, [canSave, name, onSave]);

  return (
    <View style={styles.saveForm}>
      <FormTextInput
        size="xs"
        initialValue=""
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder={t("board.desk.views.namePlaceholder")}
        accessibilityLabel={t("board.desk.views.name")}
        maxLength={60}
        autoFocus
        testID="board-views-name"
      />
      <View style={styles.saveActions}>
        <Button variant="ghost" size="xs" onPress={onCancel}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onPress={submit}
          disabled={!canSave}
          testID="board-views-save-confirm"
        >
          {t("common.actions.save")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pane: {
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  viewsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
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
  saveForm: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  saveActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
