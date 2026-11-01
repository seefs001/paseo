import type { BoardDeskSettings, BoardGoal } from "@getpaseo/protocol/messages";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheckBig,
  Crosshair,
  MoreHorizontal,
  Pencil,
  Plus,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DeskGoalFocus, DeskGroup, DeskGroupSubject } from "@/board/desk";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { openBoardTaskSheet } from "@/board/sheet";
import { updateBoardGoal } from "@/board/tasks";
import type { DeskGroupCounts } from "@/components/board/board-desk";
import { DeskDropTarget } from "@/components/board/desk-dnd";
import { useClaimantName } from "@/components/board/review-claim";
import { DESK_MENU_ICON_SIZE } from "@/components/board/task-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useToast } from "@/contexts/toast-context";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";

type Grouping = BoardDeskSettings["grouping"];
type GroupHead = Omit<DeskGroup<unknown>, "entries">;
type HoverState = PressableStateCallbackType & { hovered?: boolean };

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
function menuIcon(icon: typeof Plus): ReactElement {
  const Themed = withUnistyles(icon);
  return <Themed size={DESK_MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
}
const createLeading = menuIcon(Plus);
const collapseLeading = menuIcon(ChevronsDownUp);
const expandLeading = menuIcon(ChevronsUpDown);
const editLeading = menuIcon(Pencil);
const focusLeading = menuIcon(Crosshair);
const landLeading = menuIcon(CircleCheckBig);

/** What a group is called; work without a subject reads per grouping. */
export function deskGroupLabel(
  subject: DeskGroupSubject,
  grouping: Grouping,
  t: TFunction,
): string {
  switch (subject.type) {
    case "goal":
      return subject.goal.title;
    case "project":
      return subject.project.projectCustomName ?? subject.project.projectDisplayName;
    case "host":
      return subject.serverName;
    case "agent":
      return subject.provider;
    case "loose":
      return t(`board.desk.loose.${grouping}`);
  }
}

export function goalNumber(goal: BoardGoal): string {
  return `G-${goal.number}`;
}

/** The goal a new task in this group joins; `undefined` when the group is not about goals. */
function groupGoalId(group: GroupHead, grouping: Grouping): string | null | undefined {
  if (group.subject.type === "goal") return group.subject.goal.id;
  if (group.subject.type === "loose" && grouping === "goal") return null;
  return undefined;
}

/** Opens the task sheet on this group's host, goal or project, in the given stage. */
export function createTaskInGroup(input: {
  group: GroupHead;
  grouping: Grouping;
  stage: "fog" | "ready";
}): void {
  const { group, grouping, stage } = input;
  if (!group.serverId) return;
  const goalId = groupGoalId(group, grouping);
  openBoardTaskSheet({
    mode: "create",
    serverId: group.serverId,
    stage,
    ...(goalId !== undefined ? { goalId } : {}),
    ...(group.subject.type === "project" ? { projectId: group.subject.project.projectId } : {}),
  });
}

function autopilotLabel(goal: BoardGoal, t: TFunction): string | null {
  if (!goal.autopilot) return null;
  if (!goal.autopilot.enabled) return t("board.desk.goal.autopilotOff");
  if (goal.autopilot.confirmStarts) return t("board.desk.goal.autopilotConfirm");
  return t("board.desk.goal.autopilotOn", {
    count: goal.startsToday,
    limit: goal.autopilot.dailyStartLimit,
  });
}

interface BoardGroupHeaderProps {
  group: GroupHead;
  grouping: Grouping;
  /** A folded group shows only its header; pressing the title folds and unfolds it. */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Ahead headers carry the group's counts, its actions and the goal drop target. */
  counts: DeskGroupCounts | null;
  /** Flight and Landed headers show how many rows follow. */
  count?: number;
  showHost: boolean;
  focus: DeskGoalFocus | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
}

export function BoardGroupHeader({
  group,
  grouping,
  collapsed,
  onToggleCollapse,
  counts,
  count,
  showHost,
  focus,
  onFocus,
}: BoardGroupHeaderProps): ReactElement {
  const { t } = useTranslation();
  const { subject } = group;
  const goal = subject.type === "goal" ? subject.goal : null;
  const label = deskGroupLabel(subject, grouping, t);
  const goalId = groupGoalId(group, grouping);
  const create = useCallback(
    () => createTaskInGroup({ group, grouping, stage: "ready" }),
    [group, grouping],
  );
  const { serverId } = group;
  const dropTarget = useMemo(
    () =>
      counts && goalId !== undefined && serverId
        ? { type: "goal" as const, serverId, goalId }
        : null,
    [counts, goalId, serverId],
  );

  const focused = isFocusedGoal(focus, group.serverId, goal);
  const head = (
    <View style={styles.header} testID={`board-group-${group.key}`}>
      <View style={styles.titleRow}>
        <GroupContextMenu
          group={group}
          goal={goal}
          label={label}
          collapsed={collapsed}
          focused={focused}
          onToggleCollapse={onToggleCollapse}
          onCreate={group.serverId ? create : null}
          onFocus={onFocus}
        >
          <View style={styles.chevron}>
            <DensityIcon
              icon={collapsed ? ChevronRight : ChevronDown}
              size="sm"
              color="foregroundMuted"
            />
          </View>
          {goal ? <Text style={styles.number}>{goalNumber(goal)}</Text> : null}
          <Text style={styles.title} numberOfLines={1}>
            {label}
          </Text>
          {showHost && group.serverId && subject.type !== "host" ? (
            <HostName serverId={group.serverId} />
          ) : null}
          {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
          {collapsed && counts ? <Text style={styles.count}>{counts.ahead}</Text> : null}
        </GroupContextMenu>
        {counts ? (
          <View style={styles.actions}>
            {group.serverId ? (
              <ToolbarButton
                compact
                label={t("board.desk.group.addTask", { group: label })}
                onPress={create}
                testID={`board-group-add-${group.key}`}
              >
                <DensityIcon icon={Plus} size="sm" color="foregroundMuted" />
              </ToolbarButton>
            ) : null}
            {goal && group.serverId ? (
              <GoalMenu
                serverId={group.serverId}
                goal={goal}
                label={label}
                focused={focused}
                onFocus={onFocus}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {counts && !collapsed ? (
        <GroupFacts goal={goal} serverId={group.serverId} counts={counts} />
      ) : null}
    </View>
  );

  if (!dropTarget) return head;
  return <DeskDropTarget target={dropTarget}>{head}</DeskDropTarget>;
}

function isFocusedGoal(
  focus: DeskGoalFocus | null,
  serverId: string | null,
  goal: BoardGoal | null,
): boolean {
  return goal !== null && focus?.serverId === serverId && focus.goalId === goal.id;
}

/** The host name stays out of the label so the goal title keeps its room. */
function HostName({ serverId }: { serverId: string }): ReactNode {
  const name = useHosts().find((host) => host.serverId === serverId)?.label;
  return name ? (
    <Text style={styles.host} numberOfLines={1}>
      {name}
    </Text>
  ) : null;
}

function GroupFacts({
  goal,
  serverId,
  counts,
}: {
  goal: BoardGoal | null;
  serverId: string | null;
  counts: DeskGroupCounts;
}): ReactElement {
  const { t } = useTranslation();
  const owner = useClaimantName(serverId ?? "", goal?.ownerAgentId ?? null);
  const autopilot = goal ? autopilotLabel(goal, t) : null;
  return (
    <>
      <View style={styles.facts}>
        <Text
          style={styles.fact}
          accessibilityLabel={t("board.desk.group.countsLabel", {
            decide: counts.decide,
            flight: counts.flight,
            ahead: counts.ahead,
          })}
        >
          {counts.decide > 0 ? (
            <Text style={styles.decideCount}>
              {t("board.desk.group.decideCount", { count: counts.decide })}
              {" · "}
            </Text>
          ) : null}
          {t("board.desk.group.flightCount", { count: counts.flight })}
          {" · "}
          {t("board.desk.group.aheadCount", { count: counts.ahead })}
        </Text>
        {owner ? (
          <Text style={styles.fact} numberOfLines={1}>
            {t("board.desk.goal.owner", { name: owner })}
          </Text>
        ) : null}
        {autopilot ? (
          <View style={styles.autopilot}>
            <DensityIcon
              icon={Bot}
              size="sm"
              color={goal?.autopilot?.enabled ? "statusDotRunning" : "foregroundMuted"}
            />
            <Text style={styles.fact} numberOfLines={1}>
              {autopilot}
            </Text>
          </View>
        ) : null}
      </View>
      {goal?.lastAutopilotError ? (
        <Text style={styles.error} numberOfLines={2}>
          {t("board.plan.lastError", { message: goal.lastAutopilotError })}
        </Text>
      ) : null}
    </>
  );
}

/**
 * A group's title row as its context menu: new task, fold, and the goal's own actions. Pressing it
 * folds the group.
 */
function GroupContextMenu({
  group,
  goal,
  label,
  collapsed,
  focused,
  onToggleCollapse,
  onCreate,
  onFocus,
  children,
}: {
  group: GroupHead;
  goal: BoardGoal | null;
  label: string;
  collapsed: boolean;
  focused: boolean;
  onToggleCollapse: () => void;
  onCreate: (() => void) | null;
  onFocus: (focus: DeskGoalFocus | null) => void;
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={t(collapsed ? "board.ui.expandGroup" : "board.ui.collapseGroup", {
          group: label,
        })}
        onPress={onToggleCollapse}
        style={toggleStyle}
        testID={`board-group-toggle-${group.key}`}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={240} testID={`board-group-context-${group.key}`}>
        {onCreate ? (
          <ContextMenuItem leading={createLeading} onSelect={onCreate}>
            {t("board.newTask")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          leading={collapsed ? expandLeading : collapseLeading}
          onSelect={onToggleCollapse}
        >
          {t(collapsed ? "board.ui.expand" : "board.ui.collapse")}
        </ContextMenuItem>
        {goal && group.serverId ? (
          <>
            <ContextMenuSeparator />
            <GoalMenuItems
              serverId={group.serverId}
              goal={goal}
              focused={focused}
              onFocus={onFocus}
            />
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function toggleStyle({ hovered = false, pressed }: HoverState) {
  return [styles.toggle, (hovered || pressed) && styles.toggleHovered];
}

function GoalMenu({
  serverId,
  goal,
  label,
  focused,
  onFocus,
}: {
  serverId: string;
  goal: BoardGoal;
  label: string;
  focused: boolean;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        compact
        label={t("board.desk.group.menu", { group: label })}
        testID={`board-goal-menu-${goal.id}`}
      >
        <DensityIcon icon={MoreHorizontal} size="sm" color="foregroundMuted" />
      </ToolbarButton>
      <DropdownMenuContent align="end">
        <GoalMenuItems serverId={serverId} goal={goal} focused={focused} onFocus={onFocus} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Edit, focus and land a goal: the rows its menu button, its group and its pane row share. */
export function GoalMenuItems({
  serverId,
  goal,
  focused,
  onFocus,
}: {
  serverId: string;
  goal: BoardGoal;
  focused: boolean;
  onFocus: (focus: DeskGoalFocus | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [landing, setLanding] = useState(false);
  const edit = useCallback(
    () => openDeskGoalSheet({ mode: "edit", serverId, goal }),
    [goal, serverId],
  );
  const toggleFocus = useCallback(
    () => onFocus(focused ? null : { serverId, goalId: goal.id }),
    [focused, goal.id, onFocus, serverId],
  );
  const land = useCallback(async () => {
    setLanding(true);
    try {
      await updateBoardGoal(serverId, { goalId: goal.id, landed: true });
    } catch (error) {
      toast.error(t("board.desk.goal.landFailed", { message: toErrorMessage(error) }));
    } finally {
      setLanding(false);
    }
  }, [goal.id, serverId, t, toast]);

  return (
    <>
      <DropdownMenuItem leading={editLeading} onSelect={edit} testID={`board-goal-edit-${goal.id}`}>
        {t("board.desk.goal.edit")}
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={focusLeading}
        onSelect={toggleFocus}
        testID={`board-goal-focus-${goal.id}`}
      >
        {focused ? t("board.desk.goal.unfocus") : t("board.desk.goal.focus")}
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={landLeading}
        onSelect={land}
        status={landing ? "pending" : "idle"}
        pendingLabel={t("board.desk.goal.landing")}
        testID={`board-goal-land-${goal.id}`}
      >
        {t("board.desk.goal.land")}
      </DropdownMenuItem>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: 28,
    // The hover fill reaches past the chevron while the chevron keeps the zone's text rail.
    marginLeft: -theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  toggleHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  number: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  chevron: {
    flexShrink: 0,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  host: {
    flexShrink: 2,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  count: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[3],
    rowGap: theme.spacing[1],
  },
  fact: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  decideCount: {
    color: theme.colors.statusWarning,
  },
  autopilot: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
