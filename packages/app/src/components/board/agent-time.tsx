import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, type StyleProp, type TextStyle } from "react-native";
import type { BoardAgentItem } from "@/board/items";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { formatDuration } from "@/utils/time";

const TICK_MS = 1000;

/**
 * "Running for 2m 12s" or "Waiting for 40s", counting up every second. Owns its own tick so only
 * this text re-renders, never the card around it.
 */
export function BoardLiveDuration({
  since,
  kind,
  style,
}: {
  since: Date;
  kind: "running" | "waiting";
  style?: StyleProp<TextStyle>;
}): ReactElement {
  const { t } = useTranslation();
  const sinceMs = since.getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, [sinceMs]);
  const duration = formatDuration(Math.max(0, now - sinceMs));
  return (
    <Text style={style} numberOfLines={1}>
      {kind === "running"
        ? t("board.agent.time.runningFor", { duration })
        : t("board.agent.time.waitingFor", { duration })}
    </Text>
  );
}

/** "Updated 5m ago", kept current. */
export function BoardUpdatedAgo({
  date,
  style,
}: {
  date: Date;
  style?: StyleProp<TextStyle>;
}): ReactElement {
  const { t } = useTranslation();
  const time = useTimeAgo(date);
  return (
    <Text style={style} numberOfLines={1}>
      {t("board.agent.time.updated", { time })}
    </Text>
  );
}

/** In progress counts the open turn, Needs you counts the wait; anything else is last update. */
export function BoardAgentTimer({
  item,
  style,
}: {
  item: BoardAgentItem;
  style?: StyleProp<TextStyle>;
}): ReactElement {
  const { agent, column } = item;
  const { turn } = agent;
  if (column === "running" && turn.phase === "open" && turn.startedAt) {
    return <BoardLiveDuration since={turn.startedAt} kind="running" style={style} />;
  }
  if (column === "needs_you") {
    return (
      <BoardLiveDuration
        since={agent.attentionTimestamp ?? agent.updatedAt}
        kind="waiting"
        style={style}
      />
    );
  }
  return <BoardUpdatedAgo date={agent.updatedAt} style={style} />;
}
