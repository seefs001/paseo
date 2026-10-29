// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachment, AgentProfile } from "@getpaseo/protocol/messages";
import { UserMessage } from "@/components/message";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import type { MarkdownClipboardEnvironment } from "@/utils/rich-clipboard";
import {
  decodeProfileReferences,
  encodeProfileReferences,
  insertSessionReference,
  profileReferenceToAgentAttachment,
  textReferenceToAgentAttachment,
} from "./model";

vi.mock("@react-native-masked-view/masked-view", () => ({ default: () => null }));
vi.mock("@/components/attachment-lightbox", () => ({ AttachmentLightbox: () => null }));
vi.mock("@/components/markdown/renderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("@/components/tool-call-details", () => ({ ToolCallDetailsContent: () => null }));
vi.mock("@/components/tool-call-sheet", () => ({ useToolCallSheet: () => null }));
vi.mock("@/components/rewind/use-rewind-agent-mutation", () => ({
  useRewindAgentMutation: () => ({ isPending: false, rewindAgent: vi.fn() }),
}));
vi.mock("@/utils/rich-clipboard-default-environment", () => ({
  getDefaultMarkdownClipboardEnvironment: vi.fn(),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role="dialog">{children}</div> : null,
}));

const profile: AgentProfile = {
  id: "profile-original",
  name: "审阅 Opus",
  provider: "claude",
  model: "claude-opus",
  modeId: "plan",
  thinkingOptionId: "high",
  featureValues: { fast_mode: true },
  notes: "Snapshot notes, not current host settings",
};
const profileLink = `[#${profile.name}](paseo-profile:${encodeURIComponent(
  JSON.stringify({ serverId: "host-original", profile }),
)})`;
const plainText = `😀请用 #${profile.name}。\n同名纯文本 #${profile.name} @existing-session **plain**`;
const message = `😀请用 ${profileLink}。\n同名纯文本 #${profile.name} @existing-session **plain**`;
const decodedProfile = decodeProfileReferences(profileLink).references[0];
if (!decodedProfile || decodedProfile.kind !== "profile_reference") {
  throw new Error("expected a profile reference");
}
const profileAttachment = profileReferenceToAgentAttachment(decodedProfile);
const sessionAttachment: AgentAttachment = {
  type: "text",
  mimeType: "text/plain",
  contextKind: "agent_session",
  title: "Existing session",
  text: "- provider: codex\n- agentId: existing-session\n- cwd: /project",
};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sent profile references", () => {
  it("renders exact inline ranges and opens the stored snapshot without attachments", () => {
    const view = render(<UserMessage message={message} timestamp={1} />);
    const body = view.container.querySelector('[data-message-text="true"]');

    expect(body?.textContent).toBe(plainText);
    expect(view.getAllByTestId("user-message-profile-reference")).toHaveLength(1);
    const reference = view.getByRole("button", { name: `#${profile.name}` });
    expect(reference.parentElement).toBe(body);
    expect(reference.style.fontSize).toBe("");
    expect(reference.style.padding).toBe("");
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(reference);

    const detail = view.getByRole("dialog");
    expect(detail.textContent).toContain(profile.model);
    expect(detail.textContent).toContain(profile.modeId);
    expect(detail.textContent).toContain(profile.thinkingOptionId);
    expect(detail.textContent).toContain(profile.notes);
  });

  it("keeps distinct snapshots for repeated labels in one message", () => {
    const otherProfile = { ...profile, id: "other-profile", model: "different-model" };
    const otherLink = `[#${profile.name}](paseo-profile:${encodeURIComponent(
      JSON.stringify({ serverId: "other-host", profile: otherProfile }),
    )})`;
    const view = render(
      <UserMessage message={`😀${profileLink}\n与${otherLink}。`} timestamp={1} />,
    );
    expect(view.container.querySelector('[data-message-text="true"]')?.textContent).toBe(
      `😀#${profile.name}\n与#${profile.name}。`,
    );
    const references = view.getAllByRole("button", { name: `#${profile.name}` });
    expect(references).toHaveLength(2);

    fireEvent.click(references[0]);
    expect(view.getByRole("dialog").textContent).toContain(profile.model);
    fireEvent.click(references[1]);
    expect(view.getByRole("dialog").textContent).toContain(otherProfile.model);
    expect(view.getByRole("dialog").textContent).not.toContain(profile.model);
  });

  it("copies only the displayed text, with no serialized profile payload", async () => {
    const writePlainText = vi.fn<MarkdownClipboardEnvironment["writePlainText"]>();
    vi.mocked(getDefaultMarkdownClipboardEnvironment).mockReturnValue({ writePlainText });
    const view = render(<UserMessage message={message} timestamp={1} />);

    fireEvent.click(view.getByRole("button", { name: "Copy message" }));

    await waitFor(() => expect(writePlainText).toHaveBeenCalledExactlyOnceWith(plainText));
  });

  it("hides only profile pills for inline references and preserves session details", () => {
    const view = render(
      <UserMessage
        message={message}
        attachments={[profileAttachment, sessionAttachment]}
        timestamp={1}
      />,
    );
    const pills = view.getAllByTestId("user-message-agent-mention-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain("Existing session");

    fireEvent.click(pills[0]);

    expect(view.getByRole("dialog").textContent).toContain("existing-session");
    expect(view.getByRole("dialog").textContent).toContain("/project");
  });

  it("keeps unrelated profile attachments alongside inline references, including same-named profiles", () => {
    const otherAttachment = {
      ...profileAttachment,
      text: profileAttachment.text.replace(profile.id, "different-profile-id"),
    };
    const view = render(
      <UserMessage
        message={message}
        attachments={[profileAttachment, otherAttachment]}
        timestamp={1}
      />,
    );
    expect(view.getAllByTestId("user-message-profile-reference")).toHaveLength(1);
    const pills = view.getAllByTestId("user-message-agent-mention-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain(profile.name);
  });

  it("keeps old profile and session pills when the message has no encoded references", () => {
    const view = render(
      <UserMessage
        message="@old-profile @existing-session"
        attachments={[profileAttachment, sessionAttachment]}
        timestamp={1}
      />,
    );
    const pills = view.getAllByTestId("user-message-agent-mention-pill");
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toContain(profile.name);
    expect(pills[1].textContent).toContain("Existing session");
    expect(view.queryByTestId("user-message-profile-reference")).toBeNull();

    fireEvent.click(pills[0]);

    expect(view.getByRole("dialog").textContent).toContain(profile.notes);
  });

  it("uses the same text and references for optimistic and reloaded messages", () => {
    const pending = render(
      <UserMessage message={message} attachments={[profileAttachment]} timestamp={1} isPending />,
    );
    expect(pending.container.querySelector('[data-message-text="true"]')?.textContent).toBe(
      plainText,
    );
    expect(pending.getAllByTestId("user-message-profile-reference")).toHaveLength(1);
    expect(pending.queryByTestId("user-message-agent-mention-pill")).toBeNull();
    pending.unmount();

    const reloaded = render(<UserMessage message={message} timestamp={1} />);
    expect(reloaded.container.querySelector('[data-message-text="true"]')?.textContent).toBe(
      plainText,
    );
    expect(reloaded.getAllByTestId("user-message-profile-reference")).toHaveLength(1);
    fireEvent.click(reloaded.getByRole("button", { name: `#${profile.name}` }));
    expect(reloaded.getByRole("dialog").textContent).toContain(profile.notes);
  });

  it("renders an inline session reference and opens its stored preview", () => {
    const selected = insertSessionReference({
      text: "看 @au",
      attachments: [],
      mention: { start: 2, end: 5 },
      session: {
        serverId: "local",
        agentId: "agt_auth_fix_123456",
        title: "Auth fix",
        provider: "codex",
        model: "gpt-5",
        cwd: "/project",
        workspaceId: "ws_1",
      },
    });
    const reference = selected.attachments.find(
      (attachment) => attachment.kind === "session_reference",
    );
    if (!reference || reference.kind !== "session_reference") {
      throw new Error("expected a session reference");
    }
    const sessionCard = textReferenceToAgentAttachment(reference);
    const view = render(
      <UserMessage
        message={encodeProfileReferences(selected)}
        attachments={[sessionCard, profileAttachment]}
        timestamp={1}
      />,
    );

    expect(view.container.querySelector('[data-message-text="true"]')?.textContent).toBe(
      selected.text,
    );
    expect(view.queryByTestId("user-message-session-reference")).not.toBeNull();
    const pills = view.getAllByTestId("user-message-agent-mention-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toContain(profile.name);

    fireEvent.click(view.getByRole("button", { name: "@Auth fix" }));

    const detail = view.getByRole("dialog");
    expect(detail.textContent).toContain("agt_auth_fix_123456");
    expect(detail.textContent).toContain("/project");
    expect(detail.textContent).toContain("gpt-5");
  });

  it("preserves malformed links and other markdown as literal user text", () => {
    const literal =
      "#manual @session [#broken](paseo-profile:not-json) [web](https://example.test) **bold**";
    const view = render(
      <UserMessage message={literal} attachments={[profileAttachment]} timestamp={1} />,
    );

    expect(view.container.querySelector('[data-message-text="true"]')?.textContent).toBe(literal);
    expect(view.queryByTestId("user-message-profile-reference")).toBeNull();
    expect(view.queryByRole("link")).toBeNull();
    expect(view.getAllByTestId("user-message-agent-mention-pill")).toHaveLength(1);
  });
});
