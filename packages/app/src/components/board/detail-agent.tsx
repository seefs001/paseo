import {
  Archive,
  CheckCheck,
  ListPlus,
  SquareArrowOutUpRight,
  Square,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  archiveBoardAgent,
  markBoardAgentRead,
  stopBoardAgent,
  trackAgentAsTask,
} from "@/board/agent-actions";
import type { BoardCard } from "@/board/columns";
import type { BoardAgentItem } from "@/board/items";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { BoardDetailConversation } from "@/components/board/detail-conversation";
import {
  DetailCriteria,
  DetailListRow,
  DetailMarkdown,
  DetailGoalProperty,
  DetailProperty,
  DetailSection,
} from "@/components/board/detail-parts";
import { BoardPermissionRequest } from "@/components/board/permission-request";
import { BoardReviewActions } from "@/components/board/review-actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/contexts/toast-context";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { Agent } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import { resolveProviderLabel } from "@/utils/provider-definitions";

type PendingAction = "stop" | "read" | "archive" | "track";

/** The linked task's number, then provider, model, thinking and mode, as chips under the title. */
export function BoardAgentChips({
  serverId,
  agent,
  taskNumber,
}: {
  serverId: string;
  agent: Agent;
  taskNumber: number | null;
}): ReactElement {
  const { entries } = useProvidersSnapshot(serverId);
  const model = agent.runtimeInfo?.model ?? agent.model;
  const thinking = agent.runtimeInfo?.thinkingOptionId ?? agent.thinkingOptionId ?? null;
  const modeId = agent.runtimeInfo?.modeId ?? agent.currentModeId;
  const mode = agent.availableModes.find((candidate) => candidate.id === modeId)?.label ?? modeId;
  const chips = [
    taskNumber !== null ? `T-${taskNumber}` : null,
    resolveProviderLabel(agent.provider, entries),
    model,
    thinking,
    mode,
  ].filter((chip): chip is string => typeof chip === "string" && chip.length > 0);
  return (
    <View style={styles.chips}>
      {chips.map((chip, index) => (
        // Two chips can share a label, such as a mode named like the model.
        // eslint-disable-next-line react/no-array-index-key
        <StatusBadge key={index} label={chip} size="xs" />
      ))}
    </View>
  );
}

/** Open, Stop, Mark read, Archive and Track as task, each with its own pending state. */
export function BoardAgentActions({ item }: { item: BoardAgentItem }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { serverId, agent, workspace } = item;
  const busy = agent.status === "running" || agent.status === "initializing";
  const canTrack = item.task === null && item.parent === null;

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
  const open = useCallback(() => {
    navigateToAgent({ serverId, agentId: agent.id, workspaceId: workspace.id });
  }, [agent.id, serverId, workspace.id]);
  const stop = useCallback(() => {
    void run("stop", () => stopBoardAgent(serverId, agent.id));
  }, [agent.id, run, serverId]);
  const markRead = useCallback(() => {
    void run("read", () => markBoardAgentRead(serverId, agent.id));
  }, [agent.id, run, serverId]);
  const archive = useCallback(() => {
    void run("archive", () => archiveBoardAgent(serverId, agent.id));
  }, [agent.id, run, serverId]);
  const track = useCallback(() => {
    void run("track", () => trackAgentAsTask({ serverId, agent, workspace }));
  }, [agent, run, serverId, workspace]);

  return (
    <View style={styles.actions}>
      <ActionButton icon={SquareArrowOutUpRight} label={t("board.detail.open")} onPress={open} />
      {busy ? (
        <ActionButton
          icon={Square}
          label={pending === "stop" ? t("board.detail.stopping") : t("board.detail.stop")}
          onPress={stop}
          pending={pending === "stop"}
          disabled={pending !== null}
          testID="board-detail-stop"
        />
      ) : null}
      {agent.requiresAttention ? (
        <ActionButton
          icon={CheckCheck}
          label={pending === "read" ? t("board.detail.markingRead") : t("board.detail.markRead")}
          onPress={markRead}
          pending={pending === "read"}
          disabled={pending !== null}
          testID="board-detail-mark-read"
        />
      ) : null}
      {canTrack ? (
        <ActionButton
          icon={ListPlus}
          label={pending === "track" ? t("board.detail.tracking") : t("board.detail.track")}
          onPress={track}
          pending={pending === "track"}
          disabled={pending !== null}
          testID="board-detail-track"
        />
      ) : null}
      <ActionButton
        icon={Archive}
        label={pending === "archive" ? t("board.detail.archiving") : t("board.detail.archive")}
        onPress={archive}
        pending={pending === "archive"}
        disabled={pending !== null}
        testID="board-detail-archive"
      />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  pending = false,
  disabled = false,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  testID?: string;
}): ReactElement {
  return (
    <Button
      size="sm"
      variant="outline"
      leftIcon={icon}
      onPress={onPress}
      loading={pending}
      disabled={disabled}
      testID={testID}
    >
      {label}
    </Button>
  );
}

export function BoardAgentDetailBody({
  item,
  onEditTask,
  showProperties = true,
}: {
  item: BoardAgentItem;
  onEditTask: (card: BoardCard) => void;
  /** False when the properties render in their own column. */
  showProperties?: boolean;
}): ReactElement {
  const { serverId, agent, workspace, task } = item;
  return (
    <>
      {item.bucket === "needs_input" ? (
        <BoardPermissionRequest serverId={serverId} workspaceId={workspace.id} />
      ) : null}
      {agent.lastError && item.bucket === "failed" ? (
        <Text style={styles.error} selectable>
          {agent.lastError}
        </Text>
      ) : null}
      {showProperties ? <BoardAgentProperties item={item} onEditTask={onEditTask} /> : null}
      {task ? <LinkedTask item={item} card={task} /> : null}
      <BoardDetailConversation serverId={serverId} agent={agent} />
      <AgentUsage agent={agent} />
      <Subagents item={item} />
    </>
  );
}

export function BoardAgentProperties({
  item,
  onEditTask,
}: {
  item: BoardAgentItem;
  onEditTask: (card: BoardCard) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { serverId, agent, workspace, project, task, parent } = item;
  const pullRequest = workspace.githubRuntime?.pullRequest ?? null;
  const branch = workspace.gitRuntime?.currentBranch ?? null;
  const labels = workspace.labels ?? [];
  const openPullRequest = useCallback(() => {
    if (pullRequest) void openExternalUrl(pullRequest.url);
  }, [pullRequest]);
  const editTask = useCallback(() => {
    if (task) onEditTask(task);
  }, [onEditTask, task]);
  const openParent = useCallback(() => {
    if (parent) navigateToAgent({ serverId, agentId: parent.id });
  }, [parent, serverId]);
  const pullRequestLabel = pullRequest
    ? [pullRequest.number !== undefined ? `#${pullRequest.number}` : null, pullRequest.title]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    <DetailSection title={t("board.detail.properties")}>
      {task ? (
        <DetailProperty
          label={t("board.detail.task")}
          value={`T-${task.task.number} ${task.task.title}`}
          onPress={editTask}
          testID="board-detail-linked-task"
        />
      ) : null}
      <DetailGoalProperty
        serverId={serverId}
        goalId={task?.task.goalId ?? null}
        ownerAgentId={agent.id}
      />
      {parent ? (
        <DetailProperty
          label={t("board.detail.parent")}
          value={parent.title ?? parent.id}
          onPress={openParent}
        />
      ) : null}
      {project ? (
        <DetailProperty
          label={t("board.detail.project")}
          value={project.projectCustomName ?? project.projectDisplayName}
        />
      ) : null}
      <DetailProperty
        label={t("board.detail.workspace")}
        value={workspace.title ?? workspace.name}
      />
      {branch ? <DetailProperty label={t("board.detail.branch")} value={branch} /> : null}
      <DetailProperty label={t("board.detail.directory")} value={agent.cwd} />
      {pullRequest && pullRequestLabel ? (
        <DetailProperty
          label={t("board.detail.pullRequest")}
          value={pullRequestLabel}
          onPress={openPullRequest}
        />
      ) : null}
      {labels.length > 0 ? (
        <DetailProperty label={t("board.detail.labels")} value={labels.join(", ")} />
      ) : null}
      <DetailProperty label={t("board.detail.host")} value={item.serverName} />
    </DetailSection>
  );
}

/** The Board task riding on this agent: its checklist, summary and review actions. */
function LinkedTask({ item, card }: { item: BoardAgentItem; card: BoardCard }): ReactElement {
  const { t } = useTranslation();
  const { task } = card;
  return (
    <>
      {task.acceptanceCriteria.length > 0 ? (
        <DetailSection title={t("board.plan.acceptanceCriteria")}>
          <DetailCriteria criteria={task.acceptanceCriteria} />
        </DetailSection>
      ) : null}
      {task.summary ? (
        <DetailMarkdown title={t("board.detail.summary")} text={task.summary} />
      ) : null}
      {item.column === "review" ? (
        <BoardReviewActions card={card} workspace={item.workspace} />
      ) : null}
    </>
  );
}

function AgentUsage({ agent }: { agent: Agent }): ReactElement | null {
  const { t, i18n } = useTranslation();
  const usage = agent.lastUsage;
  const cost = useMemo(
    () =>
      usage?.totalCostUsd !== undefined
        ? new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" }).format(
            usage.totalCostUsd,
          )
        : null,
    [i18n.language, usage?.totalCostUsd],
  );
  if (!usage) return null;
  const { contextWindowUsedTokens: used, contextWindowMaxTokens: max } = usage;
  const rows: { key: string; label: string; value: string }[] = [];
  if (used !== undefined && max !== undefined && max > 0) {
    rows.push({
      key: "context",
      label: t("board.detail.context"),
      value: t("board.detail.contextValue", {
        used: formatTokenCount(used),
        max: formatTokenCount(max),
        percent: Math.round((used / max) * 100),
      }),
    });
  }
  if (usage.inputTokens !== undefined) {
    rows.push({
      key: "input",
      label: t("board.detail.inputTokens"),
      value: formatTokenCount(usage.inputTokens),
    });
  }
  if (usage.cachedInputTokens !== undefined) {
    rows.push({
      key: "cached",
      label: t("board.detail.cachedTokens"),
      value: formatTokenCount(usage.cachedInputTokens),
    });
  }
  if (usage.outputTokens !== undefined) {
    rows.push({
      key: "output",
      label: t("board.detail.outputTokens"),
      value: formatTokenCount(usage.outputTokens),
    });
  }
  if (cost) rows.push({ key: "cost", label: t("board.detail.cost"), value: cost });
  if (rows.length === 0) return null;
  return (
    <DetailSection title={t("board.detail.usage")}>
      {rows.map((row) => (
        <DetailProperty key={row.key} label={row.label} value={row.value} />
      ))}
    </DetailSection>
  );
}

function Subagents({ item }: { item: BoardAgentItem }): ReactElement | null {
  const { t } = useTranslation();
  if (item.children.length === 0) return null;
  return (
    <DetailSection title={t("board.detail.subagents", { count: item.children.length })}>
      {item.children.map((child) => (
        <SubagentRow key={child.key} serverId={item.serverId} agent={child.agent} />
      ))}
    </DetailSection>
  );
}

function SubagentRow({ serverId, agent }: { serverId: string; agent: Agent }): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    navigateToAgent({ serverId, agentId: agent.id });
  }, [agent.id, serverId]);
  const dot = useMemo(
    () => (
      <AgentStatusDot
        status={agent.status}
        requiresAttention={agent.requiresAttention}
        attentionReason={agent.attentionReason}
        pendingPermissionCount={agent.pendingPermissions.length}
        showInactive
      />
    ),
    [agent.attentionReason, agent.pendingPermissions.length, agent.requiresAttention, agent.status],
  );
  return (
    <DetailListRow
      leading={dot}
      label={agent.title ?? t("board.detail.untitledAgent")}
      onPress={open}
      testID={`board-detail-subagent-${agent.id}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
