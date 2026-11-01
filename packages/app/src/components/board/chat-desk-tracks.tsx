import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AwaitingAgent } from "@/board/chat-desk";
import type { BoardCard, BoardColumnId } from "@/board/columns";
import { toBoardTaskItem } from "@/board/items";
import { openBoardTaskSheet } from "@/board/sheet";
import { DESK_BREAK_WORDS } from "@/components/board/desk-clamp";
import { COLUMN_LABEL_KEYS } from "@/components/board/detail-panel";
import { DetailCriteria } from "@/components/board/detail-parts";
import { BoardDetailSheet } from "@/components/board/detail-sheet";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { useTaskMenu } from "@/components/board/task-menu";
import { MenuSeparator } from "@/components/ui/menu";
import { ComposerTrackMark, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/** A started task's column as the state mark every other tracker uses. */
const BUCKET_BY_COLUMN: Record<BoardColumnId, SidebarStateBucket | null> = {
  fog: null,
  ready: null,
  running: "running",
  needs_you: "needs_input",
  review: "attention",
  done: "done",
};

/**
 * The Desk task this conversation is working on, as a pill above the composer: its number, its
 * checklist progress and its state. The panel holds the task's actions, the same rows its Desk
 * card offers, and opens the Desk detail in place, so reviewing or finishing the task never
 * leaves the conversation.
 */
export const ChatTaskTrack = memo(function ChatTaskTrack({
  card,
}: {
  card: BoardCard;
}): ReactElement {
  const { t } = useTranslation();
  const { task, column } = card;
  const [detailOpen, setDetailOpen] = useState(false);
  const item = useMemo(() => toBoardTaskItem(card), [card]);
  const editTask = useCallback(
    (target: BoardCard) =>
      openBoardTaskSheet({ mode: "edit", serverId: target.serverId, task: target.task }),
    [],
  );
  const openDetail = useCallback(() => setDetailOpen(true), []);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const menu = useTaskMenu(card, { onEdit: editTask, onOpenDetail: openDetail, inWorkspace: true });

  const criteria = task.acceptanceCriteria;
  const met = criteria.filter((criterion) => criterion.met).length;
  const reference = `T-${task.number}`;
  const state = t(COLUMN_LABEL_KEYS[column]);
  const segments = useMemo(
    () => [
      {
        bucket: BUCKET_BY_COLUMN[column],
        text: criteria.length > 0 ? `${reference} · ${met}/${criteria.length}` : reference,
      },
    ],
    [column, criteria.length, met, reference],
  );

  return (
    <>
      <ComposerTrackPill
        testID={`chat-task-pill-${task.id}`}
        segments={segments}
        panelTitle={`${reference} ${task.title}`}
        accessibilityLabel={t("board.chat.taskLabel", { number: task.number, state })}
        pages={menu.pages}
      >
        <ComposerTrackRow>
          <View style={styles.taskHead}>
            <View style={styles.taskMeta}>
              <ComposerTrackMark bucket={BUCKET_BY_COLUMN[column]} />
              <Text style={styles.muted}>{`${reference} · ${state}`}</Text>
            </View>
            <Text style={styles.taskTitle} numberOfLines={3}>
              {task.title}
            </Text>
            {criteria.length > 0 ? <DetailCriteria criteria={criteria} /> : null}
          </View>
        </ComposerTrackRow>
        <MenuSeparator />
        {menu.items}
      </ComposerTrackPill>
      {menu.overlay}
      <BoardDetailSheet
        item={detailOpen ? item : null}
        onClose={closeDetail}
        onEditTask={editTask}
      />
    </>
  );
});

/**
 * Other agents waiting on the user, as one pill above the composer. A permission is answered
 * from its row; a question opens its agent, where the answer form lives. The pill leaves once
 * nothing waits.
 */
export const ChatAwaitingTrack = memo(function ChatAwaitingTrack({
  awaiting,
}: {
  awaiting: readonly AwaitingAgent[];
}): ReactElement {
  const { t } = useTranslation();
  const count = awaiting.length;
  const segments = useMemo(
    () => [{ bucket: "needs_input" as const, text: t("board.chat.waiting", { value: count }) }],
    [count, t],
  );
  return (
    <ComposerTrackPill
      testID="chat-awaiting-pill"
      segments={segments}
      panelTitle={t("board.chat.waitingTitle")}
      accessibilityLabel={t("board.chat.waitingLabel", { value: count })}
    >
      {awaiting.map((entry) => (
        <AwaitingRow key={`${entry.serverId}:${entry.agentId}`} entry={entry} />
      ))}
    </ComposerTrackPill>
  );
});

function AwaitingRow({ entry }: { entry: AwaitingAgent }): ReactElement {
  const { t } = useTranslation();
  const { serverId, agentId } = entry;
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId) ?? null);
  const workspace = useSessionStore((state) =>
    agent?.workspaceId
      ? (state.sessions[serverId]?.workspaces.get(agent.workspaceId) ?? null)
      : null,
  );
  const hosts = useHosts();
  const hostName =
    hosts.length > 1 ? (hosts.find((host) => host.serverId === serverId)?.label ?? null) : null;
  const open = useCallback(() => {
    navigateToAgent({ serverId, agentId, workspaceId: agent?.workspaceId });
  }, [agent?.workspaceId, agentId, serverId]);
  const title = agent?.title?.trim() || workspace?.name || t("board.brief.decision.unnamedAgent");
  const context = [workspace?.title ?? workspace?.name, hostName].filter(Boolean).join(" · ");
  return (
    <ComposerTrackRow
      onPress={open}
      accessibilityLabel={title}
      testID={`chat-awaiting-${serverId}-${agentId}`}
    >
      <View style={styles.awaiting}>
        <View style={styles.awaitingHead}>
          <ComposerTrackMark bucket="needs_input" />
          <Text style={styles.awaitingTitle} numberOfLines={1}>
            {title}
          </Text>
          {context && context !== title ? (
            <Text style={styles.awaitingContext} numberOfLines={1}>
              {context}
            </Text>
          ) : null}
        </View>
        <View style={styles.awaitingBody}>
          <BoardPermissionRequest serverId={serverId} agentId={agentId} />
        </View>
      </View>
    </ComposerTrackRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Rows span the shared frame; basis stays `auto` so text width reaches the panel's measurement.
  taskHead: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
  },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  taskTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    ...DESK_BREAK_WORDS,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  awaiting: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  awaitingHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  awaitingTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  awaitingContext: {
    flexShrink: 2,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // Lines the request up under the title, past the state mark.
  awaitingBody: {
    paddingLeft: theme.spacing[3],
  },
}));
