import { describe, expect, it } from "vitest";
import { buildAgentSessionComposerAttachment } from "./agent-session";
import { buildAgentSessionAddressCard } from "@/utils/session-mention-autocomplete";

describe("buildAgentSessionComposerAttachment", () => {
  it("wraps the address card as a workspace attachment without transcript text", () => {
    const input = {
      serverId: "local",
      agentId: "agt_auth_fix_123456",
      title: "Auth fix",
      provider: "cursor",
      model: "grok-4.6",
      cwd: "/repo",
      workspaceId: "ws-1",
    };

    expect(buildAgentSessionComposerAttachment(input)).toEqual({
      kind: "agent_session",
      id: "agent_session:local:agt_auth_fix_123456",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        title: "Auth fix",
        text: buildAgentSessionAddressCard(input),
      },
      source: {
        serverId: "local",
        agentId: "agt_auth_fix_123456",
      },
    });
  });

  it("falls back to a short id when the session has no title", () => {
    expect(
      buildAgentSessionComposerAttachment({
        serverId: "local",
        agentId: "agt_auth_fix_123456",
        title: "  ",
        provider: "cursor",
        model: null,
        cwd: "/repo",
        workspaceId: null,
      }).attachment.title,
    ).toBe("agt_aut");
  });
});
