import { MoreHorizontal } from "lucide-react-native";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard, BoardColumnId } from "@/board/columns";
import type { BoardAgentItem, BoardItem, BoardTaskItem } from "@/board/items";
import {
  BoardAgentMenuItems,
  useBoardAgentActions,
  useBoardAgentMenuPages,
} from "@/components/board/agent-card-actions";
import { itemName } from "@/components/board/desk-brief-parts";
import { useTaskMenu } from "@/components/board/task-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { AgentStatusDot } from "@/components/agent-status-dot";
import {
  BoardAgentActions,
  BoardAgentChips,
  BoardAgentDetailBody,
  BoardAgentProperties,
} from "@/components/board/detail-agent";
import { BoardTaskActions, BoardTaskDetailBody } from "@/components/board/detail-task";
import { getStatusBucketLabel } from "@/hooks/sidebar-status-view-model";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

export const COLUMN_LABEL_KEYS: Record<BoardColumnId, string> = {
  fog: "board.desk.stages.fog",
  ready: "board.desk.stages.ready",
  running: "board.columns.running",
  needs_you: "board.columns.needsYou",
  review: "board.columns.review",
  done: "board.columns.done",
};

export function boardItemTitle(item: BoardItem): string {
  if (item.kind === "task") return item.card.task.title;
  return item.agent.title ?? item.workspace.title ?? item.workspace.name;
}

function boardItemStateLabel(item: BoardItem, t: TFunction): string {
  if (item.kind === "agent") return getStatusBucketLabel(item.bucket, t);
  return t(COLUMN_LABEL_KEYS[item.column]);
}

/** Grey rests, green goes, blue moves, amber needs you. */
function taskDotStyle(column: BoardColumnId) {
  switch (column) {
    case "ready":
      return styles.dotReady;
    case "running":
      return styles.dotRunning;
    case "needs_you":
    case "review":
      return styles.dotAttention;
    default:
      return styles.dotMuted;
  }
}

function TaskStateDot({ column }: { column: BoardColumnId }): ReactElement {
  return <View style={[styles.dot, taskDotStyle(column)]} />;
}

/** The state dot and label; a task item shows its `T-<number>` and column. */
export function BoardDetailState({ item }: { item: BoardItem }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.state}>
      {item.kind === "agent" ? (
        <AgentStatusDot
          status={item.agent.status}
          requiresAttention={item.agent.requiresAttention}
          attentionReason={item.agent.attentionReason}
          pendingPermissionCount={item.agent.pendingPermissions.length}
          showInactive
        />
      ) : (
        <>
          <TaskStateDot column={item.column} />
          <Text style={styles.taskNumber}>{`T-${item.card.task.number}`}</Text>
        </>
      )}
      <Text style={styles.stateLabel} numberOfLines={1}>
        {boardItemStateLabel(item, t)}
      </Text>
    </View>
  );
}

/** Chips and actions under the detail's title. */
export function BoardDetailSummary({
  item,
  onEditTask,
}: {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  if (item.kind === "task") return <BoardTaskActions item={item} onEditTask={onEditTask} />;
  return (
    <View style={styles.summary}>
      <BoardAgentChips
        serverId={item.serverId}
        agent={item.agent}
        taskNumber={item.task?.task.number ?? null}
      />
      <BoardAgentActions item={item} />
    </View>
  );
}

export function BoardDetailBody({
  item,
  onEditTask,
  showProperties = true,
}: {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
  /** False when `BoardDetailProperties` renders in its own column. */
  showProperties?: boolean;
}): ReactElement {
  return (
    <View style={styles.sections}>
      {item.kind === "agent" ? (
        <BoardAgentDetailBody item={item} onEditTask={onEditTask} showProperties={showProperties} />
      ) : (
        <BoardTaskDetailBody item={item} onEditTask={onEditTask} />
      )}
    </View>
  );
}

/** Every action on the item, in the detail's header: the same rows as its card's menu. */
export function BoardDetailMenu({
  item,
  onEditTask,
}: {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  if (item.kind === "agent") return <AgentDetailMenu item={item} onEditTask={onEditTask} />;
  return <TaskDetailMenu item={item} onEditTask={onEditTask} />;
}

function TaskDetailMenu({
  item,
  onEditTask,
}: {
  item: BoardTaskItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const menu = useTaskMenu(item.card, { onEdit: onEditTask });
  return (
    <>
      <DetailMenuButton pages={menu.pages} testID={`board-detail-menu-${item.card.task.id}`}>
        {menu.items}
      </DetailMenuButton>
      {menu.overlay}
    </>
  );
}

function AgentDetailMenu({
  item,
  onEditTask,
}: {
  item: BoardAgentItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const actions = useBoardAgentActions(item, itemName(item));
  const pages = useBoardAgentMenuPages(item.serverId, item.task);
  return (
    <DetailMenuButton pages={pages} testID={`board-detail-menu-${item.agent.id}`}>
      <BoardAgentMenuItems
        actions={actions}
        agentId={item.agent.id}
        task={item.task}
        onEditTask={onEditTask}
      />
    </DetailMenuButton>
  );
}

function DetailMenuButton({
  pages,
  testID,
  children,
}: {
  pages: Parameters<typeof DropdownMenuContent>[0]["pages"];
  testID: string;
  children: ReactElement;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <ToolbarButton kind="menu" compact label={t("board.actions.menu")} testID={testID}>
        <DensityIcon icon={MoreHorizontal} size="sm" color="foregroundMuted" />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={240} pages={pages}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The agent's properties rail. A task carries its context in the meta line instead. */
export function BoardDetailProperties({
  item,
  onEditTask,
}: {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement | null {
  if (item.kind !== "agent") return null;
  return <BoardAgentProperties item={item} onEditTask={onEditTask} />;
}

const styles = StyleSheet.create((theme) => ({
  state: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  taskNumber: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  stateLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  summary: {
    gap: theme.spacing[3],
  },
  sections: {
    gap: theme.spacing[4],
  },
  dot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  dotReady: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  dotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  dotAttention: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
