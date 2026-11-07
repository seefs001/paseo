import { RotateCcw, SquareArrowOutUpRight } from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard } from "@/board/columns";
import type { BoardItem, BoardTaskItem } from "@/board/items";
import { updateBoardTask } from "@/board/tasks";
import { boardCardStyles } from "@/components/board/card-styles";
import { DESK_BREAK_WORDS } from "@/components/board/desk-clamp";
import { DeskItemContextMenu } from "@/components/board/desk-item-menu";
import { WorkspaceMetaRow } from "@/components/sidebar/workspace-meta-row";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { selectPrHintFromStatus } from "@/git/pr-hint";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { itemName, itemTask } from "./desk-brief-parts";

type HoverState = PressableStateCallbackType & { hovered?: boolean; open?: boolean };

interface DeskLandedRowProps {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
  showHost: boolean;
  onOpenDetail: (item: BoardItem) => void;
}

/** What finished: the outcome in a line or two, its change request, and when it landed. */
export const DeskLandedRow = memo(function DeskLandedRow({
  item,
  onEditTask,
  showHost,
  onOpenDetail,
}: DeskLandedRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  // Touch layouts always show the actions, so the row keeps room for them instead of hiding the time.
  const actionsAlwaysShown = isNative || isCompact;
  const showActions = isHovered || actionsAlwaysShown;
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const press = useCallback(() => onOpenDetail(item), [item, onOpenDetail]);
  const task = itemTask(item);
  const workspace = item.kind === "agent" ? item.workspace : item.card.workspace;
  const title = item.kind === "agent" ? itemName(item) : (task?.title ?? "");
  const landedAt = useMemo(() => new Date(item.sortTime), [item.sortTime]);
  const landedAgo = useCompactTimeAgo(landedAt);
  const prHint = useMemo(
    () => selectPrHintFromStatus(workspace?.githubRuntime?.pullRequest, workspace?.forge),
    [workspace?.forge, workspace?.githubRuntime?.pullRequest],
  );
  const summary = task?.summary ?? null;
  const rowStyle = useCallback(
    ({ hovered, pressed, open }: HoverState) => [
      boardCardStyles.card,
      styles.row,
      actionsAlwaysShown && styles.rowReserve,
      (hovered || open) && boardCardStyles.hovered,
      pressed && boardCardStyles.pressed,
    ],
    [actionsAlwaysShown],
  );
  const triggerProps = useMemo(
    () => ({
      accessibilityRole: "button" as const,
      accessibilityLabel: title,
      onPress: press,
      style: rowStyle,
      highlightStyle: boardCardStyles.pressed,
      testID: `desk-landed-${item.key}`,
    }),
    [item.key, press, rowStyle, title],
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
          {task ? <Text style={styles.number}>{`T-${task.number}`}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text
            style={styles.time}
            accessibilityLabel={t("board.brief.landed.at", { time: landedAgo })}
          >
            {landedAgo}
          </Text>
        </View>
        {summary ? (
          <Text style={styles.summary} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
        {prHint ? (
          <WorkspaceMetaRow
            currentBranch={null}
            projectName={null}
            hostBadge={null}
            prHint={prHint}
            serviceSummary={null}
          />
        ) : null}
        {showHost ? (
          <Text style={styles.meta} numberOfLines={1}>
            {item.serverName}
          </Text>
        ) : null}
      </DeskItemContextMenu>
      <View
        style={[styles.actionsSlot, !showActions && styles.hidden]}
        pointerEvents={showActions ? "box-none" : "none"}
      >
        <OpenButton item={item} />
        {item.kind === "task" ? <ReopenButton item={item} /> : null}
      </View>
    </View>
  );
});

/** Into the work itself: the agent's session, or the task's workspace while it still exists. */
function OpenButton({ item }: { item: BoardItem }): ReactElement | null {
  const { t } = useTranslation();
  const workspaceId = item.kind === "agent" ? item.workspace.id : item.card.workspace?.id;
  const open = useCallback(() => {
    if (item.kind === "agent") {
      navigateToAgent({ serverId: item.serverId, agentId: item.agent.id, workspaceId });
    } else if (workspaceId) {
      navigateToWorkspace({ serverId: item.serverId, workspaceId });
    }
  }, [item, workspaceId]);
  if (!workspaceId) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={SquareArrowOutUpRight}
      onPress={open}
      accessibilityLabel={t("board.agent.actions.open")}
      testID={`desk-landed-open-${item.key}`}
    />
  );
}

function ReopenButton({ item }: { item: BoardTaskItem }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, task, workspace } = item.card;
  const [reopening, setReopening] = useState(false);
  const reopen = useCallback(async () => {
    // An archived workspace cannot take the work back, so the task returns to Ahead.
    const unlink = task.workspaceId !== null && workspace === null;
    setReopening(true);
    try {
      await updateBoardTask(serverId, {
        taskId: task.id,
        completed: false,
        ...(unlink ? { workspaceId: null } : {}),
      });
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setReopening(false);
    }
  }, [serverId, task.id, task.workspaceId, toast, workspace]);
  const press = useCallback(() => {
    void reopen();
  }, [reopen]);
  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={RotateCcw}
      onPress={press}
      loading={reopening}
      disabled={reopening}
      accessibilityLabel={reopening ? t("board.actions.reopening") : t("board.actions.reopen")}
      testID={`desk-landed-reopen-${task.id}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  row: {
    gap: theme.spacing[1.5],
  },
  rowCompact: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  rowReserve: {
    paddingRight: theme.spacing[16],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  number: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    ...DESK_BREAK_WORDS,
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    ...DESK_BREAK_WORDS,
  },
  time: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsSlot: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    // Hover actions cover the time, on the hovered row's own fill.
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface1,
  },
  hidden: {
    opacity: 0,
  },
}));
