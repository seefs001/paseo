import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { generateAttachmentId } from "@/attachments/utils";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";

export interface ChatQuoteInput {
  serverId: string;
  agentId: string;
  messageId: string;
  text: string;
}

export function buildChatQuoteAttachment(input: ChatQuoteInput): ChatQuoteContextAttachment {
  return {
    kind: "chat_quote",
    id: generateAttachmentId(),
    selectedText: input.text,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      messageId: input.messageId,
    },
  };
}

export function addChatQuoteToAgent(input: ChatQuoteInput): void {
  if (!input.text.trim()) return;
  const draftKey = buildDraftStoreKey(input);
  void useDraftStore.getState().attachChatQuote({
    draftKey,
    attachment: buildChatQuoteAttachment(input),
  });
}

export function getChatQuoteSourceLabel(source: ChatQuoteContextAttachment["source"]): string {
  return `${source.serverId} / ${source.agentId} / ${source.messageId}`;
}
