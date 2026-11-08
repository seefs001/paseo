import type {
  ArtifactQuoteContextAttachment,
  ChatQuoteContextAttachment,
} from "@/attachments/types";

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

const ARTIFACT_QUOTE_HEADER =
  "Quoted content (captured when selected, not a historical-version link):";
const COMMENT_SEPARATOR = `\n\n${COMMENT_HEADER}\n`;

/** The text the agent receives for an artifact excerpt: identity, the excerpt, then the comment. */
export function formatArtifactQuoteForAgent(attachment: ArtifactQuoteContextAttachment): string {
  const { source } = attachment;
  const comment = attachment.comment?.trim();
  const body = [
    `Artifact: ${attachment.title}`,
    `Host: ${source.serverId}`,
    `Workspace: ${source.workspaceId}`,
    `Artifact ID: ${source.artifactId}`,
    `Observed revision: ${source.revision}`,
    ARTIFACT_QUOTE_HEADER,
    attachment.selectedText,
  ].join("\n");
  return comment ? `${body}${COMMENT_SEPARATOR}${comment}` : body;
}

export interface SentArtifactQuote {
  title: string;
  selectedText: string;
  comment?: string;
  source: { serverId: string; artifactId: string; revision: number } | null;
}

/** Reads back a sent artifact excerpt; an unrecognized body is shown whole without a source. */
export function parseSentArtifactQuote(text: string, title?: string | null): SentArtifactQuote {
  const lines = text.split("\n");
  const field = (index: number, label: string) => {
    const line = lines[index] ?? "";
    return line.startsWith(`${label}: `) ? line.slice(label.length + 2) : null;
  };
  const artifactTitle = field(0, "Artifact");
  const serverId = field(1, "Host");
  const artifactId = field(3, "Artifact ID");
  const revision = Number(field(4, "Observed revision"));
  if (
    artifactTitle === null ||
    serverId === null ||
    artifactId === null ||
    !Number.isInteger(revision) ||
    lines[5] !== ARTIFACT_QUOTE_HEADER
  ) {
    return { title: title ?? "", selectedText: text, source: null };
  }
  const rest = lines.slice(6).join("\n");
  const commentAt = rest.lastIndexOf(COMMENT_SEPARATOR);
  const comment = commentAt >= 0 ? rest.slice(commentAt + COMMENT_SEPARATOR.length).trim() : "";
  return {
    title: artifactTitle,
    selectedText: commentAt >= 0 ? rest.slice(0, commentAt) : rest,
    ...(comment ? { comment } : {}),
    source: { serverId, artifactId, revision },
  };
}
