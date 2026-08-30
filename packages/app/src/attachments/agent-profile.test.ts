import { describe, expect, it } from "vitest";
import { buildAgentProfileComposerAttachment } from "./agent-profile";
import { buildAgentProfileAddressCard } from "@/utils/session-mention-autocomplete";

describe("buildAgentProfileComposerAttachment", () => {
  it("wraps the profile card as a workspace attachment", () => {
    const profile = {
      id: "agent_profile_fable",
      name: "Cursor Fable",
      provider: "cursor",
      model: "claude-fable-5",
      modeId: "agent",
    };

    expect(
      buildAgentProfileComposerAttachment({
        serverId: "local",
        profile,
      }),
    ).toEqual({
      kind: "agent_profile",
      id: "agent_profile:local:agent_profile_fable",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        title: "Cursor Fable",
        text: buildAgentProfileAddressCard(profile),
      },
      source: {
        serverId: "local",
        profileId: "agent_profile_fable",
      },
    });
  });
});
