import {
  AgentProfileSchema,
  AgentRoleSnapshotSchema,
  type AgentAttachment,
  type AgentProfile,
  type AgentRole,
} from "@getpaseo/protocol/messages";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import {
  buildAgentProfileAddressCard,
  buildAgentRoleAddressCard,
  buildAgentSessionAddressCard,
} from "@/utils/session-mention-autocomplete";
import { z } from "zod";
import { isInlineQuote, isValidInlineQuote } from "@/attachments/inline-quote";

export const ProfileReferenceSchema = z.object({
  kind: z.literal("profile_reference"),
  id: z.string(),
  serverId: z.string(),
  profile: AgentProfileSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type ProfileReference = z.infer<typeof ProfileReferenceSchema>;

export const SessionReferenceSchema = z.object({
  kind: z.literal("session_reference"),
  id: z.string(),
  serverId: z.string(),
  agentId: z.string(),
  title: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  cwd: z.string(),
  workspaceId: z.string().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type SessionReference = z.infer<typeof SessionReferenceSchema>;

/** What a `%` reference keeps of a role: enough to name it and to address it in create_agent. */
const RoleReferenceSnapshotSchema = AgentRoleSnapshotSchema.extend({
  description: z.string().optional(),
  defaultProfileId: z.string().optional(),
});
export type RoleReferenceSnapshot = z.infer<typeof RoleReferenceSnapshotSchema>;

export const RoleReferenceSchema = z.object({
  kind: z.literal("role_reference"),
  id: z.string(),
  serverId: z.string(),
  role: RoleReferenceSnapshotSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type RoleReference = z.infer<typeof RoleReferenceSchema>;
export type TextReference = ProfileReference | SessionReference | RoleReference;

const ProfileLinkPayloadSchema = z.object({ serverId: z.string(), profile: AgentProfileSchema });
const SessionLinkPayloadSchema = SessionReferenceSchema.omit({
  kind: true,
  id: true,
  start: true,
  end: true,
});
const RoleLinkPayloadSchema = z.object({ serverId: z.string(), role: RoleReferenceSnapshotSchema });
const TEXT_REFERENCE_LINK = /\[((?:\\.|[^\]\\])*)\]\(paseo-(profile|session|role):([^\s)]+)\)/g;

/** Kinds a short `paseo://HOST/KIND/ID` resource link can address. */
export type ResourceLinkKind = "profile" | "role" | "session";

/**
 * A short resource link: only the owning host, the kind and the stable id. The label is display
 * text; Paseo reads the current resource from the host when the link is sent or opened.
 */
export interface ResourceLinkReference {
  kind: "resource_link";
  resource: ResourceLinkKind;
  serverId: string;
  resourceId: string;
  label: string;
  /** The link exactly as written, used when it is copied. */
  markdown: string;
  start: number;
  end: number;
}

/** A reference found in text: a legacy snapshot link or a short resource link. */
export type InlineReference = TextReference | ResourceLinkReference;

const RESOURCE_LINK =
  /\[((?:\\.|[^\]\\])*)\]\(paseo:\/\/([^\s/()]+)\/(profile|role|session)\/([^\s/()]+)\)/g;

function encodeLinkSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function decodeLinkSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/** `[label](paseo://HOST/KIND/ID)`, with the host and id percent-encoded. */
export function resourceLinkMarkdown(input: {
  resource: ResourceLinkKind;
  serverId: string;
  resourceId: string;
  label: string;
}): string {
  const label = input.label.replace(/[\\[\]]/g, "\\$&");
  return `[${label}](paseo://${encodeLinkSegment(input.serverId)}/${input.resource}/${encodeLinkSegment(input.resourceId)})`;
}

/** Short resource links in `text`, with `start`/`end` spanning the whole link. */
export function findResourceLinks(text: string): ResourceLinkReference[] {
  if (!text.includes("](paseo://")) return [];
  const links: ResourceLinkReference[] = [];
  for (const match of text.matchAll(RESOURCE_LINK)) {
    const resource = match[3] as ResourceLinkKind;
    const label = match[1].replace(/\\([\\[\]])/g, "$1");
    const serverId = decodeLinkSegment(match[2]);
    const resourceId = decodeLinkSegment(match[4]);
    if (!serverId || !resourceId) continue;
    // The host, kind and id are the identity; the label is display text the user may edit.
    if (label.trim().length === 0) continue;
    links.push({
      kind: "resource_link",
      resource,
      serverId,
      resourceId,
      label,
      markdown: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return links;
}

export interface ProfileReferenceRange {
  start: number;
  end: number;
  /** Quotes paint as quoted text; other ranges are references. */
  style?: "quote";
}

/** Attachments bound to a range of the draft text, which edits must move or drop. */
export function isRangedAttachment(attachment: { kind: string }): boolean {
  return isTextReference(attachment) || isInlineQuote(attachment);
}

interface ReferenceTextInput<T extends ComposerAttachment> {
  text: string;
  attachments: readonly T[];
}

interface ReferenceEditInput<T extends ComposerAttachment> extends ReferenceTextInput<T> {
  previousText: string;
  selectionBefore?: ProfileReferenceRange;
}

export interface ProfileReferenceDraft {
  text: string;
  references: TextReference[];
}

export interface SessionReferenceSource {
  serverId: string;
  agentId: string;
  title: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
}

export function profileReferenceLabel(profile: Pick<AgentProfile, "name" | "provider">): string {
  return `#${profile.name.trim() || profile.provider}`;
}

export function sessionReferenceLabel(
  session: Pick<SessionReference, "title" | "agentId">,
): string {
  const title = session.title.trim().replace(/\s+/g, " ") || session.agentId.slice(0, 7);
  return `@${title}`;
}

export function roleReferenceLabel(role: Pick<AgentRole, "name" | "id">): string {
  return `%${role.name.trim() || role.id}`;
}

export function isTextReference(attachment: { kind: string }): attachment is TextReference {
  return (
    attachment.kind === "profile_reference" ||
    attachment.kind === "session_reference" ||
    attachment.kind === "role_reference"
  );
}

export function textReferenceLabel(reference: TextReference): string {
  switch (reference.kind) {
    case "profile_reference":
      return profileReferenceLabel(reference.profile);
    case "session_reference":
      return sessionReferenceLabel(reference);
    case "role_reference":
      return roleReferenceLabel(reference.role);
  }
}

export function isValidProfileReference(input: {
  text: string;
  reference: ProfileReference;
}): boolean {
  return isValidTextReference(input);
}

export function isValidTextReference(input: { text: string; reference: TextReference }): boolean {
  const { text, reference } = input;
  return (
    reference.start >= 0 &&
    reference.end > reference.start &&
    reference.end <= text.length &&
    text.slice(reference.start, reference.end) === textReferenceLabel(reference)
  );
}

/** A press index sits on a reference, including the caret just after its last character. */
export function textReferenceContainsIndex(
  reference: ProfileReferenceRange,
  index: number,
): boolean {
  return index >= reference.start && index <= reference.end;
}

export function getProfileReferenceHighlights<T extends ComposerAttachment>(
  input: ReferenceTextInput<T>,
): ProfileReferenceRange[] {
  const quotes = input.attachments.flatMap((attachment): ProfileReferenceRange[] =>
    isInlineQuote(attachment) && isValidInlineQuote(input.text, attachment)
      ? [{ start: attachment.start, end: attachment.end, style: "quote" }]
      : [],
  );
  return [
    ...validReferences(input).map(({ start, end }) => ({ start, end })),
    ...findTextReferenceLinks(input.text).map(({ start, end }) => ({ start, end })),
    ...findResourceLinks(input.text).map(({ start, end }) => ({ start, end })),
    ...quotes,
  ].sort((left, right) => left.start - right.start);
}

function validReferences<T extends ComposerAttachment>(
  input: ReferenceTextInput<T>,
): TextReference[] {
  const references = input.attachments.filter(
    (attachment): attachment is T & TextReference =>
      isTextReference(attachment) &&
      isValidTextReference({ text: input.text, reference: attachment }),
  );
  references.sort((left, right) => left.start - right.start);
  let end = 0;
  return references.filter((reference) => {
    if (reference.start < end) return false;
    end = reference.end;
    return true;
  });
}

function textChange(previousText: string, text: string, selectionBefore?: ProfileReferenceRange) {
  if (selectionBefore) {
    const delta = text.length - previousText.length;
    const ranges = [selectionBefore];
    if (selectionBefore.start === selectionBefore.end && delta < 0) {
      ranges.push(
        { start: selectionBefore.start + delta, end: selectionBefore.end },
        { start: selectionBefore.start, end: selectionBefore.end - delta },
      );
    }
    for (const range of ranges) {
      const end = range.end + delta;
      const validBounds =
        range.start >= 0 && end >= range.start && range.end <= previousText.length;
      const matchesPrefix = previousText.slice(0, range.start) === text.slice(0, range.start);
      const matchesSuffix = previousText.slice(range.end) === text.slice(end);
      if (validBounds && matchesPrefix && matchesSuffix) {
        return { start: range.start, previousEnd: range.end, end };
      }
    }
  }
  let start = 0;
  const length = Math.min(previousText.length, text.length);
  while (start < length && previousText[start] === text[start]) start += 1;
  let previousEnd = previousText.length;
  let end = text.length;
  while (previousEnd > start && end > start && previousText[previousEnd - 1] === text[end - 1]) {
    previousEnd -= 1;
    end -= 1;
  }
  return { start, previousEnd, end };
}

export function updateProfileReferences<T extends ComposerAttachment>(
  input: ReferenceEditInput<T>,
): T[] {
  const change = textChange(input.previousText, input.text, input.selectionBefore);
  const delta = input.text.length - input.previousText.length;
  const isTrim = input.text !== input.previousText && input.text === input.previousText.trim();
  const trimmedPrefix = input.previousText.length - input.previousText.trimStart().length;
  return input.attachments.flatMap((attachment) => {
    if (isInlineQuote(attachment)) {
      if (!isValidInlineQuote(input.previousText, attachment)) return [];
    } else if (!isTextReference(attachment)) {
      return [attachment];
    } else if (!isValidTextReference({ text: input.previousText, reference: attachment })) {
      return [];
    }
    if (input.previousText === input.text) return [attachment];
    if (isTrim) {
      const start = attachment.start - trimmedPrefix;
      const end = attachment.end - trimmedPrefix;
      if (start < 0 || end > input.text.length) return [];
      return [{ ...attachment, start, end }];
    }
    if (change.previousEnd <= attachment.start) {
      return [{ ...attachment, start: attachment.start + delta, end: attachment.end + delta }];
    }
    if (change.start >= attachment.end) return [attachment];
    return [];
  });
}

export function insertProfileReference(input: {
  text: string;
  attachments: readonly UserComposerAttachment[];
  mention: ProfileReferenceRange;
  profile: AgentProfile;
  serverId: string;
}): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange;
} {
  return finishReferenceInsert({
    previousText: input.text,
    attachments: input.attachments,
    mention: input.mention,
    link: resourceLinkMarkdown({
      resource: "profile",
      serverId: input.serverId,
      resourceId: input.profile.id,
      label: profileReferenceLabel(input.profile),
    }),
  });
}

export function insertSessionReference(input: {
  text: string;
  attachments: readonly UserComposerAttachment[];
  mention: ProfileReferenceRange;
  session: SessionReferenceSource;
}): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange;
} {
  return finishReferenceInsert({
    previousText: input.text,
    attachments: input.attachments,
    mention: input.mention,
    link: resourceLinkMarkdown({
      resource: "session",
      serverId: input.session.serverId,
      resourceId: input.session.agentId,
      label: sessionReferenceLabel({
        title: input.session.title ?? "",
        agentId: input.session.agentId,
      }),
    }),
  });
}

export function insertRoleReference(input: {
  text: string;
  attachments: readonly UserComposerAttachment[];
  mention: ProfileReferenceRange;
  role: AgentRole;
  serverId: string;
}): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange;
} {
  return finishReferenceInsert({
    previousText: input.text,
    attachments: input.attachments,
    mention: input.mention,
    link: resourceLinkMarkdown({
      resource: "role",
      serverId: input.serverId,
      resourceId: input.role.id,
      label: roleReferenceLabel(input.role),
    }),
  });
}

/**
 * Replaces the typed mention with a short resource link, the same way a `$` skill is written.
 * The link names the host, kind and id; Paseo reads the current resource when it is sent.
 */
function finishReferenceInsert(input: {
  previousText: string;
  attachments: readonly UserComposerAttachment[];
  mention: ProfileReferenceRange;
  link: string;
}): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange;
} {
  const { link } = input;
  const after = input.previousText.slice(input.mention.end);
  const separator = after.length === 0 || !/^\s/.test(after) ? " " : "";
  const text = `${input.previousText.slice(0, input.mention.start)}${link}${separator}${after}`;
  const retainedAttachments = input.attachments.filter((attachment) => {
    if (!isTextReference(attachment)) return true;
    return attachment.end <= input.mention.start || attachment.start >= input.mention.end;
  });
  const attachments = updateProfileReferences({
    previousText: input.previousText,
    text,
    attachments: retainedAttachments,
    selectionBefore: input.mention,
  });
  const cursor = input.mention.start + link.length + separator.length;
  return { text, attachments, selection: { start: cursor, end: cursor } };
}

export function applyProfileReferenceEdit(input: ReferenceEditInput<UserComposerAttachment>): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange | null;
} {
  const change = textChange(input.previousText, input.text, input.selectionBefore);
  const isSingleDeletion = change.previousEnd - change.start === 1 && change.end === change.start;
  const deletedReference = isSingleDeletion
    ? validReferences({ text: input.previousText, attachments: input.attachments }).find(
        (reference) => change.start >= reference.start && change.previousEnd <= reference.end,
      )
    : undefined;
  const text = deletedReference
    ? input.previousText.slice(0, deletedReference.start) +
      input.previousText.slice(deletedReference.end)
    : input.text;
  const selection = deletedReference
    ? { start: deletedReference.start, end: deletedReference.start }
    : null;
  return {
    text,
    attachments: updateProfileReferences({
      ...input,
      text,
      selectionBefore: deletedReference ?? input.selectionBefore,
    }),
    selection,
  };
}

function encodeLinkPayload(payload: unknown): string {
  return encodeURIComponent(JSON.stringify(payload)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The Markdown link Paseo writes for a reference: its visible label and its resource address. */
export function textReferenceMarkdown(reference: TextReference): string {
  return referenceLink(reference, textReferenceLabel(reference).replace(/[\\[\]]/g, "\\$&"));
}

function referenceLink(reference: TextReference, label: string): string {
  if (reference.kind === "role_reference") {
    return `[${label}](paseo-role:${encodeLinkPayload({
      serverId: reference.serverId,
      role: reference.role,
    })})`;
  }
  if (reference.kind === "profile_reference") {
    return `[${label}](paseo-profile:${encodeLinkPayload({
      serverId: reference.serverId,
      profile: reference.profile,
    })})`;
  }
  return `[${label}](paseo-session:${encodeLinkPayload({
    serverId: reference.serverId,
    agentId: reference.agentId,
    title: reference.title,
    provider: reference.provider,
    model: reference.model,
    cwd: reference.cwd,
    workspaceId: reference.workspaceId,
  })})`;
}

export function encodeProfileReferences<T extends ComposerAttachment>(
  input: ReferenceTextInput<T>,
): string {
  let cursor = 0;
  const parts: string[] = [];
  for (const reference of validReferences(input)) {
    const label = input.text.slice(reference.start, reference.end).replace(/[\\[\]]/g, "\\$&");
    parts.push(input.text.slice(cursor, reference.start), referenceLink(reference, label));
    cursor = reference.end;
  }
  parts.push(input.text.slice(cursor));
  return parts.join("");
}

function decodeLinkPayload(payload: string): unknown | null {
  try {
    return JSON.parse(decodeURIComponent(payload));
  } catch (error) {
    if (error instanceof URIError || error instanceof SyntaxError) return null;
    throw error;
  }
}

function decodeMatchedReference(
  kind: string,
  payloadText: string,
  label: string,
  start: number,
): TextReference | null {
  const payload = decodeLinkPayload(payloadText);
  if (kind === "role") {
    const parsed = RoleLinkPayloadSchema.safeParse(payload);
    if (!parsed.success || label !== roleReferenceLabel(parsed.data.role)) return null;
    return {
      kind: "role_reference",
      id: `role:${parsed.data.serverId}:${parsed.data.role.id}:${start}`,
      ...parsed.data,
      start,
      end: start + label.length,
    };
  }
  if (kind === "profile") {
    const parsed = ProfileLinkPayloadSchema.safeParse(payload);
    if (!parsed.success || label !== profileReferenceLabel(parsed.data.profile)) return null;
    return {
      kind: "profile_reference",
      id: `profile:${parsed.data.serverId}:${parsed.data.profile.id}:${start}`,
      ...parsed.data,
      start,
      end: start + label.length,
    };
  }
  const parsed = SessionLinkPayloadSchema.safeParse(payload);
  if (!parsed.success || label !== sessionReferenceLabel(parsed.data)) return null;
  return {
    kind: "session_reference",
    id: `session:${parsed.data.serverId}:${parsed.data.agentId}:${start}`,
    ...parsed.data,
    start,
    end: start + label.length,
  };
}

export function decodeProfileReferences(text: string): ProfileReferenceDraft {
  const parts: string[] = [];
  const references: TextReference[] = [];
  let cursor = 0;
  let length = 0;
  for (const match of text.matchAll(TEXT_REFERENCE_LINK)) {
    const label = match[1].replace(/\\([\\[\]])/g, "$1");
    const prefix = text.slice(cursor, match.index);
    const start = length + prefix.length;
    const reference = decodeMatchedReference(match[2], match[3], label, start);
    if (!reference) continue;
    parts.push(prefix, label);
    length = reference.end;
    cursor = match.index + match[0].length;
    references.push(reference);
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), references };
}

export interface MessageReference {
  reference: InlineReference;
  /** The link as written in the message, for copying. */
  markdown: string;
  /** Range of the visible label in the decoded text. */
  start: number;
  end: number;
}

/**
 * Sent-message text with every valid reference link, legacy or short, replaced by its label.
 */
export function decodeMessageReferences(text: string): {
  text: string;
  references: MessageReference[];
} {
  const links: { start: number; end: number; label: string; reference: InlineReference }[] = [];
  for (const reference of findTextReferenceLinks(text)) {
    links.push({
      start: reference.start,
      end: reference.end,
      label: textReferenceLabel(reference),
      reference,
    });
  }
  for (const reference of findResourceLinks(text)) {
    links.push({ start: reference.start, end: reference.end, label: reference.label, reference });
  }
  links.sort((left, right) => left.start - right.start);
  const parts: string[] = [];
  const references: MessageReference[] = [];
  let cursor = 0;
  let length = 0;
  for (const link of links) {
    if (link.start < cursor) continue;
    const prefix = text.slice(cursor, link.start);
    const start = length + prefix.length;
    parts.push(prefix, link.label);
    length = start + link.label.length;
    references.push({
      reference: link.reference,
      markdown: text.slice(link.start, link.end),
      start,
      end: length,
    });
    cursor = link.end;
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), references };
}

/**
 * Valid reference links written in the text itself, with `start`/`end` spanning the whole
 * link. Links whose label no longer matches their resource stay plain text.
 */
export function findTextReferenceLinks(text: string): TextReference[] {
  if (!text.includes("](paseo-")) return [];
  const references: TextReference[] = [];
  for (const match of text.matchAll(TEXT_REFERENCE_LINK)) {
    const label = match[1].replace(/\\([\\[\]])/g, "$1");
    const reference = decodeMatchedReference(match[2], match[3], label, match.index);
    if (reference) references.push({ ...reference, end: match.index + match[0].length });
  }
  return references;
}

export function findTextReferenceAt<T extends ComposerAttachment>(input: {
  text: string;
  attachments: readonly T[];
  index: number;
}): InlineReference | null {
  return (
    [
      ...validReferences(input),
      ...findTextReferenceLinks(input.text),
      ...findResourceLinks(input.text),
    ].find((reference) => textReferenceContainsIndex(reference, input.index)) ?? null
  );
}

export function profileReferenceToAgentAttachment(
  reference: ProfileReference,
): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "agent_profile",
    title: reference.profile.name,
    text: buildAgentProfileAddressCard(reference.profile),
  };
}

/** `targetServerId` is the host the message goes to, when the caller knows it. */
export function textReferenceToAgentAttachment(
  reference: TextReference,
  targetServerId?: string,
): Extract<AgentAttachment, { type: "text" }> {
  if (reference.kind === "profile_reference") return profileReferenceToAgentAttachment(reference);
  if (reference.kind === "role_reference") {
    return {
      type: "text",
      mimeType: "text/plain",
      contextKind: "agent_role",
      title: reference.role.name,
      text: buildAgentRoleAddressCard(reference.role, {
        serverId: reference.serverId,
        targetServerId,
      }),
    };
  }
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "agent_session",
    title: reference.title,
    text: buildAgentSessionAddressCard({
      agentId: reference.agentId,
      serverId: reference.serverId,
      title: reference.title,
      provider: reference.provider,
      model: reference.model,
      cwd: reference.cwd,
      workspaceId: reference.workspaceId,
    }),
  };
}
