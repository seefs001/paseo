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
import { i18n } from "@/i18n/i18next";
import { formatChatQuoteForAgent } from "@/attachments/chat-quote-format";
import {
  getSessionResourceClient,
  ResourceReferenceError,
  resolveResourceLinks,
} from "@/composer/profile-reference/resolve";
import {
  encodeProfileReferences,
  roleReferenceLabel,
  findTextReferenceLinks,
  isTextReference,
  isValidTextReference,
  textReferenceToAgentAttachment,
} from "@/composer/profile-reference/model";

export type ComposerAttachmentSubmitFormat = "forge" | "legacy-github";

interface SplitComposerAttachmentsOptions {
  format?: ComposerAttachmentSubmitFormat;
  /** Host the message is sent to; a role reference from another host is marked unusable. */
  serverId?: string;
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
      agentAttachments.push(textReferenceToAgentAttachment(attachment, options.serverId));
      continue;
    }

    if (attachment.kind === "artifact_quote") {
      const { source } = attachment;
      agentAttachments.push({
        type: "text",
        mimeType: "text/plain",
        title: attachment.title,
        contextKind: "artifact_quote",
        text: [
          `Artifact: ${attachment.title}`,
          `Host: ${source.serverId}`,
          `Workspace: ${source.workspaceId}`,
          `Artifact ID: ${source.artifactId}`,
          `Observed revision: ${source.revision}`,
          "Quoted content (captured when selected, not a historical-version link):",
          attachment.selectedText,
        ].join("\n"),
      });
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
  const comment = attachment.comment?.trim();
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_quote",
    title: `“${attachment.selectedText.replace(/\s+/g, " ").trim()}”`,
    text: formatChatQuoteForAgent({ ...attachment, ...(comment ? { comment } : {}) }),
  };
}

interface PrepareComposerMessageInput extends SplitComposerAttachmentsOptions {
  text: string;
  attachments: readonly ComposerAttachment[];
  /** Cards already read for the short resource links in `text`, in text order. */
  resourceCards?: readonly AgentAttachment[];
}

export function prepareComposerMessageForSubmit(input: PrepareComposerMessageInput) {
  // Drafts saved before references were written as links still bind them by range; encode
  // those first. The sent text is then the only source of references, so a link that was
  // pasted or recalled gets the same resource card as one picked from autocomplete.
  const text = encodeProfileReferences({
    text: input.text,
    attachments: input.attachments.filter(
      (attachment) =>
        isTextReference(attachment) &&
        isValidTextReference({ text: input.text, reference: attachment }),
    ),
  });
  const attachments = [
    ...findTextReferenceLinks(text),
    ...input.attachments.filter((attachment) => !isTextReference(attachment)),
  ];
  const split = splitComposerAttachmentsForSubmit(attachments, {
    format: input.format,
    serverId: input.serverId,
  });
  return {
    text,
    images: split.images,
    attachments: [...(input.resourceCards ?? []), ...split.attachments],
  };
}

/**
 * Prepares a message for sending: reads the current resource behind every short
 * `paseo://HOST/KIND/ID` link from its host, then builds the wire payload. Throws a
 * `ResourceReferenceError` before anything is sent when a resource cannot be read, so the
 * caller keeps the draft.
 */
export async function prepareComposerMessageForSend(
  input: Omit<PrepareComposerMessageInput, "resourceCards">,
) {
  const encoded = encodeProfileReferences({
    text: input.text,
    attachments: input.attachments.filter(
      (attachment) =>
        isTextReference(attachment) &&
        isValidTextReference({ text: input.text, reference: attachment }),
    ),
  });
  assertLegacyRolesOnTargetHost(encoded, input.serverId);
  const resourceCards = await resolveResourceLinks({
    text: encoded,
    targetServerId: input.serverId,
    getClient: getSessionResourceClient,
  });
  return prepareComposerMessageForSubmit({ ...input, resourceCards });
}

/** A role from another host cannot create agents here; same rule as short role links. */
function assertLegacyRolesOnTargetHost(text: string, serverId: string | undefined): void {
  if (!serverId) return;
  for (const reference of findTextReferenceLinks(text)) {
    if (reference.kind === "role_reference" && reference.serverId !== serverId) {
      throw new ResourceReferenceError(
        i18n.t("composer.errors.referenceRoleOtherHost", {
          label: roleReferenceLabel(reference.role),
          serverId: reference.serverId,
          error: "",
        }),
      );
    }
  }
}
