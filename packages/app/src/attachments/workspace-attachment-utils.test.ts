import { describe, expect, it } from "vitest";
import type { ComposerAttachment, PullRequestContextAttachment } from "./types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
  workspaceAttachmentToSubmitAttachment,
} from "./workspace-attachment-utils";

function contextAttachment(
  overrides: Partial<PullRequestContextAttachment> = {},
): PullRequestContextAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment · octocat",
    subtitle: "Fix flaky build",
    text: "GitHub pull request comment\n\nLooks good.",
    url: "https://github.com/getpaseo/paseo/pull/42#issuecomment-1",
    ...overrides,
  };
}

describe("workspace attachment utilities", () => {
  it("treats pull request context as a workspace attachment", () => {
    expect(isWorkspaceAttachment(contextAttachment())).toBe(true);
  });

  it("strips context attachments from user draft attachments", () => {
    const normalAttachment: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 12,
        title: "Bug",
        url: "https://github.com/getpaseo/paseo/issues/12",
        state: "open",
        body: "Bug report",
        labels: [],
        baseRefName: null,
        headRefName: null,
      },
    };

    expect(userAttachmentsOnly([normalAttachment, contextAttachment()])).toEqual([
      normalAttachment,
    ]);
  });

  it("serializes context attachments as protocol text attachments", () => {
    expect(workspaceAttachmentToSubmitAttachment(contextAttachment())).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "Comment · octocat",
      text: "GitHub pull request comment\n\nLooks good.",
    });
  });

  it("serializes agent session mentions as address text, not transcript", () => {
    const attachment: ComposerAttachment = {
      kind: "agent_session",
      id: "agent_session:local:agt_1",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        title: "Auth fix",
        text: "Referenced agent session\n- agentId: agt_1",
      },
      source: { serverId: "local", agentId: "agt_1" },
    };

    expect(isWorkspaceAttachment(attachment)).toBe(true);
    expect(workspaceAttachmentToSubmitAttachment(attachment)).toEqual(attachment.attachment);
  });

  it("serializes agent profile mentions as create_agent address text", () => {
    const attachment: ComposerAttachment = {
      kind: "agent_profile",
      id: "agent_profile:local:p1",
      attachment: {
        type: "text",
        mimeType: "text/plain",
        title: "Cursor Fable",
        text: "Referenced agent profile\n- model: claude-fable-5",
      },
      source: { serverId: "local", profileId: "p1" },
    };

    expect(isWorkspaceAttachment(attachment)).toBe(true);
    expect(workspaceAttachmentToSubmitAttachment(attachment)).toEqual(attachment.attachment);
  });
});
