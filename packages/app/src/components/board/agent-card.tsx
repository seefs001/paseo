import { deriveAgentStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import type { WorkspaceStateBucket } from "@getpaseo/protocol/messages";
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard } from "@/board/columns";
import { useDeskPrefs, type DeskPrefs } from "@/board/desk-prefs";
import type { BoardAgentItem, BoardItem } from "@/board/items";
import {
  BoardAgentMenu,
  BoardAgentQuickActions,
  useBoardAgentActions,
} from "@/components/board/agent-card-actions";
import {
  BoardAgentContextMeter,
  BoardBranchPill,
  BoardModelPills,
  BoardSubagentPill,
} from "@/components/board/agent-pills";
import { BoardAgentStateIndicator } from "@/components/board/agent-state-indicator";
import { BoardAgentTimer } from "@/components/board/agent-time";
import { GoalChip, useItemGoal } from "@/components/board/desk-brief-parts";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { BoardReviewActions } from "@/components/board/review-actions";
import { BoardReviewCriteria } from "@/components/board/review-criteria";
import { WorkspaceMetaRow } from "@/components/sidebar/workspace-meta-row";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { selectPrHintFromStatus } from "@/git/pr-hint";
import type { Agent } from "@/stores/session-store";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import { WorkspaceLabelChip } from "@/workspace-labels/chip";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const SELECTED_STATE = { selected: true };
const NOT_SELECTED_STATE = { selected: false };

interface BoardAgentCardProps {
  item: BoardAgentItem;
  showHost: boolean;
  selected: boolean;
  onSelect: (item: BoardItem) => void;
  onEditTask: (card: BoardCard) => void;
}

/** One live agent on the Board: its state, what it runs on, and the task riding on it. */
export const BoardAgentCard = memo(function BoardAgentCard({
  item,
  showHost,
  selected,
  onSelect,
  onEditTask,
}: BoardAgentCardProps): ReactElement {
  const { agent, workspace, task, serverId } = item;
  const title = agent.title?.trim() || workspace.name;
  const actions = useBoardAgentActions(item, title);
  const { prefs } = useDeskPrefs();
  const { fields } = prefs;
  const compact = prefs.density === "compact";
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = isHovered || menuOpen || isNative || isCompact;
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const press = useCallback(() => onSelect(item), [item, onSelect]);

  const cardStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      styles.card,
      compact && styles.cardCompact,
      hovered && styles.cardHovered,
      selected && styles.cardSelected,
      pressed && styles.cardPressed,
    ],
    [compact, selected],
  );
  return (
    <View
      style={styles.container}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={selected ? SELECTED_STATE : NOT_SELECTED_STATE}
        onPress={press}
        style={cardStyle}
        highlightStyle={styles.cardPressed}
        testID={`board-agent-card-${agent.id}`}
      >
        <AgentMetaLine item={item} showHost={showHost} onSelect={onSelect} />
        <View style={styles.titleRow}>
          <BoardAgentStateIndicator bucket={item.bucket} />
          <Text style={styles.title} numberOfLines={compact ? 1 : 2}>
            {title}
          </Text>
        </View>
        <AgentChips item={item} />
        <AgentPills item={item} fields={fields} />
        {fields.pullRequest ? <AgentPullRequest item={item} /> : null}
        <AgentStateDetails item={item} compact={compact} />
        <View style={styles.footer}>
          {fields.timer ? <BoardAgentTimer item={item} style={styles.timer} /> : null}
          <View style={styles.footerSpacer} />
          {fields.context ? <BoardAgentContextMeter serverId={serverId} agent={agent} /> : null}
          <BoardAgentQuickActions actions={actions} visible={showActions} agentId={agent.id} />
        </View>
      </PressHighlight>
      <View style={styles.menuSlot}>
        <BoardAgentMenu
          actions={actions}
          serverId={serverId}
          agentId={agent.id}
          task={task}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onEditTask={onEditTask}
        />
      </View>
    </View>
  );
});

function AgentChips({ item }: { item: BoardAgentItem }): ReactElement | null {
  const goal = useItemGoal(item);
  const { task } = item;
  if (!task && !goal) return null;
  return (
    <View style={styles.chips}>
      {goal ? <GoalChip goal={goal} /> : null}
      {task ? <TaskChip card={task} /> : null}
    </View>
  );
}

/** The sidebar's change request and CI items, so a card reads like its workspace row. */
function AgentPullRequest({ item }: { item: BoardAgentItem }): ReactElement | null {
  const { workspace } = item;
  const prHint = useMemo(
    () => selectPrHintFromStatus(workspace.githubRuntime?.pullRequest, workspace.forge),
    [workspace.forge, workspace.githubRuntime?.pullRequest],
  );
  if (!prHint) return null;
  return (
    <WorkspaceMetaRow
      currentBranch={null}
      projectName={null}
      hostBadge={null}
      prHint={prHint}
      serviceSummary={null}
    />
  );
}

/** What the state asks for: the error, the pending permission, or the task to review. */
function AgentStateDetails({
  item,
  compact,
}: {
  item: BoardAgentItem;
  compact: boolean;
}): ReactElement {
  const { agent, workspace, task, column, serverId } = item;
  const showError = item.bucket === "failed" && Boolean(agent.lastError);
  const reviewTask = column === "review" ? task : null;
  return (
    <>
      {showError ? (
        <Text style={styles.error} numberOfLines={3} testID={`board-agent-error-${agent.id}`}>
          {agent.lastError}
        </Text>
      ) : null}
      {column === "needs_you" ? (
        <BoardPermissionRequest serverId={serverId} agentId={agent.id} />
      ) : null}
      {reviewTask?.task.summary ? (
        <Text style={styles.notes} numberOfLines={compact ? 2 : 3}>
          {reviewTask.task.summary}
        </Text>
      ) : null}
      {reviewTask ? (
        <BoardReviewCriteria
          taskId={reviewTask.task.id}
          criteria={reviewTask.task.acceptanceCriteria}
        />
      ) : null}
      {reviewTask ? <BoardReviewActions card={reviewTask} workspace={workspace} /> : null}
    </>
  );
}

/** "Project › workspace", and for a subagent in a lane of its own, a link to its parent. */
function AgentMetaLine({
  item,
  showHost,
  onSelect,
}: {
  item: BoardAgentItem;
  showHost: boolean;
  onSelect: (item: BoardItem) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { project, workspace, parent } = item;
  const projectName =
    project?.projectCustomName ?? project?.projectDisplayName ?? workspace.projectDisplayName;
  const parentTitle = parent ? parent.title?.trim() || workspace.name : null;
  const selectParent = useCallback(() => {
    const parentItem = toParentItem(item);
    if (parentItem) onSelect(parentItem);
  }, [item, onSelect]);
  return (
    <View style={styles.metaLine}>
      <Text style={styles.meta} numberOfLines={1}>
        {`${projectName} › ${workspace.name}`}
        {showHost ? ` · ${item.serverName}` : ""}
      </Text>
      {parentTitle !== null ? (
        <Text
          style={styles.parentLink}
          numberOfLines={1}
          onPress={selectParent}
          accessibilityRole="link"
          accessibilityLabel={t("board.agent.parent", { title: parentTitle })}
          testID={`board-agent-parent-${item.agent.id}`}
        >
          {`↳ ${parentTitle}`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The parent as a Board item, for selection. Its key matches the parent's own card, so a screen
 * that resolves the selection by key lands on that card.
 */
function toParentItem(item: BoardAgentItem): BoardAgentItem | null {
  const { parent } = item;
  if (!parent) return null;
  return {
    ...item,
    key: `${item.serverId}:agent:${parent.id}`,
    agent: parent,
    bucket: agentBucket(parent),
    parent: null,
    children: [],
  };
}

function agentBucket(agent: Agent): WorkspaceStateBucket {
  if (agent.status === "initializing") return "running";
  return deriveAgentStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}

function TaskChip({ card }: { card: BoardCard }): ReactElement {
  const { task } = card;
  return (
    <View style={styles.taskChip} testID={`board-agent-task-${task.id}`}>
      <Text style={styles.taskNumber}>{`T-${task.number}`}</Text>
      <Text style={styles.taskTitle} numberOfLines={1}>
        {task.title}
      </Text>
    </View>
  );
}

function AgentPills({
  item,
  fields,
}: {
  item: BoardAgentItem;
  fields: DeskPrefs["fields"];
}): ReactElement {
  const { serverId, agent, workspace, children } = item;
  const branch = fields.branch ? (workspace.gitRuntime?.currentBranch ?? null) : null;
  const labels = useWorkspaceLabelDefinitions(
    serverId,
    fields.labels ? workspace.labels : undefined,
  );
  return (
    <View style={styles.pills}>
      {fields.model ? <BoardModelPills serverId={serverId} agent={agent} /> : null}
      {branch ? <BoardBranchPill branch={branch} /> : null}
      {labels.map((label) => (
        <WorkspaceLabelChip key={label.name} label={label} />
      ))}
      <BoardSubagentPill agentId={agent.id} childAgents={children} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
  },
  card: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
  },
  cardCompact: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  cardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  cardPressed: {
    backgroundColor: theme.colors.surface3,
  },
  metaLine: {
    gap: theme.spacing[1],
    paddingRight: theme.spacing[6],
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  parentLink: {
    alignSelf: "flex-start",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  taskChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  taskNumber: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
  taskTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  notes: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
  },
  timer: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footerSpacer: {
    flex: 1,
  },
  menuSlot: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
  },
}));
