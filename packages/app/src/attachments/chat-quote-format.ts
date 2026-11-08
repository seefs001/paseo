import type { ChatQuoteContextAttachment } from "@/attachments/types";

const QUOTE_HEADER = "Quoted conversation excerpt:";
const COMMENT_HEADER = "User comment on this excerpt:";

/** The text the agent receives: source identity, the excerpt, then the user's comment. */
export function formatChatQuoteForAgent(attachment: ChatQuoteContextAttachment): string {
  const comment = attachment.comment?.trim();
  return [
    QUOTE_HEADER,
    `Source host: ${attachment.source.serverId}`,
    `Source agent: ${attachment.source.agentId}`,
    `Source message: ${attachment.source.messageId}`,
    "",
    ...attachment.selectedText.split("\n").map((line) => `> ${line}`),
    ...(comment ? ["", COMMENT_HEADER, comment] : []),
  ].join("\n");
}

export interface SentChatQuote {
  selectedText: string;
  comment?: string;
  source: ChatQuoteContextAttachment["source"] | null;
}

/**
 * Reads back a sent quote. Only called on attachments tagged `contextKind: "chat_quote"`, so
 * typed message text is never parsed. A body this format does not recognize is shown whole.
 */
export function parseSentChatQuote(text: string): SentChatQuote {
  const lines = text.split("\n");
  const field = (index: number, label: string) => {
    const line = lines[index] ?? "";
    return line.startsWith(`${label}: `) ? line.slice(label.length + 2) : null;
  };
  const serverId = field(1, "Source host");
  const agentId = field(2, "Source agent");
  const messageId = field(3, "Source message");
  if (lines[0] !== QUOTE_HEADER || serverId === null || agentId === null || messageId === null) {
    return { selectedText: text, source: null };
  }
  const quoted: string[] = [];
  let index = 5;
  for (let line = lines[index]; line?.startsWith("> "); line = lines[index]) {
    quoted.push(line.slice(2));
    index += 1;
  }
  const rest = lines.slice(index);
  const comment =
    rest[0] === "" && rest[1] === COMMENT_HEADER ? rest.slice(2).join("\n").trim() : "";
  return {
    selectedText: quoted.join("\n"),
    ...(comment ? { comment } : {}),
    source: { serverId, agentId, messageId },
  };
}
