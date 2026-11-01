import { CheckCheck, SquareArrowOutUpRight } from "lucide-react-native";
import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardAgentItem, BoardItem } from "@/board/items";
import { useBoardAgentActions } from "@/components/board/agent-card-actions";
import { BoardReviewActions } from "@/components/board/review-actions";
import { BoardReviewCriteria } from "@/components/board/review-criteria";
import { DESK_BREAK_WORDS, DeskClamp } from "@/components/board/desk-clamp";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { itemName } from "./desk-brief-parts";

/** Enough rows to reach the last reply past a run of tool calls. */
const REPLY_TAIL_LIMIT = 40;
const EXCERPT_LENGTH = 320;
const CRITERIA_EXPANDED_MAX = 4;
/** About four lines of small text. */
const TEXT_CLAMP_HEIGHT = 72;

/** The reply as one line of prose: Markdown marks and line breaks dropped, cut to a few lines. */
function toExcerpt(text: string): string {
  const flat = text
    .replace(/[#*_`>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH)}…` : flat;
}

async function fetchLastReply(serverId: string, agentId: string): Promise<string | null> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client?.isConnected) throw new Error(i18n.t("board.errors.offline"));
  // A direct read: the brief must not merge this page into the agent's open timeline.
  const tail = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: REPLY_TAIL_LIMIT,
    projection: "projected",
  });
  const entry = tail.entries.findLast((candidate) => candidate.item.type === "assistant_message");
  return entry?.item.type === "assistant_message" ? toExcerpt(entry.item.text) : null;
}

/**
 * A review brief: the task's criteria with their ticks and what the agent says it did, then
 * Accept and Request changes. A plain session shows the agent's last reply and Mark read.
 */
export function DeskBriefReview({ item }: { item: BoardItem }): ReactElement {
  const { t } = useTranslation();
  const card = item.kind === "task" ? item.card : item.task;
  const workspace = item.kind === "agent" ? item.workspace : item.card.workspace;
  const summary = card?.task.summary ?? null;
  return (
    <View style={styles.container}>
      {card ? (
        <BoardReviewCriteria
          taskId={card.task.id}
          criteria={card.task.acceptanceCriteria}
          // A long checklist folds to its met count, so the brief stays one glance tall.
          defaultExpanded={card.task.acceptanceCriteria.length <= CRITERIA_EXPANDED_MAX}
        />
      ) : null}
      {summary ? (
        <DeskClamp maxHeight={TEXT_CLAMP_HEIGHT} testID={`desk-brief-summary-${card?.task.id}`}>
          <Text style={styles.text}>{summary}</Text>
        </DeskClamp>
      ) : null}
      {!summary && item.kind === "agent" ? <LastReplyExcerpt item={item} /> : null}
      {card && workspace ? <BoardReviewActions card={card} workspace={workspace} /> : null}
      {!card && item.kind === "agent" ? <SessionReviewActions item={item} /> : null}
      {card && !workspace ? (
        <Text style={styles.muted}>{t("board.workspaceUnavailable")}</Text>
      ) : null}
    </View>
  );
}

function LastReplyExcerpt({ item }: { item: BoardAgentItem }): ReactElement | null {
  const { t } = useTranslation();
  const { serverId, agent } = item;
  const settledAt = agent.lastActivityAt.getTime();
  const query = useFetchQuery({
    queryKey: ["desk-brief-last-reply", serverId, agent.id, settledAt],
    queryFn: () => fetchLastReply(serverId, agent.id),
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
  });
  if (query.isError) {
    return <Text style={styles.muted}>{t("board.brief.review.replyFailed")}</Text>;
  }
  if (query.data === undefined) {
    return <Text style={styles.muted}>{t("board.brief.review.replyLoading")}</Text>;
  }
  if (query.data === null) return null;
  return (
    <Text style={styles.text} numberOfLines={4} testID={`desk-brief-reply-${agent.id}`}>
      {query.data}
    </Text>
  );
}

function SessionReviewActions({ item }: { item: BoardAgentItem }): ReactElement {
  const { t } = useTranslation();
  const title = useMemo(() => itemName(item), [item]);
  const actions = useBoardAgentActions(item, title);
  return (
    <View style={styles.actions}>
      {actions.markRead ? (
        <Button
          size="xs"
          variant="secondary"
          leftIcon={CheckCheck}
          onPress={actions.markRead}
          loading={actions.pending === "markRead"}
          disabled={actions.pending !== null}
          testID={`desk-brief-mark-read-${item.agent.id}`}
        >
          {actions.pending === "markRead"
            ? t("board.agent.actions.markingRead")
            : t("board.agent.actions.markRead")}
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" leftIcon={SquareArrowOutUpRight} onPress={actions.open}>
        {t("board.agent.actions.open")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    ...DESK_BREAK_WORDS,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
