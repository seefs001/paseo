import {
  AlarmClock,
  Archive,
  MessageCircleQuestionMark,
  RotateCcw,
  SquareArrowOutUpRight,
} from "lucide-react-native";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { archiveBoardAgent } from "@/board/agent-actions";
import type { DeskCheckpoint } from "@/board/desk";
import type { BoardAgentItem, BoardItem } from "@/board/items";
import { BoardLiveDuration } from "@/components/board/agent-time";
import { boardCardStyles } from "@/components/board/card-styles";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { sendBoardAgentPrompt } from "@/components/board/review-changes-sheet";
import { parseQuestionFormQuestions } from "@/components/question-form-card-core";
import { DESK_BREAK_WORDS, DeskClamp } from "@/components/board/desk-clamp";
import { DESK_MENU_ICON_SIZE, deskMenuIcons } from "@/components/board/task-menu";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { DeskBriefDecision } from "./desk-brief-decision";
import {
  DESK_SNOOZE_PAGE_ID,
  DeskSnoozeMenu,
  GoalChip,
  TaskChip,
  itemTask,
  useCheckpointHeadline,
  useSnoozePage,
} from "./desk-brief-parts";
import { DeskBriefReview } from "./desk-brief-review";

type HoverState = PressableStateCallbackType & { hovered?: boolean; open?: boolean };

const ThemedAlarm = withUnistyles(AlarmClock);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const snoozeLeading = <ThemedAlarm size={DESK_MENU_ICON_SIZE} uniProps={mutedColorMapping} />;

const SELECTED_STATE = { selected: true };
const NOT_SELECTED_STATE = { selected: false };

/** About four lines of small text. */
const TEXT_CLAMP_HEIGHT = 72;

/** What a failed agent is told on Retry. */
const RETRY_PROMPT = "Continue";

interface DeskBriefProps {
  checkpoint: DeskCheckpoint;
  selected: boolean;
  onOpenDetail: (item: BoardItem) => void;
}

/**
 * One checkpoint as a brief: what happened, the context needed to decide, and the actions right
 * there. Pressing a brief that has an agent or task opens its detail.
 */
export const DeskBrief = memo(function DeskBrief({
  checkpoint,
  selected,
  onOpenDetail,
}: DeskBriefProps): ReactElement {
  const { item } = checkpoint;
  const headline = useCheckpointHeadline(checkpoint);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = useCallback(() => {
    if (item) onOpenDetail(item);
  }, [item, onOpenDetail]);
  const cardStyle = useCallback(
    ({ hovered, pressed, open: menuShown }: HoverState) => [
      boardCardStyles.card,
      styles.card,
      hovered && boardCardStyles.hovered,
      (selected || menuShown) && boardCardStyles.selected,
      pressed && boardCardStyles.pressed,
    ],
    [selected],
  );
  const staticStyle = useMemo(
    () => [boardCardStyles.card, styles.card, (selected || menuOpen) && boardCardStyles.selected],
    [menuOpen, selected],
  );
  const content = (
    <>
      <BriefHeader checkpoint={checkpoint} />
      <Text style={styles.headline} numberOfLines={2}>
        {headline}
      </Text>
      <BriefContext checkpoint={checkpoint} />
      <BriefBody checkpoint={checkpoint} />
    </>
  );
  return (
    <View style={styles.container} testID={`desk-brief-${checkpoint.key}`}>
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {/* A decision has a note field, so it is not one big press target. */}
        {item ? (
          <ContextMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={headline}
            accessibilityState={selected ? SELECTED_STATE : NOT_SELECTED_STATE}
            onPress={open}
            style={cardStyle}
            highlightStyle={boardCardStyles.pressed}
          >
            {content}
          </ContextMenuTrigger>
        ) : (
          <ContextMenuTrigger contextOnly style={staticStyle}>
            {content}
          </ContextMenuTrigger>
        )}
        <CheckpointMenuContent checkpoint={checkpoint} headline={headline} onOpen={open} />
      </ContextMenu>
      <View style={styles.menuSlot}>
        <DeskSnoozeMenu checkpoint={checkpoint} />
      </View>
    </View>
  );
});

function itemWorkspaceId(item: BoardItem): string | null {
  return item.kind === "agent" ? item.workspace.id : (item.card.workspace?.id ?? null);
}

/** Open, put off, or copy a checkpoint; a right click on its brief opens this. */
function CheckpointMenuContent({
  checkpoint,
  headline,
  onOpen,
}: {
  checkpoint: DeskCheckpoint;
  headline: string;
  onOpen: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const { item } = checkpoint;
  const snoozePage = useSnoozePage(checkpoint);
  const pages = useMemo(() => [snoozePage], [snoozePage]);
  const workspaceId = item ? itemWorkspaceId(item) : null;
  const openWork = useCallback(() => {
    if (item?.kind === "agent") {
      navigateToAgent({ serverId: item.serverId, agentId: item.agent.id, workspaceId });
    } else if (item && workspaceId) {
      navigateToWorkspace({ serverId: item.serverId, workspaceId });
    }
  }, [item, workspaceId]);
  const copyHeadline = useCallback(() => {
    copyToClipboard(headline).then(
      () => toast.copied(t("board.ui.copiedTitle")),
      (error: unknown) =>
        toast.error(`${t("common.errors.unableToCopy")}: ${toErrorMessage(error)}`),
    );
  }, [headline, t, toast]);
  return (
    <ContextMenuContent
      align="start"
      width={240}
      pages={pages}
      testID={`desk-brief-context-${checkpoint.key}`}
    >
      {item ? (
        <ContextMenuItem leading={deskMenuIcons.detail} onSelect={onOpen}>
          {t("board.ui.openDetail")}
        </ContextMenuItem>
      ) : null}
      {workspaceId ? (
        <ContextMenuItem leading={deskMenuIcons.open} onSelect={openWork}>
          {item?.kind === "agent" ? t("board.agent.actions.open") : t("board.actions.open")}
        </ContextMenuItem>
      ) : null}
      <DropdownMenuSubTrigger
        id={DESK_SNOOZE_PAGE_ID}
        leading={snoozeLeading}
        testID={`desk-brief-context-snooze-${checkpoint.key}`}
      >
        {t("board.brief.snooze.menu")}
      </DropdownMenuSubTrigger>
      <ContextMenuSeparator />
      <ContextMenuItem leading={deskMenuIcons.copy} onSelect={copyHeadline}>
        {t("board.ui.copyTitle")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function BriefHeader({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement {
  const { t } = useTranslation();
  const since = useMemo(() => new Date(checkpoint.since), [checkpoint.since]);
  return (
    <View style={styles.header}>
      <View style={[styles.kindDot, kindDotStyle(checkpoint.kind)]} />
      <Text style={styles.kind}>{t(`board.brief.kind.${checkpoint.kind}`)}</Text>
      <BoardLiveDuration since={since} kind="waiting" style={styles.waited} />
    </View>
  );
}

/** The goal, the task and, for a decision with no item, nothing more: the body names the agent. */
function BriefContext({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement | null {
  const { goal, item } = checkpoint;
  const task = item ? itemTask(item) : null;
  if (!goal && !task) return null;
  return (
    <View style={styles.chips}>
      {goal ? <GoalChip goal={goal} /> : null}
      {task ? <TaskChip task={task} /> : null}
    </View>
  );
}

function BriefBody({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement | null {
  const { item, decision, serverId } = checkpoint;
  if (decision) {
    return <DeskBriefDecision serverId={serverId} decision={decision} goal={checkpoint.goal} />;
  }
  if (!item) return null;
  switch (checkpoint.kind) {
    case "permission":
      return item.kind === "agent" ? (
        <BoardPermissionRequest serverId={serverId} agentId={item.agent.id} />
      ) : (
        <TaskPermission item={item} />
      );
    case "question":
      return item.kind === "agent" ? <QuestionBody item={item} /> : null;
    case "failed":
      return item.kind === "agent" ? <FailedBody item={item} /> : null;
    default:
      if (item.kind === "task" && item.column === "needs_you")
        return <TaskPermission item={item} />;
      return <DeskBriefReview item={item} />;
  }
}

function TaskPermission({ item }: { item: BoardItem }): ReactElement | null {
  const workspace = item.kind === "task" ? item.card.workspace : item.workspace;
  if (!workspace) return null;
  return <BoardPermissionRequest serverId={item.serverId} workspaceId={workspace.id} />;
}

/** The question itself; answering needs its form, which lives in the agent's session. */
function QuestionBody({ item }: { item: BoardAgentItem }): ReactElement {
  const { t } = useTranslation();
  const { serverId, agent } = item;
  const request = agent.pendingPermissions[0];
  const question = useMemo(() => {
    const questions = parseQuestionFormQuestions(request?.input);
    return questions?.[0]?.question ?? request?.description ?? request?.title ?? null;
  }, [request]);
  const answer = useCallback(() => {
    navigateToAgent({ serverId, agentId: agent.id, workspaceId: item.workspace.id });
  }, [agent.id, item.workspace.id, serverId]);
  return (
    <View style={styles.body}>
      {question ? (
        <DeskClamp maxHeight={TEXT_CLAMP_HEIGHT}>
          <Text style={styles.text}>{question}</Text>
        </DeskClamp>
      ) : null}
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={MessageCircleQuestionMark}
          onPress={answer}
          testID={`desk-brief-answer-${agent.id}`}
        >
          {t("board.brief.question.answer")}
        </Button>
      </View>
    </View>
  );
}

type FailedAction = "retry" | "archive";

function FailedBody({ item }: { item: BoardAgentItem }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, agent } = item;
  const [pending, setPending] = useState<FailedAction | null>(null);
  const run = useCallback(
    async (action: FailedAction, operation: () => Promise<unknown>, failKey: string) => {
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
    navigateToAgent({ serverId, agentId: agent.id, workspaceId: item.workspace.id });
  }, [agent.id, item.workspace.id, serverId]);
  const retry = useCallback(() => {
    void run(
      "retry",
      () => sendBoardAgentPrompt({ serverId, agentId: agent.id, text: RETRY_PROMPT }),
      "board.brief.failed.retryFailed",
    );
  }, [agent.id, run, serverId]);
  const archive = useCallback(() => {
    void run(
      "archive",
      () => archiveBoardAgent(serverId, agent.id),
      "board.agent.actions.archiveFailed",
    );
  }, [agent.id, run, serverId]);
  return (
    <View style={styles.body}>
      {agent.lastError ? (
        <DeskClamp maxHeight={TEXT_CLAMP_HEIGHT}>
          <Text style={styles.error} testID={`desk-brief-error-${agent.id}`}>
            {agent.lastError}
          </Text>
        </DeskClamp>
      ) : null}
      <View style={styles.actions}>
        <Button size="sm" variant="secondary" leftIcon={SquareArrowOutUpRight} onPress={open}>
          {t("board.agent.actions.open")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={RotateCcw}
          onPress={retry}
          loading={pending === "retry"}
          disabled={pending !== null}
          testID={`desk-brief-retry-${agent.id}`}
        >
          {pending === "retry" ? t("board.brief.failed.retrying") : t("board.brief.failed.retry")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={Archive}
          onPress={archive}
          loading={pending === "archive"}
          disabled={pending !== null}
          testID={`desk-brief-archive-${agent.id}`}
        >
          {pending === "archive"
            ? t("board.agent.actions.archiving")
            : t("board.agent.actions.archive")}
        </Button>
      </View>
    </View>
  );
}

function kindDotStyle(kind: DeskCheckpoint["kind"]) {
  switch (kind) {
    case "permission":
    case "question":
      return styles.dotNeedsYou;
    case "failed":
      return styles.dotFailed;
    case "review":
      return styles.dotReview;
    default:
      return styles.dotDecision;
  }
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  card: {
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingRight: theme.spacing[6],
  },
  kindDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  dotNeedsYou: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotFailed: {
    backgroundColor: theme.colors.destructive,
  },
  dotReview: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  dotDecision: {
    backgroundColor: theme.colors.accent,
  },
  kind: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  waited: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  headline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    paddingRight: theme.spacing[4],
    ...DESK_BREAK_WORDS,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  body: {
    gap: theme.spacing[2],
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    ...DESK_BREAK_WORDS,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    ...DESK_BREAK_WORDS,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  menuSlot: {
    position: "absolute",
    top: theme.spacing[1],
    right: theme.spacing[1.5],
  },
}));
