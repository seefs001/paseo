import type {
  DaemonClient,
  FetchAgentTimelineOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export const LIVE_HISTORY_FETCH_TIMEOUT_MS = 2_000;

interface FetchProjectedTimelineItemsInput {
  client: DaemonClient;
  agentId: string;
  timeoutMs?: number;
  sinceTimestampMs?: number;
  tailCount?: number;
  filter?: (item: AgentTimelineItem) => boolean;
}

export async function fetchProjectedTimelineItems(
  input: FetchProjectedTimelineItemsInput,
): Promise<AgentTimelineItem[]> {
  const { tailCount, sinceTimestampMs } = input;
  if (tailCount === 0) return [];

  const pages: AgentTimelineItem[][] = [];
  let count = 0;
  let cursor: FetchAgentTimelineOptions["cursor"];
  do {
    let limit = 0;
    if (tailCount !== undefined) {
      limit =
        input.filter || sinceTimestampMs !== undefined ? 200 : Math.min(tailCount - count, 200);
    }
    const timeline = await input.client.fetchAgentTimeline(input.agentId, {
      direction: cursor ? "before" : "tail",
      cursor,
      limit,
      projection: "projected",
      timeout: input.timeoutMs,
    });
    if (cursor && (timeline.staleCursor || timeline.epoch !== cursor.epoch)) {
      throw new Error("Agent timeline changed while reading history. Retry the command.");
    }
    const items = timeline.entries
      .filter(
        (entry) =>
          sinceTimestampMs === undefined || Date.parse(entry.timestamp) >= sinceTimestampMs,
      )
      .map((entry) => entry.item)
      .filter((item) => !input.filter || input.filter(item));
    pages.push(items);
    count += items.length;
    if (tailCount === undefined || count >= tailCount || !timeline.hasOlder) break;
    cursor = timeline.startCursor ?? undefined;
  } while (cursor);

  const items = pages.toReversed().flat();
  return tailCount === undefined ? items : items.slice(-tailCount);
}
