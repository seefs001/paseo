import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { addChatQuoteToAgent } from "@/attachments/chat-quote";
import type { ToastApi } from "@/components/toast-host";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostFeature } from "@/runtime/host-features";
import { generateDraftId } from "@/stores/draft-keys";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { getStreamItemMessageId, type AssistantMessageItem, type StreamItem } from "@/types/stream";
import { toErrorMessage } from "@/utils/error-messages";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";
import { openWorkspaceTargetAtLocation } from "@/workspace-tabs/open-beside";
import type { ChatSelectionActions, ChatTextSelection } from "./types";

interface ChatSelectionInput {
  serverId: string;
  agentId: string;
  agent: AgentScreenAgent;
  items: readonly StreamItem[];
  head: readonly StreamItem[] | undefined;
  readOnly: boolean;
  toast?: ToastApi | null;
}

interface SideConversationSetupInput {
  agent: AgentScreenAgent;
  provider: string;
  source: AssistantMessageItem;
  selectedText: string;
}

function buildSideConversationSetup(
  input: SideConversationSetupInput,
): WorkspaceDraftTabSetup | null {
  const { agent, source } = input;
  let sourceMessageId = source.messageId;
  if (!sourceMessageId && source.timelineCursor) {
    sourceMessageId = `timeline:${source.timelineCursor.epoch}:${source.timelineCursor.seq}`;
  }
  if (!sourceMessageId) return null;

  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) featureValues[feature.id] = feature.value;
  return {
    provider: input.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
    metadata: {
      sideConversation: {
        sourceAgentId: agent.id,
        sourceMessageId,
        sourceCursor: source.timelineCursor,
        selectedText: input.selectedText,
      },
    },
  };
}

function sourceAgentTabId(workspaceKey: string, agentId: string): string | undefined {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  if (!layout) return undefined;
  return collectAllTabs(layout.root).find(
    (tab) => tab.target.kind === "agent" && tab.target.agentId === agentId,
  )?.tabId;
}

export function useChatSelectionActions(
  input: ChatSelectionInput,
): ChatSelectionActions | undefined {
  const { t } = useTranslation();
  const supportsSideConversation = useHostFeature(input.serverId, "agentSideConversation");

  const addToChat = useStableEvent((selection: ChatTextSelection) => {
    if (input.readOnly) return;
    addChatQuoteToAgent({
      serverId: input.serverId,
      agentId: input.agentId,
      messageId: selection.messageId,
      text: selection.text,
    });
  });

  const askInSideConversation = useStableEvent((selection: ChatTextSelection) => {
    if (input.readOnly) return;
    if (!supportsSideConversation) {
      input.toast?.error(t("message.selection.updateHost"));
      return;
    }
    const { agent } = input;
    if (!agent.provider || !agent.workspaceId) {
      input.toast?.error(t("message.selection.unavailable"));
      return;
    }
    const source = [...input.items, ...(input.head ?? [])].find(
      (item) => getStreamItemMessageId(item) === selection.messageId,
    );
    if (!source || source.kind !== "assistant_message") {
      input.toast?.error(t("message.selection.sourceUnavailable"));
      return;
    }
    const setup = buildSideConversationSetup({
      agent,
      provider: agent.provider,
      source,
      selectedText: selection.text,
    });
    if (!setup) {
      input.toast?.error(t("message.selection.sourceUnavailable"));
      return;
    }
    const workspaceKey = buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId: agent.workspaceId,
    });
    if (!workspaceKey) return;
    try {
      const tabId = openWorkspaceTargetAtLocation({
        workspaceKey,
        target: { kind: "draft", draftId: generateDraftId(), setup },
        location: "side",
        parentTabId: sourceAgentTabId(workspaceKey, input.agentId),
      });
      if (!tabId) input.toast?.error(t("message.selection.unavailable"));
    } catch (error) {
      input.toast?.error(toErrorMessage(error));
    }
  });

  return useMemo(
    () => (input.readOnly ? undefined : { addToChat, askInSideConversation }),
    [input.readOnly, addToChat, askInSideConversation],
  );
}
