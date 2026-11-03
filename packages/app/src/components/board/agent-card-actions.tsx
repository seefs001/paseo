import * as Clipboard from "expo-clipboard";
import {
  Archive,
  CheckCheck,
  Copy,
  Flag,
  ListPlus,
  MoreVertical,
  Pencil,
  Square,
  SquareArrowOutUpRight,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  archiveBoardAgent,
  markBoardAgentRead,
  stopBoardAgent,
  trackAgentAsTask,
} from "@/board/agent-actions";
import type { BoardCard } from "@/board/columns";
import type { BoardAgentItem } from "@/board/items";
import {
  DESK_ASSIGN_GOAL_PAGE_ID,
  useAssignGoalPage,
} from "@/components/board/desk-brief-task-menu";
import { deskMenuIcons } from "@/components/board/task-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { Agent } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedKebab = withUnistyles(MoreVertical);
const ThemedOpen = withUnistyles(SquareArrowOutUpRight);
const ThemedStop = withUnistyles(Square);
const ThemedRead = withUnistyles(CheckCheck);
const ThemedArchive = withUnistyles(Archive);
const ThemedTrack = withUnistyles(ListPlus);
const ThemedCopy = withUnistyles(Copy);
const ThemedPencil = withUnistyles(Pencil);
const ThemedGoal = withUnistyles(Flag);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const MENU_ICON_SIZE = 14;

const openLeading = <ThemedOpen size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const stopLeading = <ThemedStop size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const readLeading = <ThemedRead size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const archiveLeading = <ThemedArchive size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const trackLeading = <ThemedTrack size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const copyLeading = <ThemedCopy size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const goalLeading = <ThemedGoal size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;

const NO_PAGES: readonly MenuPageDefinition[] = [];

type PendingAgentAction = "markRead" | "archive" | "track";
type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** What the card offers for its agent right now; a null action is not offered in this state. */
export interface BoardAgentActions {
  open: () => void;
  stop: (() => void) | null;
  stopping: boolean;
  markRead: (() => void) | null;
  archive: (() => void) | null;
  track: (() => void) | null;
  pending: PendingAgentAction | null;
  copyId: () => void;
  copyTitle: () => void;
}

/** Identifies the agent's current turn, so a stop request only stays pending for that turn. */
function turnKey(agent: Agent): string {
  const { turn } = agent;
  if (turn.phase !== "open") return "idle";
  return `${turn.turnId ?? ""}:${turn.startedAt?.getTime() ?? ""}`;
}

export function useBoardAgentActions(item: BoardAgentItem, title: string): BoardAgentActions {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, agent, workspace, bucket, column, task, parent } = item;
  const [pending, setPending] = useState<PendingAgentAction | null>(null);
  // Stop stays pending until the agent leaves the turn it was asked to stop.
  const [stoppedTurn, setStoppedTurn] = useState<string | null>(null);
  const currentTurn = turnKey(agent);
  const isActive = bucket === "running" || bucket === "needs_input";
  const stopping = isActive && stoppedTurn === currentTurn;

  const run = useCallback(
    async (action: PendingAgentAction, operation: () => Promise<unknown>, failKey: string) => {
      setPending(action);
      try {
        await operation();
      } catch (error) {
        toast.error(t(failKey, { message: toErrorMessage(error) }));
      } finally {
        setPending(null);
      }
    },
    [t, toast],
  );

  const open = useCallback(() => {
    navigateToAgent({ serverId, agentId: agent.id, workspaceId: workspace.id });
  }, [agent.id, serverId, workspace.id]);

  const stop = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("board.agent.actions.stopConfirmTitle"),
      message: t("board.agent.actions.stopConfirmMessage", { title }),
      confirmLabel: t("board.agent.actions.stop"),
      destructive: true,
    });
    if (!confirmed) return;
    setStoppedTurn(currentTurn);
    try {
      await stopBoardAgent(serverId, agent.id);
    } catch (error) {
      setStoppedTurn(null);
      toast.error(t("board.agent.actions.stopFailed", { message: toErrorMessage(error) }));
    }
  }, [agent.id, currentTurn, serverId, t, title, toast]);
  const stopPress = useCallback(() => {
    void stop();
  }, [stop]);

  const markRead = useCallback(() => {
    void run(
      "markRead",
      () => markBoardAgentRead(serverId, agent.id),
      "board.agent.actions.markReadFailed",
    );
  }, [agent.id, run, serverId]);
  const archive = useCallback(() => {
    void run(
      "archive",
      () => archiveBoardAgent(serverId, agent.id),
      "board.agent.actions.archiveFailed",
    );
  }, [agent.id, run, serverId]);
  const track = useCallback(() => {
    void run(
      "track",
      () => trackAgentAsTask({ serverId, agent, workspace }),
      "board.agent.actions.trackFailed",
    );
  }, [agent, run, serverId, workspace]);

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await Clipboard.setStringAsync(text);
        toast.copied(label);
      } catch {
        toast.error(t("board.agent.actions.copyFailed"));
      }
    },
    [t, toast],
  );
  const copyId = useCallback(() => {
    void copy(agent.id, t("board.agent.actions.copiedId"));
  }, [agent.id, copy, t]);
  const copyTitle = useCallback(() => {
    void copy(title, t("board.agent.actions.copiedTitle"));
  }, [copy, t, title]);

  return {
    open,
    stop: isActive ? stopPress : null,
    stopping,
    markRead: column === "review" && agent.requiresAttention ? markRead : null,
    archive: column === "done" ? archive : null,
    // A subagent's workspace belongs to its root agent, which is where a task would ride.
    track: task === null && parent === null ? track : null,
    pending,
    copyId,
    copyTitle,
  };
}

/** The state's main actions as icon buttons; the caller decides when they show. */
export function BoardAgentQuickActions({
  actions,
  visible,
  agentId,
}: {
  actions: BoardAgentActions;
  visible: boolean;
  agentId: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View
      style={visible ? styles.quickActions : styles.quickActionsHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Button
        size="sm"
        variant="ghost"
        leftIcon={SquareArrowOutUpRight}
        onPress={actions.open}
        accessibilityLabel={t("board.agent.actions.open")}
        testID={`board-agent-open-${agentId}`}
      />
      {actions.stop ? (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={Square}
          onPress={actions.stop}
          loading={actions.stopping}
          disabled={actions.stopping}
          accessibilityLabel={
            actions.stopping ? t("board.agent.actions.stopping") : t("board.agent.actions.stop")
          }
          testID={`board-agent-stop-${agentId}`}
        />
      ) : null}
      {actions.markRead ? (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={CheckCheck}
          onPress={actions.markRead}
          loading={actions.pending === "markRead"}
          disabled={actions.pending !== null}
          accessibilityLabel={t("board.agent.actions.markRead")}
          testID={`board-agent-mark-read-${agentId}`}
        />
      ) : null}
      {actions.archive ? (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={Archive}
          onPress={actions.archive}
          loading={actions.pending === "archive"}
          disabled={actions.pending !== null}
          accessibilityLabel={t("board.agent.actions.archive")}
          testID={`board-agent-archive-${agentId}`}
        />
      ) : null}
    </View>
  );
}

export function BoardAgentMenu({
  actions,
  serverId,
  agentId,
  task,
  open,
  onOpenChange,
  onEditTask,
}: {
  actions: BoardAgentActions;
  serverId: string;
  agentId: string;
  task: BoardCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const { t } = useTranslation();
  const pages = useBoardAgentMenuPages(serverId, task);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("board.agent.actions.menu")}
        testID={`board-agent-menu-${agentId}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220} pages={pages}>
        <BoardAgentMenuItems
          actions={actions}
          agentId={agentId}
          task={task}
          onEditTask={onEditTask}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The agent menu's pages: assigning its task to a goal, when it carries one. */
export function useBoardAgentMenuPages(
  serverId: string,
  task: BoardCard | null,
): readonly MenuPageDefinition[] {
  const assignGoalPage = useAssignGoalPage(serverId, task?.task ?? null);
  return useMemo(() => (assignGoalPage ? [assignGoalPage] : NO_PAGES), [assignGoalPage]);
}

/**
 * The agent's actions as menu rows, for its menu button and a right click alike. Pass the pages
 * from `useBoardAgentMenuPages` to the surface.
 */
export function BoardAgentMenuItems({
  actions,
  agentId,
  task,
  onEditTask,
  onOpenDetail,
}: {
  actions: BoardAgentActions;
  agentId: string;
  task: BoardCard | null;
  onEditTask: (card: BoardCard) => void;
  /** Shown first when the surface does not already open the detail on press. */
  onOpenDetail?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const editTask = useMemo(() => (task ? () => onEditTask(task) : null), [onEditTask, task]);
  return (
    <>
      {onOpenDetail ? (
        <DropdownMenuItem leading={deskMenuIcons.detail} onSelect={onOpenDetail}>
          {t("board.ui.openDetail")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem leading={openLeading} onSelect={actions.open}>
        {t("board.agent.actions.open")}
      </DropdownMenuItem>
      {actions.stop ? (
        <DropdownMenuItem
          leading={stopLeading}
          status={actions.stopping ? "pending" : "idle"}
          pendingLabel={t("board.agent.actions.stopping")}
          onSelect={actions.stop}
        >
          {t("board.agent.actions.stop")}
        </DropdownMenuItem>
      ) : null}
      {actions.markRead ? (
        <DropdownMenuItem
          leading={readLeading}
          status={actions.pending === "markRead" ? "pending" : "idle"}
          pendingLabel={t("board.agent.actions.markingRead")}
          onSelect={actions.markRead}
        >
          {t("board.agent.actions.markRead")}
        </DropdownMenuItem>
      ) : null}
      {editTask ? (
        <DropdownMenuItem leading={editLeading} onSelect={editTask}>
          {t("board.actions.edit")}
        </DropdownMenuItem>
      ) : null}
      {task ? (
        <DropdownMenuSubTrigger
          id={DESK_ASSIGN_GOAL_PAGE_ID}
          leading={goalLeading}
          testID={`board-agent-assign-goal-${agentId}`}
        >
          {t("board.brief.card.assignGoal")}
        </DropdownMenuSubTrigger>
      ) : null}
      {actions.track ? (
        <DropdownMenuItem
          leading={trackLeading}
          status={actions.pending === "track" ? "pending" : "idle"}
          pendingLabel={t("board.agent.actions.tracking")}
          onSelect={actions.track}
          testID={`board-agent-track-${agentId}`}
        >
          {t("board.agent.actions.track")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem leading={copyLeading} onSelect={actions.copyId}>
        {t("board.agent.actions.copyId")}
      </DropdownMenuItem>
      <DropdownMenuItem leading={copyLeading} onSelect={actions.copyTitle}>
        {t("board.agent.actions.copyTitle")}
      </DropdownMenuItem>
      {actions.archive ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            leading={archiveLeading}
            status={actions.pending === "archive" ? "pending" : "idle"}
            pendingLabel={t("board.agent.actions.archiving")}
            onSelect={actions.archive}
          >
            {t("board.agent.actions.archive")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={MENU_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

function kebabTriggerStyle({ hovered = false }: HoverState) {
  return [styles.kebabTrigger, hovered && styles.kebabTriggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  quickActionsHidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 0,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface3,
  },
}));
