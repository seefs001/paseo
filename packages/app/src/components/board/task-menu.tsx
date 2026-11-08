import type { BoardTask } from "@getpaseo/protocol/messages";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCheck,
  Copy,
  Flag,
  Hash,
  Hourglass,
  ListPlus,
  PanelRight,
  Pencil,
  Play,
  RotateCcw,
  SquareArrowOutUpRight,
  Trash2,
  Zap,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { withUnistyles } from "react-native-unistyles";
import type { BacklogMove, BoardCard, BoardColumnId } from "@/board/columns";
import { setTaskStage } from "@/board/desk-actions";
import { openBoardTaskSheet } from "@/board/sheet";
import { startBoardTask } from "@/board/start";
import { deleteBoardTask, updateBoardTask } from "@/board/tasks";
import {
  DESK_ASSIGN_GOAL_PAGE_ID,
  useAssignGoalPage,
} from "@/components/board/desk-brief-task-menu";
import { DeskWaitsForSheet } from "@/components/board/desk-brief-waits-for";
import { useClaimantName } from "@/components/board/review-claim";
import { BOARD_START_WITH_PAGE_ID, BoardStartWithPage } from "@/components/board/start-with-page";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type ActionStatus,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { toErrorMessage } from "@/utils/error-messages";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

export const DESK_MENU_ICON_SIZE = 14;

function mutedIcon(icon: typeof Play): ReactElement {
  const Themed = withUnistyles(icon);
  return <Themed size={DESK_MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
}

const ThemedTrash = withUnistyles(Trash2);

export const deskMenuIcons = {
  detail: mutedIcon(PanelRight),
  start: mutedIcon(Play),
  startWith: mutedIcon(Zap),
  open: mutedIcon(SquareArrowOutUpRight),
  edit: mutedIcon(Pencil),
  addSubtask: mutedIcon(ListPlus),
  moveUp: mutedIcon(ArrowUp),
  moveDown: mutedIcon(ArrowDown),
  toReady: mutedIcon(ArrowRight),
  toFog: mutedIcon(ArrowLeft),
  goal: mutedIcon(Flag),
  waitsFor: mutedIcon(Hourglass),
  done: mutedIcon(CheckCheck),
  reopen: mutedIcon(RotateCcw),
  copyRef: mutedIcon(Hash),
  copy: mutedIcon(Copy),
  delete: <ThemedTrash size={DESK_MENU_ICON_SIZE} uniProps={destructiveColorMapping} />,
};

type PendingAction = "complete" | "reopen" | "delete" | "move" | "stage";
type SheetState = "closed" | "open" | "closing";

export interface TaskMenu {
  /** The menu's rows; render them in a dropdown or a context menu surface. */
  items: ReactElement;
  pages: readonly MenuPageDefinition[];
  /** Sheets the menu opens; render them next to the menu's trigger. */
  overlay: ReactElement | null;
  /** Starts the task in a new workspace, or null when it cannot start right now. */
  start: (() => void) | null;
}

/** Why Start is unavailable: an unfinished blocker, or an agent's claim. */
export function resolveStartBlockedReason(
  card: BoardCard,
  claimantName: string | null,
  t: TFunction,
): string | undefined {
  const firstBlocker = card.openBlockers[0];
  if (firstBlocker) return t("board.review.blockedBy", { title: firstBlocker.title });
  if (claimantName) return t("board.review.claim.claimedBy", { name: claimantName });
  return undefined;
}

/**
 * Everything a task offers, in one order, for every surface that shows it: the card's menu button,
 * a right click on its card or row, and the detail's header.
 */
export function useTaskMenu(
  card: BoardCard,
  options: {
    onEdit: (card: BoardCard) => void;
    /** Shown first when the surface does not already open the detail on press. */
    onOpenDetail?: () => void;
    /** Fog and Ready cards only: the ranks that move the card one step within its list. */
    move?: BacklogMove;
    /** True inside the task's own workspace, where Open workspace has nowhere to go. */
    inWorkspace?: boolean;
  },
): TaskMenu {
  const { onEdit, onOpenDetail, move, inWorkspace = false } = options;
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [waitsFor, setWaitsFor] = useState<SheetState>("closed");
  const { task, workspace, project, serverId } = card;
  const isDone = task.completedAt !== null;
  const canStart = !isDone && workspace === null;
  const showOpenWorkspace = workspace !== null && !inWorkspace;
  const claimantName = useClaimantName(serverId, task.claimedBy);
  const startBlockedReason = resolveStartBlockedReason(card, claimantName, t);
  const startDisabled = startBlockedReason !== undefined;

  const run = useCallback(
    async (action: PendingAction, operation: () => Promise<unknown>) => {
      setPending(action);
      try {
        await operation();
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setPending(null);
      }
    },
    [toast],
  );
  const start = useCallback(
    () => startBoardTask({ serverId, task, project }),
    [project, serverId, task],
  );
  const openWorkspace = useCallback(() => {
    if (workspace) navigateToWorkspace({ serverId, workspaceId: workspace.id });
  }, [serverId, workspace]);
  const edit = useCallback(() => onEdit(card), [card, onEdit]);
  const addSubtask = useCallback(
    () =>
      openBoardTaskSheet({
        mode: "create",
        serverId,
        projectId: task.projectId,
        parentId: task.id,
      }),
    [serverId, task.id, task.projectId],
  );
  const complete = useCallback(() => {
    void run("complete", () => updateBoardTask(serverId, { taskId: task.id, completed: true }));
  }, [run, serverId, task.id]);
  const reopen = useCallback(() => {
    // An archived workspace cannot take the work back, so the task returns to Ahead.
    const unlink = task.workspaceId !== null && workspace === null;
    void run("reopen", () =>
      updateBoardTask(serverId, {
        taskId: task.id,
        completed: false,
        ...(unlink ? { workspaceId: null } : {}),
      }),
    );
  }, [run, serverId, task.id, task.workspaceId, workspace]);
  const remove = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("board.confirmDelete.title"),
      message: t("board.confirmDelete.message", { title: task.title }),
      confirmLabel: t("board.confirmDelete.confirm"),
      destructive: true,
    });
    if (confirmed) await run("delete", () => deleteBoardTask(serverId, task.id));
  }, [run, serverId, t, task.id, task.title]);
  const removePress = useCallback(() => {
    void remove();
  }, [remove]);
  const moveTo = useCallback(
    (rank: number) => {
      void run("move", () => updateBoardTask(serverId, { taskId: task.id, rank }));
    },
    [run, serverId, task.id],
  );
  const moveToStage = useCallback(
    (stage: BoardTask["stage"]) => {
      void run("stage", () => setTaskStage(serverId, task, stage));
    },
    [run, serverId, task],
  );
  const copy = useCallback(
    (text: string, label: string) => {
      copyToClipboard(text).then(
        () => toast.copied(label),
        (error: unknown) =>
          toast.error(`${t("common.errors.unableToCopy")}: ${toErrorMessage(error)}`),
      );
    },
    [t, toast],
  );
  // Agents and the CLI accept `T-<number>`, so the reference pastes straight into a prompt.
  const copyRef = useCallback(
    () => copy(`T-${task.number} ${task.title}`, t("board.ui.copiedRef")),
    [copy, t, task.number, task.title],
  );
  const copyTitle = useCallback(
    () => copy(task.title, t("board.ui.copiedTitle")),
    [copy, t, task.title],
  );
  const openWaitsFor = useCallback(() => setWaitsFor("open"), []);
  const closeWaitsFor = useCallback(() => setWaitsFor("closing"), []);
  const dismissWaitsFor = useCallback(() => setWaitsFor("closed"), []);

  const assignGoalPage = useAssignGoalPage(serverId, isDone ? null : task);
  const canStartWith = useCanStartWith(serverId, canStart, project !== null);
  const pages = useMemo<readonly MenuPageDefinition[]>(() => {
    const list: MenuPageDefinition[] = assignGoalPage ? [assignGoalPage] : [];
    if (canStartWith) {
      list.push({
        id: BOARD_START_WITH_PAGE_ID,
        title: t("board.ui.startWith.title"),
        content: <BoardStartWithPage serverId={serverId} taskId={task.id} project={project} />,
      });
    }
    return list;
  }, [assignGoalPage, canStartWith, project, serverId, t, task.id]);

  const items = (
    <>
      {onOpenDetail ? (
        <DropdownMenuItem leading={deskMenuIcons.detail} onSelect={onOpenDetail}>
          {t("board.ui.openDetail")}
        </DropdownMenuItem>
      ) : null}
      {canStart ? (
        <DropdownMenuItem
          leading={deskMenuIcons.start}
          onSelect={start}
          disabled={startDisabled}
          description={startBlockedReason}
          testID={`board-task-menu-start-${task.id}`}
        >
          {t("board.actions.start")}
        </DropdownMenuItem>
      ) : null}
      {canStartWith ? (
        <DropdownMenuSubTrigger
          id={BOARD_START_WITH_PAGE_ID}
          leading={deskMenuIcons.startWith}
          disabled={startDisabled}
          testID={`board-card-start-with-${task.id}`}
        >
          {t("board.ui.startWith.title")}
        </DropdownMenuSubTrigger>
      ) : null}
      {showOpenWorkspace ? (
        <DropdownMenuItem leading={deskMenuIcons.open} onSelect={openWorkspace}>
          {t("board.actions.open")}
        </DropdownMenuItem>
      ) : null}
      {onOpenDetail || canStart || showOpenWorkspace ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem leading={deskMenuIcons.edit} onSelect={edit}>
        {t("board.actions.edit")}
      </DropdownMenuItem>
      {isDone ? null : (
        <DropdownMenuItem
          leading={deskMenuIcons.addSubtask}
          onSelect={addSubtask}
          testID={`board-card-add-subtask-${task.id}`}
        >
          {t("board.review.addSubtask")}
        </DropdownMenuItem>
      )}
      {move ? <BacklogMoveItems move={move} onMove={moveTo} /> : null}
      <StageMoveItem
        taskId={task.id}
        column={card.column}
        pending={pending === "stage"}
        onMove={moveToStage}
      />
      {isDone ? null : (
        <>
          <DropdownMenuSubTrigger
            id={DESK_ASSIGN_GOAL_PAGE_ID}
            leading={deskMenuIcons.goal}
            testID={`board-card-assign-goal-${task.id}`}
          >
            {t("board.brief.card.assignGoal")}
          </DropdownMenuSubTrigger>
          <DropdownMenuItem
            leading={deskMenuIcons.waitsFor}
            onSelect={openWaitsFor}
            testID={`board-card-waits-for-${task.id}`}
          >
            {t("board.brief.card.waitsFor")}
          </DropdownMenuItem>
        </>
      )}
      {isDone ? (
        <DropdownMenuItem
          leading={deskMenuIcons.reopen}
          status={statusOf(pending, "reopen")}
          pendingLabel={t("board.actions.reopening")}
          onSelect={reopen}
        >
          {t("board.actions.reopen")}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          leading={deskMenuIcons.done}
          status={statusOf(pending, "complete")}
          pendingLabel={t("board.actions.completing")}
          onSelect={complete}
        >
          {t("board.actions.complete")}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        leading={deskMenuIcons.copyRef}
        onSelect={copyRef}
        testID={`board-task-menu-copy-ref-${task.id}`}
      >
        {t("board.ui.copyRef", { number: task.number })}
      </DropdownMenuItem>
      <DropdownMenuItem leading={deskMenuIcons.copy} onSelect={copyTitle}>
        {t("board.ui.copyTitle")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        leading={deskMenuIcons.delete}
        destructive
        status={statusOf(pending, "delete")}
        pendingLabel={t("board.actions.deleting")}
        onSelect={removePress}
      >
        {t("board.actions.delete")}
      </DropdownMenuItem>
    </>
  );

  const overlay =
    waitsFor === "closed" ? null : (
      <DeskWaitsForSheet
        serverId={serverId}
        task={task}
        visible={waitsFor === "open"}
        onClose={closeWaitsFor}
        onDismiss={dismissWaitsFor}
      />
    );

  return { items, pages, overlay, start: canStart && !startDisabled ? start : null };
}

/** Start with needs a project unless the host creates workspaces without one. */
function useCanStartWith(serverId: string, canStart: boolean, hasProject: boolean): boolean {
  const supportsProjectlessCreate = useHostFeature(serverId, "workspaceProjectlessCreate");
  return canStart && (hasProject || supportsProjectlessCreate);
}

function statusOf(pending: PendingAction | null, action: PendingAction): ActionStatus {
  return pending === action ? "pending" : "idle";
}

/** Fog cards are specified into Ready; Ready cards go back to Fog. */
function StageMoveItem({
  taskId,
  column,
  pending,
  onMove,
}: {
  taskId: string;
  column: BoardColumnId;
  pending: boolean;
  onMove: (stage: BoardTask["stage"]) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const toReady = useCallback(() => onMove("ready"), [onMove]);
  const toFog = useCallback(() => onMove("fog"), [onMove]);
  if (column !== "fog" && column !== "ready") return null;
  const isFog = column === "fog";
  return (
    <DropdownMenuItem
      leading={isFog ? deskMenuIcons.toReady : deskMenuIcons.toFog}
      status={pending ? "pending" : "idle"}
      pendingLabel={t("board.brief.card.moving")}
      onSelect={isFog ? toReady : toFog}
      testID={`board-card-stage-${taskId}`}
    >
      {isFog ? t("board.brief.card.moveToReady") : t("board.brief.card.moveToFog")}
    </DropdownMenuItem>
  );
}

function BacklogMoveItems({
  move,
  onMove,
}: {
  move: BacklogMove;
  onMove: (rank: number) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { up, down } = move;
  const moveUp = useCallback(() => {
    if (up !== null) onMove(up);
  }, [onMove, up]);
  const moveDown = useCallback(() => {
    if (down !== null) onMove(down);
  }, [down, onMove]);
  return (
    <>
      {up !== null ? (
        <DropdownMenuItem leading={deskMenuIcons.moveUp} onSelect={moveUp}>
          {t("board.ui.moveUp")}
        </DropdownMenuItem>
      ) : null}
      {down !== null ? (
        <DropdownMenuItem leading={deskMenuIcons.moveDown} onSelect={moveDown}>
          {t("board.ui.moveDown")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
