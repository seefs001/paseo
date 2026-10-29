import {
  AgentProfileSchema,
  type AgentAttachment,
  type AgentProfile,
} from "@getpaseo/protocol/messages";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import {
  buildAgentProfileAddressCard,
  buildAgentSessionAddressCard,
} from "@/utils/session-mention-autocomplete";
import { z } from "zod";

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
export type TextReference = ProfileReference | SessionReference;

const ProfileLinkPayloadSchema = z.object({ serverId: z.string(), profile: AgentProfileSchema });
const SessionLinkPayloadSchema = SessionReferenceSchema.omit({
  kind: true,
  id: true,
  start: true,
  end: true,
});
const TEXT_REFERENCE_LINK = /\[((?:\\.|[^\]\\])*)\]\(paseo-(profile|session):([^\s)]+)\)/g;

export interface ProfileReferenceRange {
  start: number;
  end: number;
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

export function isTextReference(attachment: { kind: string }): attachment is TextReference {
  return attachment.kind === "profile_reference" || attachment.kind === "session_reference";
}

export function textReferenceLabel(reference: TextReference): string {
  return reference.kind === "profile_reference"
    ? profileReferenceLabel(reference.profile)
    : sessionReferenceLabel(reference);
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
  return validReferences(input).map(({ start, end }) => ({ start, end }));
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
    if (!isTextReference(attachment)) return [attachment];
    if (!isValidTextReference({ text: input.previousText, reference: attachment })) return [];
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
  const profile = AgentProfileSchema.parse(JSON.parse(JSON.stringify(input.profile)));
  const label = profileReferenceLabel(profile);
  const after = input.text.slice(input.mention.end);
  const separator = after.length === 0 || !/^\s/.test(after) ? " " : "";
  const text = `${input.text.slice(0, input.mention.start)}${label}${separator}${after}`;
  const end = input.mention.start + label.length;
  const reference: ProfileReference = {
    kind: "profile_reference",
    id: `profile:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    serverId: input.serverId,
    profile,
    start: input.mention.start,
    end,
  };
  return finishReferenceInsert({
    previousText: input.text,
    text,
    attachments: input.attachments,
    mention: input.mention,
    reference,
    end,
    separator,
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
  const title =
    input.session.title?.trim().replace(/\s+/g, " ") || input.session.agentId.slice(0, 7);
  const session: SessionReferenceSource = {
    serverId: input.session.serverId,
    agentId: input.session.agentId,
    title,
    provider: input.session.provider,
    model: input.session.model?.trim() || null,
    cwd: input.session.cwd,
    workspaceId: input.session.workspaceId?.trim() || null,
  };
  const label = sessionReferenceLabel({ title: session.title ?? "", agentId: session.agentId });
  const after = input.text.slice(input.mention.end);
  const separator = after.length === 0 || !/^\s/.test(after) ? " " : "";
  const text = `${input.text.slice(0, input.mention.start)}${label}${separator}${after}`;
  const end = input.mention.start + label.length;
  const reference: SessionReference = {
    kind: "session_reference",
    id: `session:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    serverId: session.serverId,
    agentId: session.agentId,
    title,
    provider: session.provider,
    model: session.model,
    cwd: session.cwd,
    workspaceId: session.workspaceId,
    start: input.mention.start,
    end,
  };
  return finishReferenceInsert({
    previousText: input.text,
    text,
    attachments: input.attachments,
    mention: input.mention,
    reference,
    end,
    separator,
  });
}

function finishReferenceInsert(input: {
  previousText: string;
  text: string;
  attachments: readonly UserComposerAttachment[];
  mention: ProfileReferenceRange;
  reference: TextReference;
  end: number;
  separator: string;
}): {
  text: string;
  attachments: UserComposerAttachment[];
  selection: ProfileReferenceRange;
} {
  const retainedAttachments = input.attachments.filter((attachment) => {
    if (!isTextReference(attachment)) return true;
    return attachment.end <= input.mention.start || attachment.start >= input.mention.end;
  });
  const attachments = updateProfileReferences({
    previousText: input.previousText,
    text: input.text,
    attachments: retainedAttachments,
    selectionBefore: input.mention,
  });
  const cursor = input.end + input.separator.length;
  return {
    text: input.text,
    attachments: [...attachments, input.reference],
    selection: { start: cursor, end: cursor },
  };
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

function referenceLink(reference: TextReference, label: string): string {
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

export function findTextReferenceAt<T extends ComposerAttachment>(input: {
  text: string;
  attachments: readonly T[];
  index: number;
}): TextReference | null {
  return (
    validReferences(input).find((reference) =>
      textReferenceContainsIndex(reference, input.index),
    ) ?? null
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

export function textReferenceToAgentAttachment(
  reference: TextReference,
): Extract<AgentAttachment, { type: "text" }> {
  if (reference.kind === "profile_reference") return profileReferenceToAgentAttachment(reference);
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
