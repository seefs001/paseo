import type { WorkspaceStateBucket } from "@getpaseo/protocol/messages";
import { Bot, GitBranch } from "lucide-react-native";
import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardAgentChild } from "@/board/items";
import { BoardAgentStateDot } from "@/components/board/agent-state-indicator";
import { ContextWindowMeter } from "@/components/context-window-meter";
import { useProviderIcon } from "@/components/provider-icons";
import { DensityIcon } from "@/components/ui/density-icon";
import { resolveAgentModelSelection } from "@/composer/agent-controls/utils";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { Agent } from "@/stores/session-store";

/** Provider icon with the model, and the thinking option, named as the composer names them. */
export function BoardModelPills({
  serverId,
  agent,
}: {
  serverId: string;
  agent: Agent;
}): ReactElement {
  const ProviderIcon = useProviderIcon(agent.provider, serverId);
  const { entries } = useProvidersSnapshot(serverId);
  const models = entries?.find((entry) => entry.provider === agent.provider)?.models ?? null;
  const runtimeModelId = agent.runtimeInfo?.model ?? null;
  const runtimeThinkingOptionId = agent.runtimeInfo?.thinkingOptionId ?? null;
  const { model, thinking } = useMemo(() => {
    const hasModel = Boolean(runtimeModelId?.trim() || agent.model?.trim());
    if (!hasModel) return { model: null, thinking: null };
    const selection = resolveAgentModelSelection({
      models,
      runtimeModelId,
      configuredModelId: agent.model,
      runtimeThinkingOptionId,
      explicitThinkingOptionId: agent.thinkingOptionId,
    });
    return {
      model: selection.displayModel,
      thinking: selection.selectedThinkingId ? selection.displayThinking : null,
    };
  }, [agent.model, agent.thinkingOptionId, models, runtimeModelId, runtimeThinkingOptionId]);
  return (
    <>
      <View style={styles.pill}>
        <DensityIcon icon={ProviderIcon} size="sm" color="foregroundMuted" />
        <Text style={styles.pillText} numberOfLines={1}>
          {model ?? agent.provider}
        </Text>
      </View>
      {thinking ? (
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {thinking}
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function BoardBranchPill({ branch }: { branch: string }): ReactElement {
  return (
    <View style={styles.pill}>
      <DensityIcon icon={GitBranch} size="sm" color="foregroundMuted" />
      <Text style={styles.pillText} numberOfLines={1}>
        {branch}
      </Text>
    </View>
  );
}

const SUBAGENT_BUCKET_ORDER: readonly WorkspaceStateBucket[] = [
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
];

/** Subagents counted by state, so a parent shows how its dispatched work is going. */
export function BoardSubagentPill({
  agentId,
  childAgents,
}: {
  agentId: string;
  childAgents: readonly BoardAgentChild[];
}): ReactElement | null {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    const byBucket = new Map<WorkspaceStateBucket, number>();
    for (const child of childAgents) {
      byBucket.set(child.bucket, (byBucket.get(child.bucket) ?? 0) + 1);
    }
    return SUBAGENT_BUCKET_ORDER.flatMap((bucket) => {
      const count = byBucket.get(bucket) ?? 0;
      return count > 0 ? [{ bucket, count }] : [];
    });
  }, [childAgents]);
  if (childAgents.length === 0) return null;
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel={t("board.agent.subagents", { count: childAgents.length })}
      testID={`board-agent-subagents-${agentId}`}
    >
      <DensityIcon icon={Bot} size="sm" color="foregroundMuted" />
      {counts.map(({ bucket, count }) => (
        <View key={bucket} style={styles.subagentCount}>
          <BoardAgentStateDot bucket={bucket} />
          <Text style={styles.pillText}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

export function BoardAgentContextMeter({
  serverId,
  agent,
}: {
  serverId: string;
  agent: Agent;
}): ReactElement | null {
  const usage = agent.lastUsage;
  const maxTokens = usage?.contextWindowMaxTokens ?? null;
  const usedTokens = usage?.contextWindowUsedTokens ?? null;
  if (maxTokens === null || usedTokens === null) return null;
  return (
    <ContextWindowMeter
      serverId={serverId}
      agentId={agent.id}
      maxTokens={maxTokens}
      usedTokens={usedTokens}
      totalCostUsd={usage?.totalCostUsd ?? null}
      showPercentage
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  pillText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  subagentCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
}));
