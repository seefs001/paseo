import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

export function supportsSessionShareCommand(
  agent: Pick<AgentSnapshotPayload, "provider" | "capabilities"> | null,
): boolean {
  // COMPAT(piShareDialog): added in v0.12.0-beta.1, remove after 2027-04-18.
  // Recognize Pi on older hosts so the RPC shows the update requirement, not chat output.
  return agent?.provider === "pi" || agent?.capabilities?.supportsSessionSharing === true;
}

export function parseSessionShareCommand(input: {
  text: string;
  enabled: boolean;
  hasAttachments: boolean;
}): { args: string } | null {
  if (!input.enabled || input.hasAttachments) return null;
  const match = /^\/share(?:\s+([\s\S]*))?$/i.exec(input.text.trim());
  return match ? { args: match[1]?.trim() ?? "" } : null;
}
