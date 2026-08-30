import type { AgentSessionContextAttachment } from "./types";
import { buildAgentSessionAddressCard } from "@/utils/session-mention-autocomplete";

export interface BuildAgentSessionComposerAttachmentInput {
  serverId: string;
  agentId: string;
  title: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
}

export function buildAgentSessionComposerAttachment(
  input: BuildAgentSessionComposerAttachmentInput,
): AgentSessionContextAttachment {
  const title = input.title?.trim() || input.agentId.slice(0, 7);
  return {
    kind: "agent_session",
    id: `agent_session:${input.serverId}:${input.agentId}`,
    attachment: {
      type: "text",
      mimeType: "text/plain",
      title,
      text: buildAgentSessionAddressCard(input),
    },
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
    },
  };
}
