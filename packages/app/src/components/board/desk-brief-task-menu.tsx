import type { BoardGoal, BoardTask } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { setTaskGoal } from "@/board/desk-actions";
import {
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuSeparator,
  useDropdownMenuClose,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { useReadyBoardHost } from "./desk-brief-parts";

/** The `DropdownMenuSubTrigger` on a card's menu that opens the goal picker. */
export const DESK_ASSIGN_GOAL_PAGE_ID = "deskAssignGoal";

/** The "Assign to goal" page for a card menu's `pages`; null without a task. */
export function useAssignGoalPage(
  serverId: string,
  task: BoardTask | null,
): MenuPageDefinition | null {
  const { t } = useTranslation();
  return useMemo(
    () =>
      task
        ? {
            id: DESK_ASSIGN_GOAL_PAGE_ID,
            title: t("board.brief.card.assignGoal"),
            content: <AssignGoalPage serverId={serverId} task={task} />,
          }
        : null,
    [serverId, t, task],
  );
}

const LOOSE_ID = "loose";

/** The host's unlanded goals by rank, then Loose work; the task's current choice is checked. */
function AssignGoalPage({ serverId, task }: { serverId: string; task: BoardTask }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const close = useDropdownMenuClose();
  const host = useReadyBoardHost(serverId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const goals = useMemo(
    () =>
      [...(host?.goals.values() ?? [])]
        .filter((goal) => goal.landedAt === null)
        .sort((a, b) => a.rank - b.rank),
    [host],
  );
  const assign = useCallback(
    async (goalId: string | null) => {
      if (goalId === task.goalId) {
        close();
        return;
      }
      setPendingId(goalId ?? LOOSE_ID);
      try {
        await setTaskGoal(serverId, task, goalId);
        close();
      } catch (error) {
        toast.error(t("board.brief.card.assignFailed", { message: toErrorMessage(error) }));
      } finally {
        setPendingId(null);
      }
    },
    [close, serverId, t, task, toast],
  );
  const assignLoose = useCallback(() => {
    void assign(null);
  }, [assign]);
  return (
    <>
      {goals.length === 0 ? (
        <DropdownMenuHint>{t("board.brief.card.noGoals")}</DropdownMenuHint>
      ) : null}
      {goals.map((goal) => (
        <GoalItem
          key={goal.id}
          goal={goal}
          selected={task.goalId === goal.id}
          pendingId={pendingId}
          onAssign={assign}
        />
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        selected={task.goalId === null}
        status={pendingId === LOOSE_ID ? "pending" : "idle"}
        pendingLabel={t("board.brief.card.assigning")}
        disabled={pendingId !== null && pendingId !== LOOSE_ID}
        closeOnSelect={false}
        onSelect={assignLoose}
        testID="desk-assign-goal-loose"
      >
        {t("board.brief.card.loose")}
      </DropdownMenuItem>
    </>
  );
}

function GoalItem({
  goal,
  selected,
  pendingId,
  onAssign,
}: {
  goal: BoardGoal;
  selected: boolean;
  pendingId: string | null;
  onAssign: (goalId: string | null) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => {
    void onAssign(goal.id);
  }, [goal.id, onAssign]);
  return (
    <DropdownMenuItem
      selected={selected}
      description={`G-${goal.number}`}
      status={pendingId === goal.id ? "pending" : "idle"}
      pendingLabel={t("board.brief.card.assigning")}
      disabled={pendingId !== null && pendingId !== goal.id}
      closeOnSelect={false}
      onSelect={select}
      testID={`desk-assign-goal-${goal.id}`}
    >
      {goal.title}
    </DropdownMenuItem>
  );
}
