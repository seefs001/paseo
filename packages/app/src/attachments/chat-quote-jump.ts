import { create } from "zustand";
import type { ChatQuoteContextAttachment } from "@/attachments/types";
import { navigateToAgent } from "@/utils/navigate-to-agent";

type ChatQuoteSource = ChatQuoteContextAttachment["source"];

/**
 * A message is found by its stream message id. A tool call is found by its call id instead,
 * because its stream item id also carries the turn.
 */
type ChatQuoteJumpRequest = Pick<ChatQuoteSource, "serverId" | "agentId"> &
  ({ messageId: string; callId?: undefined } | { callId: string; messageId?: string });

interface ChatQuoteJumpState {
  /** The message the source conversation's stream scrolls to once it is showing. */
  target: (ChatQuoteJumpRequest & { requestId: number }) | null;
  /** The stream row a jump landed on; it shows a short highlight while this is set. */
  landed: { serverId: string; agentId: string; itemId: string; requestId: number } | null;
}

const useChatQuoteJumpStore = create<ChatQuoteJumpState>(() => ({ target: null, landed: null }));
let nextRequestId = 0;

/**
 * Opens the conversation a quote came from and asks its stream to scroll to the quoted
 * message. The stream view consumes the request; see `useChatQuoteJump` in agent-stream.
 */
export function openChatQuoteSource(source: ChatQuoteJumpRequest): void {
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

/** Marks the row a jump landed on. A repeated jump to the same row gets a new request id. */
export function markChatQuoteJumpLanded(input: {
  serverId: string;
  agentId: string;
  itemId: string;
  requestId: number;
}): void {
  useChatQuoteJumpStore.setState({ landed: input });
}

/** The request id of the highlight to show on this row, or null. */
export function useChatQuoteJumpLanded(
  serverId: string,
  agentId: string,
  itemId: string,
): number | null {
  return useChatQuoteJumpStore((state) => {
    const landed = state.landed;
    return landed?.serverId === serverId && landed.agentId === agentId && landed.itemId === itemId
      ? landed.requestId
      : null;
  });
}

export function clearChatQuoteJumpLanded(requestId: number): void {
  useChatQuoteJumpStore.setState((state) =>
    state.landed?.requestId === requestId ? { landed: null } : state,
  );
}
