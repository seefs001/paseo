import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  buildAgentProfileAddressCard,
  buildAgentSessionAddressCard,
} from "@/utils/session-mention-autocomplete";
import { getAgentMentionDetail, isAgentMentionAttachment } from "./agent-mention-detail";

describe("getAgentMentionDetail", () => {
  it("returns null for ordinary text attachments", () => {
    const attachment = {
      type: "text" as const,
      mimeType: "text/plain" as const,
      title: "Notes",
      text: "Just some notes",
    };
    expect(isAgentMentionAttachment(attachment)).toBe(false);
    expect(getAgentMentionDetail(attachment, i18n.t)).toBeNull();
  });

  it("shows profile launch fields from the address card", () => {
    const profile = {
      id: "agent_profile_k3",
      name: "K3",
      provider: "cursor",
      model: "kimi-k3",
      modeId: "agent",
      notes: "Use for UI work",
    };

    const attachment = {
      type: "text" as const,
      mimeType: "text/plain" as const,
      contextKind: "agent_profile" as const,
      title: "K3",
      text: buildAgentProfileAddressCard(profile),
    };
    expect(isAgentMentionAttachment(attachment)).toBe(true);
    expect(getAgentMentionDetail(attachment, i18n.t)).toEqual({
      kind: "agent_profile",
      title: "K3",
      rows: [
        { key: "provider", label: "Provider", value: "cursor" },
        { key: "model", label: "Model", value: "kimi-k3" },
        { key: "modeId", label: "Mode", value: "agent" },
        { key: "notes", label: "When to use", value: "Use for UI work" },
      ],
    });
  });

  it("shows session address fields from the address card", () => {
    const session = {
      agentId: "agt_auth_fix_123456",
      serverId: "local",
      title: "Auth fix",
      provider: "cursor",
      model: "grok-4.6",
      cwd: "/repo",
      workspaceId: "ws-1",
    };

    expect(
      getAgentMentionDetail(
        {
          type: "text",
          mimeType: "text/plain",
          contextKind: "agent_session",
          title: "Auth fix",
          text: buildAgentSessionAddressCard(session),
        },
        i18n.t,
      ),
    ).toEqual({
      kind: "agent_session",
      title: "Auth fix",
      rows: [
        { key: "provider", label: "Provider", value: "cursor" },
        { key: "model", label: "Model", value: "grok-4.6" },
        { key: "agentId", label: "Agent ID", value: "agt_auth_fix_123456" },
        { key: "cwd", label: "Directory", value: "/repo" },
      ],
    });
  });
});
