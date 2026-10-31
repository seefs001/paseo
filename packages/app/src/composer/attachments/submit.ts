import type { ChatQuoteContextAttachment, ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment } from "@/composer/types";
import {
  isWorkspaceAttachment,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  buildForgeAttachmentFromSearchItem,
  buildLegacyGitHubAttachmentFromSearchItem,
} from "@/utils/review-attachments";
import { workspaceFileAttachmentToAgentAttachment } from "@/attachments/workspace-file";
import { pluginResourceAttachmentToAgentAttachment } from "@/plugins/attachments";
import {
  encodeProfileReferences,
  isTextReference,
  isValidTextReference,
  textReferenceToAgentAttachment,
} from "@/composer/profile-reference/model";

export type ComposerAttachmentSubmitFormat = "forge" | "legacy-github";

interface SplitComposerAttachmentsOptions {
  format?: ComposerAttachmentSubmitFormat;
}

export function resolveComposerAttachmentSubmitFormat(input: {
  supportsForgeAttachments?: boolean;
}): ComposerAttachmentSubmitFormat {
  // COMPAT(githubAttachmentKinds): emit legacy GitHub attachments for daemons
  // predating forge-neutral attachments. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  return input.supportsForgeAttachments === false ? "legacy-github" : "forge";
}

export function splitComposerAttachmentsForSubmit(
  attachments: ComposerAttachment[],
  options: SplitComposerAttachmentsOptions = {},
): {
  images: ImageAttachment[];
  attachments: AgentAttachment[];
} {
  const images: ImageAttachment[] = [];
  const agentAttachments: AgentAttachment[] = [];
  // COMPAT(githubAttachmentKinds): emit legacy GitHub attachments for daemons
  // predating forge-neutral attachments. Remove after 2027-01-17 once the
  // supported daemon floor is >= v0.2.0.
  const buildSearchAttachment =
    options.format === "legacy-github"
      ? buildLegacyGitHubAttachmentFromSearchItem
      : buildForgeAttachmentFromSearchItem;

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      images.push(attachment.metadata);
      continue;
    }

    if (isTextReference(attachment)) {
      agentAttachments.push(textReferenceToAgentAttachment(attachment));
      continue;
    }

    if (attachment.kind === "chat_quote") {
      agentAttachments.push(chatQuoteToAgentAttachment(attachment));
      continue;
    }

    if (attachment.kind === "file") {
      agentAttachments.push(attachment.attachment);
      continue;
    }

    if (attachment.kind === "workspace_file") {
      agentAttachments.push(workspaceFileAttachmentToAgentAttachment(attachment));
      continue;
    }

    if (attachment.kind === "plugin_resource") {
      agentAttachments.push(pluginResourceAttachmentToAgentAttachment(attachment));
      continue;
    }

    if (isWorkspaceAttachment(attachment)) {
      if (attachment.kind === "browser_element" && attachment.attachment.screenshot) {
        images.push(attachment.attachment.screenshot);
      }
      const workspaceAttachment = workspaceAttachmentToSubmitAttachment(attachment);
      if (workspaceAttachment) {
        agentAttachments.push(workspaceAttachment);
      }
      continue;
    }

    const reviewAttachment = buildSearchAttachment(attachment.item);
    if (reviewAttachment) {
      agentAttachments.push(reviewAttachment);
    }
  }

  return {
    images,
    attachments: agentAttachments,
  };
}

function chatQuoteToAgentAttachment(
  attachment: ChatQuoteContextAttachment,
): Extract<AgentAttachment, { type: "text" }> {
  const quotedLines = attachment.selectedText.split("\n").map((line) => `> ${line}`);
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_quote",
    title: `“${attachment.selectedText.replace(/\s+/g, " ").trim()}”`,
    text: [
      "Quoted conversation excerpt:",
      `Source host: ${attachment.source.serverId}`,
      `Source agent: ${attachment.source.agentId}`,
      `Source message: ${attachment.source.messageId}`,
      "",
      ...quotedLines,
    ].join("\n"),
  };
}

interface PrepareComposerMessageInput extends SplitComposerAttachmentsOptions {
  text: string;
  attachments: readonly ComposerAttachment[];
}

export function prepareComposerMessageForSubmit(input: PrepareComposerMessageInput) {
  const attachments = input.attachments.filter(
    (attachment) =>
      !isTextReference(attachment) ||
      isValidTextReference({ text: input.text, reference: attachment }),
  );
  return {
    text: encodeProfileReferences({ text: input.text, attachments }),
    ...splitComposerAttachmentsForSubmit(attachments, { format: input.format }),
  };
}
