import type { BoardTask, BoardTaskAttachment } from "@getpaseo/protocol/messages";
import { CloudFog, ListChecks, Pencil, Play, SquareArrowOutUpRight } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import type { BoardCard } from "@/board/columns";
import { setTaskStage } from "@/board/desk-actions";
import type { BoardTaskItem } from "@/board/items";
import { openBoardTaskSheet } from "@/board/sheet";
import { startBoardTask } from "@/board/start";
import { useBoardTasks } from "@/board/tasks";
import {
  DetailCriteria,
  DetailGoalProperty,
  DetailListRow,
  DetailMarkdown,
  DetailProperty,
  DetailSection,
} from "@/components/board/detail-parts";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { BoardReviewActions } from "@/components/board/review-actions";
import { BoardReviewClaim, useClaimantName } from "@/components/board/review-claim";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { toErrorMessage } from "@/utils/error-messages";
import { openExternalUrl } from "@/utils/open-external-url";

const NO_TASKS: ReadonlyMap<string, BoardTask> = new Map();

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** Start, Open workspace, the Fog and Ready move, and Edit, the same choices the task card offers. */
export function BoardTaskActions({
  item,
  onEditTask,
}: {
  item: BoardTaskItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { card } = item;
  const { task, workspace, project, serverId } = card;
  const claimantName = useClaimantName(serverId, task.claimedBy);
  const canStart = task.completedAt === null && workspace === null;
  const firstBlocker = card.openBlockers[0];
  let startBlockedReason: string | undefined;
  if (firstBlocker) startBlockedReason = t("board.review.blockedBy", { title: firstBlocker.title });
  else if (claimantName)
    startBlockedReason = t("board.review.claim.claimedBy", { name: claimantName });

  const start = useCallback(
    () => startBoardTask({ serverId, task, project }),
    [project, serverId, task],
  );
  const open = useCallback(() => {
    if (workspace) navigateToWorkspace({ serverId, workspaceId: workspace.id });
  }, [serverId, workspace]);
  const edit = useCallback(() => onEditTask(card), [card, onEditTask]);

  return (
    <View style={styles.actions}>
      {canStart ? (
        <Button
          size="xs"
          variant="secondary"
          leftIcon={Play}
          onPress={start}
          disabled={startBlockedReason !== undefined}
          accessibilityHint={startBlockedReason}
          testID="board-detail-start"
        >
          {t("board.actions.start")}
        </Button>
      ) : null}
      {workspace ? (
        <Button size="xs" variant="outline" leftIcon={SquareArrowOutUpRight} onPress={open}>
          {t("board.actions.open")}
        </Button>
      ) : null}
      {item.column === "fog" || item.column === "ready" ? <StageButton card={card} /> : null}
      <Button
        size="xs"
        variant="outline"
        leftIcon={Pencil}
        onPress={edit}
        testID="board-detail-edit"
      >
        {t("board.actions.edit")}
      </Button>
    </View>
  );
}

/** Fog -> Ready once the idea is specified enough for an agent; Ready -> Fog takes it back. */
function StageButton({ card }: { card: BoardCard }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const { serverId, task } = card;
  const toReady = task.stage === "fog";
  const move = useCallback(async () => {
    setMoving(true);
    try {
      await setTaskStage(serverId, task, toReady ? "ready" : "fog");
    } catch (error) {
      toast.error(t("board.desk.detail.stageFailed", { message: toErrorMessage(error) }));
    } finally {
      setMoving(false);
    }
  }, [serverId, t, task, toReady, toast]);
  let label = t(toReady ? "board.desk.detail.markReady" : "board.desk.detail.backToFog");
  if (moving) label = t("board.agent.taskCard.moving");
  return (
    <Button
      size="xs"
      variant="outline"
      leftIcon={toReady ? ListChecks : CloudFog}
      onPress={move}
      disabled={moving}
      testID="board-detail-stage"
    >
      {label}
    </Button>
  );
}

export function BoardTaskDetailBody({
  item,
  onEditTask,
  showProperties = true,
}: {
  item: BoardTaskItem;
  onEditTask: (card: BoardCard) => void;
  /** False when the properties render in their own column. */
  showProperties?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { card } = item;
  const { task, workspace, serverId } = card;
  const claimantName = useClaimantName(serverId, task.claimedBy);
  const host = useBoardTasks((state) => state.hosts[serverId]);
  const tasks = host?.status === "ready" ? host.tasks : NO_TASKS;
  const blockers = useMemo(
    () => task.blockedBy.flatMap((id) => tasks.get(id) ?? []),
    [task.blockedBy, tasks],
  );
  const subtasks = useMemo(
    () => [...tasks.values()].filter((candidate) => candidate.parentId === task.id),
    [task.id, tasks],
  );

  return (
    <>
      {claimantName ? (
        <BoardReviewClaim serverId={serverId} taskId={task.id} claimantName={claimantName} />
      ) : null}
      {item.column === "needs_you" && workspace ? (
        <BoardPermissionRequest serverId={serverId} workspaceId={workspace.id} />
      ) : null}
      {item.column === "review" && workspace ? (
        <BoardReviewActions card={card} workspace={workspace} />
      ) : null}
      {showProperties ? <BoardTaskProperties item={item} /> : null}
      {task.notes ? <DetailMarkdown title={t("board.form.notes")} text={task.notes} /> : null}
      {!task.notes && task.completedAt === null ? (
        <NotesPlaceholder card={card} onEditTask={onEditTask} />
      ) : null}
      {task.acceptanceCriteria.length > 0 ? (
        <DetailSection title={t("board.plan.acceptanceCriteria")}>
          <DetailCriteria criteria={task.acceptanceCriteria} />
        </DetailSection>
      ) : null}
      {task.summary ? (
        <DetailMarkdown title={t("board.detail.summary")} text={task.summary} />
      ) : null}
      {task.attachments.length > 0 ? (
        <DetailSection title={t("board.capture.attachments")}>
          {task.attachments.map((attachment) => (
            <AttachmentRow
              key={`${attachment.type}:${attachment.number}`}
              attachment={attachment}
            />
          ))}
        </DetailSection>
      ) : null}
      {blockers.length > 0 ? (
        <DetailSection title={t("board.plan.blockedBy")}>
          {blockers.map((blocker) => (
            <TaskRow key={blocker.id} serverId={serverId} task={blocker} />
          ))}
        </DetailSection>
      ) : null}
      {subtasks.length > 0 ? (
        <DetailSection title={t("board.detail.subtasks", { count: subtasks.length })}>
          {subtasks.map((subtask) => (
            <TaskRow key={subtask.id} serverId={serverId} task={subtask} />
          ))}
        </DetailSection>
      ) : null}
    </>
  );
}

export function BoardTaskProperties({ item }: { item: BoardTaskItem }): ReactElement {
  const { t } = useTranslation();
  const { card, serverName } = item;
  const { task, project, workspace } = card;
  const planned = task.completedAt === null && task.workspaceId === null;
  return (
    <DetailSection title={t("board.detail.properties")}>
      <DetailProperty label={t("board.detail.id")} value={`T-${task.number}`} />
      {planned ? (
        <DetailProperty
          label={t("board.detail.stage")}
          value={t(task.stage === "ready" ? "board.desk.stages.ready" : "board.desk.stages.fog")}
        />
      ) : null}
      <DetailGoalProperty serverId={card.serverId} goalId={task.goalId} />
      <DetailProperty
        label={t("board.plan.readyFor")}
        value={
          task.readyFor === "agent" ? t("board.plan.readyForAgent") : t("board.plan.readyForHuman")
        }
      />
      {project ? (
        <DetailProperty
          label={t("board.detail.project")}
          value={project.projectCustomName ?? project.projectDisplayName}
        />
      ) : null}
      {workspace ? (
        <DetailProperty
          label={t("board.detail.workspace")}
          value={workspace.title ?? workspace.name}
        />
      ) : null}
      {task.workspaceId !== null && workspace === null && task.completedAt === null ? (
        <DetailProperty
          label={t("board.detail.workspace")}
          value={t("board.workspaceUnavailable")}
        />
      ) : null}
      <DetailProperty label={t("board.detail.host")} value={serverName} />
    </DetailSection>
  );
}

/** An open task with no notes invites them; pressing it edits the task. */
function NotesPlaceholder({
  card,
  onEditTask,
}: {
  card: BoardCard;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const { t } = useTranslation();
  const edit = useCallback(() => onEditTask(card), [card, onEditTask]);
  return (
    <DetailSection title={t("board.form.notes")}>
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={t("board.actions.edit")}
        onPress={edit}
        style={notesPlaceholderStyle}
        highlightStyle={styles.notesPlaceholderPressed}
        testID="board-detail-add-notes"
      >
        <Text style={styles.notesPlaceholderText}>{t("board.form.notesPlaceholder")}</Text>
      </PressHighlight>
    </DetailSection>
  );
}

function notesPlaceholderStyle({ hovered, pressed }: HoverState) {
  return [
    styles.notesPlaceholder,
    hovered && styles.notesPlaceholderHovered,
    pressed && styles.notesPlaceholderPressed,
  ];
}

/** A blocker or subtask; pressing it edits that task. */
function TaskRow({ serverId, task }: { serverId: string; task: BoardTask }): ReactElement {
  const { t } = useTranslation();
  const edit = useCallback(
    () => openBoardTaskSheet({ mode: "edit", serverId, task }),
    [serverId, task],
  );
  return (
    <DetailListRow
      label={`T-${task.number} ${task.title}`}
      trailing={task.completedAt !== null ? t("board.columns.done") : undefined}
      onPress={edit}
      testID={`board-detail-task-${task.id}`}
    />
  );
}

function AttachmentRow({ attachment }: { attachment: BoardTaskAttachment }): ReactElement {
  const { t } = useTranslation();
  const content = getAgentAttachmentPillContent(attachment, t);
  const open = useCallback(() => {
    void openExternalUrl(attachment.url);
  }, [attachment.url]);
  return (
    <DetailListRow
      leading={content.icon}
      label={content.title}
      trailing={content.subtitle}
      onPress={open}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  notesPlaceholder: {
    // Lines the text up with the section title while the hover fill reaches past it.
    marginHorizontal: -theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.base,
  },
  notesPlaceholderHovered: {
    backgroundColor: theme.colors.surface2,
  },
  notesPlaceholderPressed: {
    backgroundColor: theme.colors.surface3,
  },
  notesPlaceholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
