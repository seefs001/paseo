import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  getAgentAttachmentPillContent,
  getWorkspaceAttachmentPillContent,
} from "./attachment-pill-content";

describe("agent attachment pill content", () => {
  it("presents external resources with their provider identity", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "ENG-123 Plugin attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        externalResource: {
          provider: "linear",
          providerLabel: "Linear issue",
          resourceType: "issue",
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Plugin attachments");
    expect(content.subtitle).toBe("Linear issue ENG-123");
  });

  it("keeps sent agent session mentions from looking like generic text files", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "agent_session",
        title: "Auth fix",
        text: "Referenced agent session",
      },
      i18n.t,
    );

    expect(content.title).toBe("Auth fix");
    expect(content.subtitle).toBe("Agent session");
  });

  it("keeps sent agent profile mentions from looking like generic text files", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "agent_profile",
        title: "K3",
        text: "Referenced agent profile",
      },
      i18n.t,
    );

    expect(content.title).toBe("K3");
    expect(content.subtitle).toBe("Agent profile");
  });
});

describe("workspace attachment pill content", () => {
  it("labels composer agent profile mentions as profiles", () => {
    const content = getWorkspaceAttachmentPillContent(
      {
        kind: "agent_profile",
        id: "agent_profile:local:p1",
        attachment: {
          type: "text",
          mimeType: "text/plain",
          contextKind: "agent_profile",
          title: "K3",
          text: "Referenced agent profile",
        },
        source: { serverId: "local", profileId: "p1" },
      },
      i18n.t,
    );

    expect(content.title).toBe("K3");
    expect(content.subtitle).toBe("Agent profile");
  });
});
