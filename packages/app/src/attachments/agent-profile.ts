import type { AgentProfileContextAttachment } from "./types";
import {
  buildAgentProfileAddressCard,
  type AgentProfileMention,
} from "@/utils/session-mention-autocomplete";

export function buildAgentProfileComposerAttachment(input: {
  serverId: string;
  profile: AgentProfileMention;
}): AgentProfileContextAttachment {
  const title = input.profile.name.trim() || input.profile.provider;
  return {
    kind: "agent_profile",
    id: `agent_profile:${input.serverId}:${input.profile.id}`,
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "agent_profile",
      title,
      text: buildAgentProfileAddressCard(input.profile),
    },
    source: {
      serverId: input.serverId,
      profileId: input.profile.id,
    },
  };
}
