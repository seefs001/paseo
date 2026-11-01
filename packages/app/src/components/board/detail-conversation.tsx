import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { useFetchQuery } from "@/data/query";
import { useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DetailMarkdown, DetailSection, DetailSkeleton } from "@/components/board/detail-parts";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { Agent } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

/** Enough rows to reach the last reply past a run of tool calls. */
const REPLY_TAIL_LIMIT = 40;

interface BoardConversation {
  firstPrompt: string | null;
  /** Null when the agent only had one prompt; the first prompt already shows it. */
  lastPrompt: string | null;
  lastReply: string | null;
}

type PromptIndex = Awaited<ReturnType<DaemonClient["listAgentTimelinePrompts"]>>;
type PromptEntry = PromptIndex["prompts"][number];

function textOf(item: AgentTimelineItem | undefined, type: "user_message" | "assistant_message") {
  return item?.type === type ? item.text : null;
}

/** The prompt index holds short previews; the full text is the one row at the prompt's seq. */
async function readPrompt(input: {
  client: DaemonClient;
  agentId: string;
  epoch: string;
  prompt: PromptEntry;
}): Promise<string> {
  const { client, agentId, epoch, prompt } = input;
  const page = await client.fetchAgentTimeline(agentId, {
    direction: "after",
    cursor: { epoch, seq: prompt.seq - 1 },
    limit: 1,
    projection: "projected",
  });
  const entry = page.entries.find((candidate) => candidate.item.type === "user_message");
  return textOf(entry?.item, "user_message") ?? prompt.preview;
}

async function fetchBoardConversation(
  serverId: string,
  agentId: string,
): Promise<BoardConversation> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client?.isConnected) throw new Error(i18n.t("board.errors.offline"));
  // Direct reads: the board must not merge these pages into the agent's open timeline.
  const [index, tail] = await Promise.all([
    client.listAgentTimelinePrompts(agentId),
    client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: REPLY_TAIL_LIMIT,
      projection: "projected",
    }),
  ]);
  const first = index.prompts[0];
  const last = index.prompts.at(-1);
  const [firstPrompt, lastPrompt] = await Promise.all([
    first ? readPrompt({ client, agentId, epoch: index.epoch, prompt: first }) : null,
    last && last !== first
      ? readPrompt({ client, agentId, epoch: index.epoch, prompt: last })
      : null,
  ]);
  const replyEntry = tail.entries.findLast((entry) => entry.item.type === "assistant_message");
  return { firstPrompt, lastPrompt, lastReply: textOf(replyEntry?.item, "assistant_message") };
}

/**
 * Read each time the panel opens and kept per agent, so reopening shows the last result at once
 * while it refreshes. A reply that lands while the panel is open triggers one more read.
 */
function useBoardConversation(serverId: string, agent: Agent) {
  const busy = agent.status === "running" || agent.status === "initializing";
  const settledAt = busy ? null : agent.lastActivityAt.getTime();
  const query = useFetchQuery({
    queryKey: ["board-detail-conversation", serverId, agent.id],
    queryFn: () => fetchBoardConversation(serverId, agent.id),
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
  });
  const { refetch } = query;
  const seenSettledAt = useRef(settledAt);
  useEffect(() => {
    if (seenSettledAt.current === settledAt) return;
    seenSettledAt.current = settledAt;
    if (settledAt !== null) void refetch();
  }, [refetch, settledAt]);
  return query;
}

export function BoardDetailConversation({
  serverId,
  agent,
}: {
  serverId: string;
  agent: Agent;
}): ReactElement {
  const { t } = useTranslation();
  const query = useBoardConversation(serverId, agent);

  if (query.data === undefined) {
    return (
      <DetailSection title={t("board.detail.firstPrompt")}>
        {query.isError ? (
          <Text style={styles.error}>
            {t("board.detail.conversationFailed", { message: toErrorMessage(query.error) })}
          </Text>
        ) : (
          <DetailSkeleton />
        )}
      </DetailSection>
    );
  }
  const { firstPrompt, lastPrompt, lastReply } = query.data;
  if (!firstPrompt && !lastReply) {
    return (
      <DetailSection title={t("board.detail.firstPrompt")}>
        <Text style={styles.muted}>{t("board.detail.noMessages")}</Text>
      </DetailSection>
    );
  }
  return (
    <View style={styles.container}>
      {firstPrompt ? (
        <DetailMarkdown
          title={t("board.detail.firstPrompt")}
          text={firstPrompt}
          testID="board-detail-first-prompt"
        />
      ) : null}
      {lastPrompt ? (
        <DetailMarkdown
          title={t("board.detail.lastPrompt")}
          text={lastPrompt}
          testID="board-detail-last-prompt"
        />
      ) : null}
      {lastReply ? (
        <DetailMarkdown
          title={t("board.detail.lastReply")}
          text={lastReply}
          testID="board-detail-last-reply"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
