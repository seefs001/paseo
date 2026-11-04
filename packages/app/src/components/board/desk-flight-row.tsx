import type { WorkspaceStateBucket } from "@getpaseo/protocol/messages";
import { SquareArrowOutUpRight } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard, BoardColumnId } from "@/board/columns";
import { useDeskPrefs } from "@/board/desk-prefs";
import type { BoardAgentItem, BoardItem, BoardTaskItem } from "@/board/items";
import {
  BoardAgentQuickActions,
  useBoardAgentActions,
} from "@/components/board/agent-card-actions";
import {
  BoardAgentContextMeter,
  BoardModelPills,
  BoardSubagentPill,
} from "@/components/board/agent-pills";
import { BoardAgentStateIndicator } from "@/components/board/agent-state-indicator";
import { BoardAgentTimer, BoardLiveDuration } from "@/components/board/agent-time";
import { boardCardStyles } from "@/components/board/card-styles";
import { DeskItemContextMenu } from "@/components/board/desk-item-menu";
import { DESK_BREAK_WORDS } from "@/components/board/desk-clamp";
import { useClaimantName } from "@/components/board/review-claim";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { GoalChip, TaskChip, itemName, useItemGoal } from "./desk-brief-parts";

type HoverState = PressableStateCallbackType & { hovered?: boolean; open?: boolean };

const SELECTED_STATE = { selected: true };
const NOT_SELECTED_STATE = { selected: false };

interface DeskFlightRowProps {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
  showHost: boolean;
  /** False under the item's own goal header, which already names the goal. */
  showGoal: boolean;
  selected: boolean;
  onOpenDetail: (item: BoardItem) => void;
}

/**
 * Work moving now: state, title, goal and task, what it runs on,
 * how long, and how full its context is. Stop and Open show on hover, always on touch.
 */
export const DeskFlightRow = memo(function DeskFlightRow({
  item,
  onEditTask,
  showHost,
  showGoal,
  selected,
  onOpenDetail,
}: DeskFlightRowProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const showActions = isHovered || isNative || isCompact;
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const press = useCallback(() => onOpenDetail(item), [item, onOpenDetail]);
  const { prefs } = useDeskPrefs();
  const compact = prefs.density === "compact";
  const title = item.kind === "agent" ? itemName(item) : item.card.task.title;
  const rowStyle = useCallback(
    ({ hovered, pressed, open }: HoverState) => [
      boardCardStyles.card,
      styles.row,
      compact && styles.rowCompact,
      hovered && boardCardStyles.hovered,
      (selected || open) && boardCardStyles.selected,
      pressed && boardCardStyles.pressed,
    ],
    [compact, selected],
  );
  const triggerProps = useMemo(
    () => ({
      accessibilityRole: "button" as const,
      accessibilityLabel: title,
      accessibilityState: selected ? SELECTED_STATE : NOT_SELECTED_STATE,
      onPress: press,
      style: rowStyle,
      highlightStyle: boardCardStyles.pressed,
      testID: `desk-flight-${item.key}`,
    }),
    [item.key, press, rowStyle, selected, title],
  );
  return (
    <View
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <DeskItemContextMenu
        item={item}
        onEditTask={onEditTask}
        onOpenDetail={press}
        triggerProps={triggerProps}
      >
        <View style={styles.titleLine}>
          <BoardAgentStateIndicator bucket={rowBucket(item)} />
          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>
            {title}
          </Text>
        </View>
        <View style={styles.contextLine}>
          {item.kind === "agent" ? (
            <AgentContext item={item} showHost={showHost} showGoal={showGoal} />
          ) : (
            <TaskContext item={item} showHost={showHost} showGoal={showGoal} />
          )}
          {prefs.fields.timer ? <RowTimer item={item} /> : null}
        </View>
      </DeskItemContextMenu>
      <View style={styles.actionsSlot} pointerEvents="box-none">
        {item.kind === "agent" ? (
          <AgentRowActions item={item} visible={showActions} />
        ) : (
          <TaskRowActions item={item} visible={showActions} onOpenDetail={onOpenDetail} />
        )}
      </View>
    </View>
  );
});

const BUCKET_BY_COLUMN: Record<BoardColumnId, WorkspaceStateBucket> = {
  fog: "done",
  ready: "done",
  running: "running",
  needs_you: "needs_input",
  review: "attention",
  done: "done",
};

function rowBucket(item: BoardItem): WorkspaceStateBucket {
  return item.kind === "agent" ? item.bucket : BUCKET_BY_COLUMN[item.column];
}

function RowTimer({ item }: { item: BoardItem }): ReactElement {
  if (item.kind === "agent") return <BoardAgentTimer item={item} style={styles.timer} />;
  return <TaskTimer item={item} />;
}

function TaskTimer({ item }: { item: BoardTaskItem }): ReactElement {
  const { task, workspace } = item.card;
  const since = useMemo(
    () => workspace?.statusEnteredAt ?? new Date(task.updatedAt),
    [task.updatedAt, workspace?.statusEnteredAt],
  );
  return <BoardLiveDuration since={since} kind="running" style={styles.timer} />;
}

function AgentContext({
  item,
  showHost,
  showGoal,
}: {
  item: BoardAgentItem;
  showHost: boolean;
  showGoal: boolean;
}): ReactElement {
  const { serverId, agent, task, children } = item;
  const { fields } = useDeskPrefs().prefs;
  const goal = useItemGoal(item);
  return (
    <>
      {goal && showGoal ? <GoalChip goal={goal} /> : null}
      {task ? <TaskChip task={task.task} /> : null}
      {fields.model ? <BoardModelPills serverId={serverId} agent={agent} /> : null}
      <BoardSubagentPill agentId={agent.id} childAgents={children} />
      {fields.context ? <BoardAgentContextMeter serverId={serverId} agent={agent} /> : null}
      {showHost ? <Text style={styles.meta}>{item.serverName}</Text> : null}
    </>
  );
}

function TaskContext({
  item,
  showHost,
  showGoal,
}: {
  item: BoardTaskItem;
  showHost: boolean;
  showGoal: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { task, serverId } = item.card;
  const goal = useItemGoal(item);
  const claimant = useClaimantName(serverId, task.claimedBy);
  return (
    <>
      {goal && showGoal ? <GoalChip goal={goal} /> : null}
      <Text style={styles.number}>{`T-${task.number}`}</Text>
      {claimant ? (
        <Text style={styles.meta} numberOfLines={1}>
          {t("board.review.claim.claimedBy", { name: claimant })}
        </Text>
      ) : null}
      {showHost ? <Text style={styles.meta}>{item.serverName}</Text> : null}
    </>
  );
}

function AgentRowActions({
  item,
  visible,
}: {
  item: BoardAgentItem;
  visible: boolean;
}): ReactElement {
  const actions = useBoardAgentActions(item, itemName(item));
  return <BoardAgentQuickActions actions={actions} visible={visible} agentId={item.agent.id} />;
}

function TaskRowActions({
  item,
  visible,
  onOpenDetail,
}: {
  item: BoardTaskItem;
  visible: boolean;
  onOpenDetail: (item: BoardItem) => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => onOpenDetail(item), [item, onOpenDetail]);
  return (
    <View
      style={visible ? styles.quickActions : styles.quickActionsHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Button
        size="sm"
        variant="ghost"
        leftIcon={SquareArrowOutUpRight}
        onPress={open}
        accessibilityLabel={t("board.agent.actions.open")}
        testID={`desk-flight-open-${item.card.task.id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  row: {
    gap: theme.spacing[2],
  },
  rowCompact: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    ...DESK_BREAK_WORDS,
  },
  timer: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  contextLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingRight: theme.spacing[16],
  },
  number: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  meta: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsSlot: {
    position: "absolute",
    right: theme.spacing[1],
    bottom: theme.spacing[1],
  },
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  quickActionsHidden: {
    flexDirection: "row",
    alignItems: "center",
    opacity: 0,
  },
}));
