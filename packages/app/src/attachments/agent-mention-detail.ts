import type { TFunction } from "i18next";
import type { AgentAttachment } from "@getpaseo/protocol/messages";

export interface AgentMentionDetailRow {
  key: string;
  label: string;
  value: string;
}

export interface AgentMentionDetail {
  kind: "agent_profile" | "agent_session" | "agent_role";
  title: string;
  rows: AgentMentionDetailRow[];
}

const ADDRESS_CARD_FIELD = /^- ([^:]+): (.*)$/;

export function isAgentMentionAttachment(attachment: AgentAttachment): boolean {
  return (
    attachment.type === "text" &&
    (attachment.contextKind === "agent_profile" || attachment.contextKind === "agent_session")
  );
}

export function getAgentMentionDetail(
  attachment: AgentAttachment,
  t: TFunction,
): AgentMentionDetail | null {
  if (attachment.type !== "text") {
    return null;
  }
  if (attachment.contextKind === "agent_profile") {
    return buildProfileDetail(attachment, t);
  }
  if (attachment.contextKind === "agent_session") {
    return buildSessionDetail(attachment, t);
  }
  if (attachment.contextKind === "agent_role") {
    const fields = parseAddressCardFields(attachment.text);
    const rows: AgentMentionDetailRow[] = [];
    pushRow(rows, fields, "roleId", t("message.attachments.detailRoleId"));
    pushRow(rows, fields, "description", t("message.attachments.detailPurpose"));
    pushRow(rows, fields, "host", t("message.attachments.detailHost"));
    return {
      kind: "agent_role",
      title: attachment.title?.trim() || fields.name || t("message.attachments.agentRole"),
      rows,
    };
  }
  return null;
}

/** A preview whose resource is still being read, or could not be read. */
export function buildAgentMentionStatusDetail(input: {
  kind: AgentMentionDetail["kind"];
  title: string;
  status: string;
}): AgentMentionDetail {
  return {
    kind: input.kind,
    title: input.title,
    rows: [{ key: "status", label: "", value: input.status }],
  };
}

function buildProfileDetail(
  attachment: Extract<AgentAttachment, { type: "text" }>,
  t: TFunction,
): AgentMentionDetail {
  const fields = parseAddressCardFields(attachment.text);
  const rows: AgentMentionDetailRow[] = [];
  pushRow(rows, fields, "provider", t("settings.host.agentProfiles.providerLabel"));
  pushRow(rows, fields, "model", t("settings.host.agentProfiles.modelLabel"));
  pushRow(rows, fields, "modeId", t("settings.host.agentProfiles.modeLabel"));
  pushRow(rows, fields, "thinkingOptionId", t("settings.host.agentProfiles.thinkingLabel"));
  pushRow(rows, fields, "notes", t("settings.host.agentProfiles.notesLabel"));
  return {
    kind: "agent_profile",
    title: attachment.title?.trim() || fields.name || t("message.attachments.agentProfile"),
    rows,
  };
}

function buildSessionDetail(
  attachment: Extract<AgentAttachment, { type: "text" }>,
  t: TFunction,
): AgentMentionDetail {
  const fields = parseAddressCardFields(attachment.text);
  const rows: AgentMentionDetailRow[] = [];
  pushRow(rows, fields, "provider", t("settings.host.agentProfiles.providerLabel"));
  pushRow(rows, fields, "model", t("settings.host.agentProfiles.modelLabel"));
  pushRow(rows, fields, "agentId", t("message.attachments.detailAgentId"));
  pushRow(rows, fields, "cwd", t("message.attachments.detailDirectory"));
  return {
    kind: "agent_session",
    title: attachment.title?.trim() || fields.title || t("message.attachments.agentSession"),
    rows,
  };
}

function parseAddressCardFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = ADDRESS_CARD_FIELD.exec(line);
    if (!match) {
      continue;
    }
    fields[match[1]] = match[2];
  }
  return fields;
}

function pushRow(
  rows: AgentMentionDetailRow[],
  fields: Record<string, string>,
  fieldKey: string,
  label: string,
): void {
  const value = fields[fieldKey]?.trim();
  if (!value) {
    return;
  }
  rows.push({ key: fieldKey, label, value });
}
