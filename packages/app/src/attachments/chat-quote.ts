import type {
  ArtifactQuoteContextAttachment,
  ChatQuoteContextAttachment,
} from "@/attachments/types";
import { generateAttachmentId } from "@/attachments/utils";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";

export interface ChatQuoteInput {
  serverId: string;
  agentId: string;
  messageId: string;
  text: string;
  comment?: string;
}

export function buildChatQuoteAttachment(input: ChatQuoteInput): ChatQuoteContextAttachment {
  return {
    kind: "chat_quote",
    id: generateAttachmentId(),
    selectedText: input.text,
    ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
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

export function withChatQuoteComment<
  T extends ChatQuoteContextAttachment | ArtifactQuoteContextAttachment,
>(attachment: T, comment: string): T {
  const { comment: _previous, ...rest } = attachment;
  const trimmed = comment.trim();
  return (trimmed ? { ...rest, comment: trimmed } : rest) as T;
}
