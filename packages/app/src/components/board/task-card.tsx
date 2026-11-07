import type { BoardGoal } from "@getpaseo/protocol/messages";
import { Circle, CircleDashed, MoreHorizontal, Paperclip, Play } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BacklogMove, BoardCard, BoardColumnId } from "@/board/columns";
import { toBoardTaskItem, type BoardItem } from "@/board/items";
import { boardCardStyles } from "@/components/board/card-styles";
import { GoalChip, useReadyBoardHost } from "@/components/board/desk-brief-parts";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { BoardReviewActions } from "@/components/board/review-actions";
import { BoardReleaseClaimButton, useClaimantName } from "@/components/board/review-claim";
import { BoardReviewCriteria } from "@/components/board/review-criteria";
import { DESK_BREAK_WORDS } from "@/components/board/desk-clamp";
import { DESK_MENU_ICON_SIZE, useTaskMenu } from "@/components/board/task-menu";
import { DiffStat } from "@/components/diff-stat";
import { WorkspaceMetaRow } from "@/components/sidebar/workspace-meta-row";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { selectPrHintFromStatus } from "@/git/pr-hint";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import { WorkspaceLabelChip } from "@/workspace-labels/chip";

const ThemedPaperclip = withUnistyles(Paperclip);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const SELECTED_STATE = { selected: true };

const MENU_WIDTH = 240;

type CardState = PressableStateCallbackType & { hovered?: boolean; open?: boolean };

interface BoardTaskCardProps {
  card: BoardCard;
  /** Fog and Ready cards only: the ranks that move the card one step within its list. */
  move?: BacklogMove;
  showHost: boolean;
  onEdit: (card: BoardCard) => void;
  selected?: boolean;
  /** Pressing the card selects it; without this it opens the workspace, or the task to edit. */
  onSelect?: (item: BoardItem) => void;
  /** Native reorder: a long press lifts the card in its Ahead list. */
  onDragStart?: () => void;
  /** False when the card sits under its own goal's header, which already names the goal. */
  showGoal: boolean;
}

/**
 * A planned task. Press opens its detail; a right click, or the menu button that shows on hover,
 * offers every action; Start shows on hover while the task can start.
 */
export const BoardTaskCard = memo(function BoardTaskCard({
  card,
  move,
  showHost,
  onEdit,
  selected,
  onSelect,
  onDragStart,
  showGoal,
}: BoardTaskCardProps): ReactElement {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const active = selected === true || menuOpen || contextOpen;
  const { showChrome, handlePointerEnter, handlePointerLeave } = useHoverChrome(active);
  const { task, workspace, serverId } = card;
  const isDone = task.completedAt !== null;
  const claimantName = useClaimantName(serverId, task.claimedBy);
  const menu = useTaskMenu(card, { onEdit, move });

  const openWorkspace = useCallback(() => {
    if (workspace) navigateToWorkspace({ serverId, workspaceId: workspace.id });
  }, [serverId, workspace]);
  const edit = useCallback(() => onEdit(card), [card, onEdit]);
  const select = useCallback(() => onSelect?.(toBoardTaskItem(card)), [card, onSelect]);
  const fallbackPress = workspace ? openWorkspace : edit;
  const press = onSelect ? select : fallbackPress;
  const quickStart = card.column === "ready" ? menu.start : null;

  const cardStyle = useCallback(
    ({ hovered, pressed, open }: CardState) => [
      boardCardStyles.card,
      styles.card,
      hovered && boardCardStyles.hovered,
      (selected || open) && boardCardStyles.selected,
      pressed && boardCardStyles.pressed,
    ],
    [selected],
  );
  return (
    <View
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <ContextMenu open={contextOpen} onOpenChange={setContextOpen}>
        {/* Long press belongs to reordering on phones, so the menu opens by right click only. */}
        <ContextMenuTrigger
          enabledOnMobile={false}
          accessibilityRole="button"
          accessibilityLabel={task.title}
          accessibilityState={selected ? SELECTED_STATE : undefined}
          onPress={press}
          onLongPress={onDragStart}
          style={cardStyle}
          highlightStyle={boardCardStyles.pressed}
          testID={`board-card-${task.id}`}
        >
          <View style={styles.topLine}>
            <CardStateIcon column={card.column} />
            <Text style={styles.number}>{`T-${task.number}`}</Text>
          </View>
          <Text style={isDone ? styles.titleDone : styles.title} numberOfLines={2}>
            {task.title}
          </Text>
          <BoardTaskCardDetails card={card} showHost={showHost} showGoal={showGoal} />
          <TaskAssigneeLine card={card} claimantName={claimantName} />
          <TaskStateActions card={card} />
        </ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={MENU_WIDTH}
          pages={menu.pages}
          testID={`board-card-context-${task.id}`}
        >
          {menu.items}
        </ContextMenuContent>
      </ContextMenu>
      <View
        style={[styles.chrome, !showChrome && styles.chromeHidden]}
        pointerEvents={showChrome ? "box-none" : "none"}
      >
        {quickStart ? (
          <ToolbarButton
            compact
            label={t("board.actions.start")}
            onPress={quickStart}
            testID={`board-card-start-${task.id}`}
          >
            <DensityIcon icon={Play} size="sm" color="foregroundMuted" />
          </ToolbarButton>
        ) : null}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <ToolbarButton
            kind="menu"
            compact
            label={t("board.actions.menu")}
            testID={`board-card-menu-${task.id}`}
          >
            <DensityIcon icon={MoreHorizontal} size="sm" color="foregroundMuted" />
          </ToolbarButton>
          <DropdownMenuContent align="end" width={MENU_WIDTH} pages={menu.pages}>
            {menu.items}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {menu.overlay}
    </View>
  );
});

/**
 * Card buttons show on hover, while the card is selected or its menu is open on web, and always on
 * touch and compact layouts.
 */
function useHoverChrome(active: boolean) {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const showChrome = isHovered || active || isNative || isCompact;
  return { showChrome, handlePointerEnter, handlePointerLeave };
}

/** Fog is a dashed circle, Ready a solid one; started work shows its state dot. */
function CardStateIcon({ column }: { column: BoardColumnId }): ReactElement | null {
  if (column === "fog")
    return <DensityIcon icon={CircleDashed} size="sm" color="foregroundMuted" />;
  if (column === "ready") return <DensityIcon icon={Circle} size="sm" color="foregroundMuted" />;
  return <ColumnDot column={column} />;
}

function BoardTaskCardDetails({
  card,
  showHost,
  showGoal,
}: {
  card: BoardCard;
  showHost: boolean;
  showGoal: boolean;
}): ReactElement {
  const { task, workspace, serverId } = card;
  const isDone = task.completedAt !== null;
  const hostGoal = useReadyBoardHost(serverId)?.goals.get(task.goalId ?? "") ?? null;
  const goal = showGoal ? hostGoal : null;
  const showNotes = card.column === "fog" && task.notes.length > 0;
  const showSummary = (card.column === "done" || card.column === "review") && Boolean(task.summary);

  return (
    <>
      {isDone ? null : <BlockedByLine card={card} />}
      {showNotes ? (
        <Text style={styles.notes} numberOfLines={2}>
          {task.notes}
        </Text>
      ) : null}
      {showSummary ? (
        <Text style={styles.notes} numberOfLines={2}>
          {task.summary}
        </Text>
      ) : null}
      {card.column === "review" ? (
        <BoardReviewCriteria taskId={task.id} criteria={task.acceptanceCriteria} />
      ) : null}
      <WorkspaceLabelChips serverId={serverId} workspace={workspace} />
      <TaskMetaRow card={card} showHost={showHost} goal={goal} showTimer />
      <TaskPullRequest workspace={workspace} />
    </>
  );
}

/**
 * One line of context: the goal, then project, workspace and host, then subtasks, attachments and
 * the diff, with when the task last changed at the end.
 */
function TaskMetaRow({
  card,
  showHost,
  goal,
  showTimer,
}: {
  card: BoardCard;
  showHost: boolean;
  goal: BoardGoal | null;
  showTimer: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const { task, workspace } = card;
  const meta = useMemo(() => formatCardMeta(card, showHost, t), [card, showHost, t]);
  const diffStat = workspace?.diffStat ?? null;
  const attachmentCount = task.attachments.length;
  const isEmpty = !goal && !meta && !diffStat && attachmentCount === 0 && card.children.total === 0;
  if (isEmpty && !showTimer) return null;
  return (
    <View style={styles.metaRow}>
      {goal ? <GoalChip goal={goal} /> : null}
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
      <SubtaskCount card={card} />
      {attachmentCount > 0 ? (
        <View
          style={styles.attachments}
          accessibilityLabel={t("board.ui.attachments", { count: attachmentCount })}
          testID={`board-card-attachments-${task.id}`}
        >
          <ThemedPaperclip size={DESK_MENU_ICON_SIZE} uniProps={mutedColorMapping} />
          <Text style={styles.attachmentCount}>{attachmentCount}</Text>
        </View>
      ) : null}
      {diffStat ? <DiffStat additions={diffStat.additions} deletions={diffStat.deletions} /> : null}
      {showTimer ? <CardUpdatedAgo updatedAt={task.updatedAt} /> : null}
    </View>
  );
}

/** "5m", kept current; the label says it is when the task last changed. */
function CardUpdatedAgo({ updatedAt }: { updatedAt: string }): ReactElement {
  const { t } = useTranslation();
  const date = useMemo(() => new Date(updatedAt), [updatedAt]);
  const time = useCompactTimeAgo(date);
  return (
    <Text
      style={styles.updated}
      numberOfLines={1}
      accessibilityLabel={t("board.agent.time.updated", { time })}
    >
      {time}
    </Text>
  );
}

/** The sidebar's change request and CI items, so a card reads like its workspace row. */
function TaskPullRequest({
  workspace,
}: {
  workspace: BoardCard["workspace"];
}): ReactElement | null {
  const prHint = useMemo(
    () => selectPrHintFromStatus(workspace?.githubRuntime?.pullRequest, workspace?.forge),
    [workspace?.forge, workspace?.githubRuntime?.pullRequest],
  );
  if (!prHint) return null;
  return (
    <WorkspaceMetaRow
      currentBranch={null}
      projectName={null}
      hostBadge={null}
      prHint={prHint}
      serviceSummary={null}
    />
  );
}

/** Answer or accept from the card while the task's workspace waits on the user. */
function TaskStateActions({ card }: { card: BoardCard }): ReactElement | null {
  const { workspace, serverId, column } = card;
  if (!workspace) return null;
  if (column === "needs_you") {
    return <BoardPermissionRequest serverId={serverId} workspaceId={workspace.id} />;
  }
  if (column === "review") return <BoardReviewActions card={card} workspace={workspace} />;
  return null;
}

function formatCardMeta(card: BoardCard, showHost: boolean, t: TFunction): string {
  const { task, workspace, project } = card;
  const isDone = task.completedAt !== null;
  const parts: string[] = [];
  if (project) parts.push(project.projectCustomName ?? project.projectDisplayName);
  if (workspace) parts.push(workspace.name);
  else if (task.workspaceId !== null && !isDone) parts.push(t("board.workspaceUnavailable"));
  if (showHost) parts.push(card.serverName);
  return parts.join(" · ");
}

function WorkspaceLabelChips({
  serverId,
  workspace,
}: {
  serverId: string;
  workspace: BoardCard["workspace"];
}): ReactElement | null {
  const definitions = useWorkspaceLabelDefinitions(serverId, workspace?.labels);
  if (definitions.length === 0) return null;
  return (
    <View style={styles.labels}>
      {definitions.map((label) => (
        <WorkspaceLabelChip key={label.name} label={label} />
      ))}
    </View>
  );
}

/** Who the task is with: the claiming agent, marked Working, or a person for human tasks. */
function TaskAssigneeLine({
  card,
  claimantName,
}: {
  card: BoardCard;
  claimantName: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const { task, serverId } = card;
  const isDone = task.completedAt !== null;
  let assignee: ReactElement | null = null;
  if (claimantName) {
    assignee = (
      <>
        <Text style={styles.assignee} numberOfLines={1}>
          {claimantName}
        </Text>
        <View style={styles.workingBadge}>
          <Text style={styles.workingBadgeText}>{t("board.agent.taskCard.working")}</Text>
        </View>
        <BoardReleaseClaimButton serverId={serverId} taskId={task.id} />
      </>
    );
  } else if (task.readyFor === "human" && !isDone) {
    assignee = (
      <Text style={styles.assignee} numberOfLines={1}>
        {t("board.review.forHuman")}
      </Text>
    );
  }
  if (!assignee) return null;
  return (
    <View style={styles.assigneeRow} testID={`board-card-assignee-${task.id}`}>
      {assignee}
    </View>
  );
}

function SubtaskCount({ card }: { card: BoardCard }): ReactElement | null {
  const { t } = useTranslation();
  const { done, total } = card.children;
  if (total === 0) return null;
  return (
    <Text style={styles.attachmentCount} testID={`board-card-subtasks-${card.task.id}`}>
      {t("board.review.subtasks", { done, total })}
    </Text>
  );
}

/** Names the first unfinished blocker; the rest are a count. */
function BlockedByLine({ card }: { card: BoardCard }): ReactElement | null {
  const { t } = useTranslation();
  const [first, ...rest] = card.openBlockers;
  if (!first) return null;
  return (
    <Text style={styles.notes} numberOfLines={1} testID={`board-card-blocked-${card.task.id}`}>
      {rest.length > 0
        ? t("board.review.blockedByMore", { title: first.title, count: rest.length })
        : t("board.review.blockedBy", { title: first.title })}
    </Text>
  );
}

function ColumnDot({ column }: { column: BoardColumnId }): ReactElement | null {
  switch (column) {
    case "running":
      return <View style={[styles.dot, styles.dotRunning]} />;
    case "needs_you":
      return <View style={[styles.dot, styles.dotNeedsYou]} />;
    case "review":
      return <View style={[styles.dot, styles.dotReview]} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  card: {
    gap: theme.spacing[1.5],
  },
  cardCompact: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    // Clears Start and the menu button pinned to the top-right corner.
    paddingRight: theme.spacing[12],
  },
  number: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  assigneeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  assignee: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  workingBadge: {
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  workingBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  updated: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    ...DESK_BREAK_WORDS,
  },
  titleDone: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textDecorationLine: "line-through",
    ...DESK_BREAK_WORDS,
  },
  notes: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    ...DESK_BREAK_WORDS,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[0.5],
  },
  meta: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  attachments: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  attachmentCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  dot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  dotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  dotNeedsYou: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotReview: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  chrome: {
    position: "absolute",
    top: theme.spacing[1],
    right: theme.spacing[1],
    flexDirection: "row",
    alignItems: "center",
  },
  chromeHidden: {
    opacity: 0,
  },
}));
