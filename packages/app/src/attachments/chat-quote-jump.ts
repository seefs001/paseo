import { create } from "zustand";
import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { navigateToAgent } from "@/utils/navigate-to-agent";

type ChatQuoteSource = ChatQuoteContextAttachment["source"];

interface ChatQuoteJumpState {
  /** The message the source conversation's stream scrolls to once it is showing. */
  target: (ChatQuoteSource & { requestId: number }) | null;
}

const useChatQuoteJumpStore = create<ChatQuoteJumpState>(() => ({ target: null }));
let nextRequestId = 0;

/**
 * Opens the conversation a quote came from and asks its stream to scroll to the quoted
 * message. The stream view consumes the request; see `useChatQuoteJump` in agent-stream.
 */
export function openChatQuoteSource(source: ChatQuoteSource): void {
  nextRequestId += 1;
  useChatQuoteJumpStore.setState({ target: { ...source, requestId: nextRequestId } });
  navigateToAgent({ serverId: source.serverId, agentId: source.agentId });
}

export function useChatQuoteJumpTarget(serverId: string, agentId: string) {
  return useChatQuoteJumpStore((state) =>
    state.target?.serverId === serverId && state.target.agentId === agentId ? state.target : null,
  );
}

export function clearChatQuoteJump(requestId: number): void {
  useChatQuoteJumpStore.setState((state) =>
    state.target?.requestId === requestId ? { target: null } : state,
  );
}
