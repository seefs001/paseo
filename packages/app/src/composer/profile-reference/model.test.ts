import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import {
  applyProfileReferenceEdit,
  decodeProfileReferences,
  decodeMessageReferences,
  encodeProfileReferences,
  findResourceLinks,
  findTextReferenceLinks,
  getProfileReferenceHighlights,
  insertProfileReference,
  insertSessionReference,
  profileReferenceToAgentAttachment,
  textReferenceToAgentAttachment,
  updateProfileReferences,
  type ProfileReference,
  type ResourceLinkReference,
  type SessionReference,
  type TextReference,
} from "./model";

const profile: AgentProfile = {
  id: "opus",
  name: "Claude Opus 5.5",
  provider: "claude",
  model: "claude-opus-5-5",
  modeId: "auto",
  thinkingOptionId: "xhigh",
  featureValues: { auto_accept_mcp: true },
  notes: "代码研究",
};

function insert(text = "请用 #cla 帮忙") {
  const start = text.indexOf("#cla");
  return insertProfileReference({
    text,
    attachments: [],
    mention: { start, end: start + 4 },
    profile,
    serverId: "host-a",
  });
}

/** The one short resource link in `text`. */
function linkOf(text: string): ResourceLinkReference {
  const [link, ...rest] = findResourceLinks(text);
  if (!link || rest.length > 0) throw new Error("Expected exactly one resource link");
  return link;
}

/**
 * A draft saved by an older build: the visible label in the text and a profile snapshot bound to
 * its range. Those drafts still load, edit and send as snapshot links.
 */
function legacyDraft(
  text = "请用 #Claude Opus 5.5 帮忙",
  snapshot: AgentProfile = profile,
  serverId = "host-a",
): { text: string; attachments: TextReference[] } {
  const label = `#${snapshot.name}`;
  const start = text.indexOf(label);
  if (start < 0) throw new Error("Expected the label in the text");
  const reference: ProfileReference = {
    kind: "profile_reference",
    id: `legacy:${serverId}:${snapshot.id}`,
    serverId,
    profile: snapshot,
    start,
    end: start + label.length,
  };
  return { text, attachments: [reference] };
}

/** A legacy snapshot link as older builds sent it. */
function legacyLink(text?: string, snapshot?: AgentProfile, serverId?: string): string {
  return encodeProfileReferences(legacyDraft(text, snapshot, serverId));
}

function referenceOf(attachments: readonly { kind: string }[]): ProfileReference {
  const reference = attachments.find(
    (attachment): attachment is ProfileReference => attachment.kind === "profile_reference",
  );
  if (!reference) throw new Error("Expected a profile reference");
  return reference;
}

describe("profile references", () => {
  it("inserts a short resource link that names only the host, kind and id", () => {
    const selected = insert();
    expect(selected.attachments).toEqual([]);
    expect(selected.text).toBe("请用 [#Claude Opus 5.5](paseo://host-a/profile/opus) 帮忙");
    const link = linkOf(selected.text);
    expect(link).toMatchObject({
      resource: "profile",
      serverId: "host-a",
      resourceId: "opus",
      label: "#Claude Opus 5.5",
    });
    // The configuration stays on the host; the link does not carry a snapshot.
    expect(selected.text).not.toContain("claude-opus-5-5");
    expect(selected.text).not.toContain("xhigh");
    expect(findTextReferenceLinks(selected.text)).toEqual([]);
    expect(selected.selection).toEqual({ start: link.end, end: link.end });
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: link.start, end: link.end }]);
  });

  it("does not bind plain occurrences of the same name or a longer profile name", () => {
    const selected = insert("#cla and #Claude Opus 5.5 and #Claude Opus 5.5 Fast");
    const link = linkOf(selected.text);
    expect(link.start).toBe(0);
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: 0, end: link.end }]);
    expect(encodeProfileReferences(selected)).toBe(selected.text);
    expect(selected.text.match(/paseo:\/\//g)).toHaveLength(1);
    const decoded = decodeMessageReferences(selected.text);
    expect(decoded.text).toBe("#Claude Opus 5.5 and #Claude Opus 5.5 and #Claude Opus 5.5 Fast");
    expect(decoded.references.map(({ start, end }) => [start, end])).toEqual([[0, 16]]);
  });

  it("shifts an exact reference when text is inserted before it and keeps it after appending", () => {
    const selected = legacyDraft();
    const before = updateProfileReferences({
      previousText: selected.text,
      text: `先 ${selected.text}`,
      attachments: selected.attachments,
    });
    expect(referenceOf(before).start).toBe(referenceOf(selected.attachments).start + 2);
    const after = updateProfileReferences({
      previousText: selected.text,
      text: `${selected.text}！`,
      attachments: selected.attachments,
    });
    expect(referenceOf(after)).toBe(referenceOf(selected.attachments));
  });

  it("uses the edited selection to avoid transferring a deleted reference to repeated text", () => {
    const selected = legacyDraft("#A #A", { id: "a", name: "A", provider: "pi" });
    expect(selected.text).toBe("#A #A");
    const edited = applyProfileReferenceEdit({
      previousText: selected.text,
      text: "#A",
      attachments: selected.attachments,
      selectionBefore: { start: 0, end: 3 },
    });
    expect(edited.attachments).toEqual([]);
    const retained = applyProfileReferenceEdit({
      previousText: selected.text,
      text: "#A",
      attachments: selected.attachments,
      selectionBefore: { start: 2, end: 5 },
    });
    expect(referenceOf(retained.attachments).profile.id).toBe("a");
  });

  it("replaces the link when selecting a different same-named profile in the same range", () => {
    const first = insertProfileReference({
      text: "#a",
      attachments: [],
      mention: { start: 0, end: 2 },
      profile: { id: "a", name: "A", provider: "pi" },
      serverId: "host-a",
    });
    const firstLink = linkOf(first.text);
    const second = insertProfileReference({
      ...first,
      mention: { start: firstLink.start, end: firstLink.end },
      profile: { id: "b", name: "A", provider: "claude", model: "opus" },
      serverId: "host-b",
    });
    expect(second.attachments).toEqual([]);
    expect(decodeMessageReferences(second.text).text).toBe(
      decodeMessageReferences(first.text).text,
    );
    expect(linkOf(second.text)).toMatchObject({ serverId: "host-b", resourceId: "b" });
  });

  it("keeps the selected occurrence distinct from another same-named profile", () => {
    const first = insert("#cla ");
    const text = `${first.text}#other`;
    const second = insertProfileReference({
      text,
      attachments: first.attachments,
      mention: { start: first.text.length, end: text.length },
      profile: { ...profile, id: "other", model: "another-model" },
      serverId: "host-b",
    });
    expect(findResourceLinks(second.text).map((link) => [link.serverId, link.resourceId])).toEqual([
      ["host-a", "opus"],
      ["host-b", "other"],
    ]);
  });

  it("unbinds when editing inside a reference rather than attaching to a matching name elsewhere", () => {
    const selected = legacyDraft("#cla and #Claude Opus 5.5");
    expect(selected.attachments).toHaveLength(1);
    const text = selected.text.replace("#Claude", "#Cllaude");
    const attachments = updateProfileReferences({
      previousText: selected.text,
      text,
      attachments: selected.attachments,
    });
    expect(attachments).toEqual([]);
    expect(encodeProfileReferences({ text, attachments })).toBe(text);
  });

  it("edits a written link as plain Markdown, and still deletes a legacy draft token atomically", () => {
    // A link is ordinary text. Its label is display text, so renaming it keeps the resource;
    // breaking the address leaves plain text.
    const linked = insert();
    const link = linkOf(linked.text);
    const labelEnd = link.start + "[#Claude Opus 5.5".length;
    const backspaced = linked.text.slice(0, labelEnd - 1) + linked.text.slice(labelEnd);
    expect(
      applyProfileReferenceEdit({
        previousText: linked.text,
        text: backspaced,
        attachments: linked.attachments,
      }),
    ).toEqual({ text: backspaced, attachments: [], selection: null });
    expect(linkOf(backspaced)).toMatchObject({ resourceId: "opus", label: "#Claude Opus 5." });
    // The address, not the sigil, is the identity: a label without # still names the profile.
    const unsigiled = linked.text.replace("[#Claude Opus 5.5]", "[Research]");
    expect(linkOf(unsigiled)).toMatchObject({
      resource: "profile",
      serverId: "host-a",
      resourceId: "opus",
      label: "Research",
    });
    const broken = linked.text.slice(0, link.end - 1) + linked.text.slice(link.end);
    expect(findResourceLinks(broken)).toEqual([]);

    const selected = legacyDraft();
    const reference = referenceOf(selected.attachments);
    const text = selected.text.slice(0, reference.end - 1) + selected.text.slice(reference.end);
    const edited = applyProfileReferenceEdit({
      previousText: selected.text,
      text,
      attachments: selected.attachments,
    });
    expect(edited.text).toBe("请用  帮忙");
    expect(edited.attachments).toEqual([]);
    expect(edited.selection).toEqual({ start: reference.start, end: reference.start });
  });

  it("does not turn an insertion or replacement inside a reference into an atomic deletion", () => {
    const selected = legacyDraft();
    const text = selected.text.replace("Opus", "奥普斯");
    expect(
      applyProfileReferenceEdit({
        previousText: selected.text,
        text,
        attachments: selected.attachments,
      }),
    ).toEqual({
      text,
      attachments: [],
      selection: null,
    });
  });

  it("keeps references when both sides of a message are trimmed", () => {
    const linked = insert(" \n #cla \n ");
    expect(getProfileReferenceHighlights({ text: linked.text.trim(), attachments: [] })).toEqual([
      { start: 0, end: linkOf(linked.text.trim()).end },
    ]);
    const selected = legacyDraft(" \n #Claude Opus 5.5 \n ");
    const text = selected.text.trim();
    const attachments = updateProfileReferences({
      previousText: selected.text,
      text,
      attachments: selected.attachments,
    });
    expect(getProfileReferenceHighlights({ text, attachments })).toEqual([
      { start: 0, end: text.length },
    ]);
  });

  it("does not rebind a deleted reference when undo or plain-text paste brings its name back", () => {
    const selected = legacyDraft();
    const removed = updateProfileReferences({
      previousText: selected.text,
      text: "",
      attachments: selected.attachments,
    });
    expect(
      updateProfileReferences({ previousText: "", text: selected.text, attachments: removed }),
    ).toEqual([]);
  });

  it("retains complete snapshot semantics in history without live configuration or attachments", () => {
    // Messages sent by older builds keep their snapshot; reading them never consults the host.
    const sent = legacyLink();
    const decoded = decodeProfileReferences(sent);
    expect(decoded.text).toBe("请用 #Claude Opus 5.5 帮忙");
    expect(decoded.references).toHaveLength(1);
    const reference = decoded.references[0];
    if (reference?.kind !== "profile_reference") throw new Error("expected a profile reference");
    expect(reference.profile).toEqual(profile);
    const attachment = profileReferenceToAgentAttachment(reference);
    expect(attachment.contextKind).toBe("agent_profile");
    expect(attachment.text).toContain("profileId: opus");
    expect(attachment.text).toContain('featureValues: {"auto_accept_mcp":true}');
    expect(attachment.text).toContain("thinkingOptionId: xhigh");
  });

  it("round trips punctuation, unicode and markdown delimiters in profile names", () => {
    const specialProfile = {
      ...profile,
      id: "专家/(5.5) Opus",
      name: "专家 [Opus] (5.5) \\ 编程",
    };
    const selected = insertProfileReference({
      text: "😀 #x!",
      attachments: [],
      mention: { start: 3, end: 5 },
      profile: specialProfile,
      serverId: "srv_Ab-9",
    });
    expect(selected.text).toBe(
      "😀 [#专家 \\[Opus\\] (5.5) \\\\ 编程](paseo://srv_Ab-9/profile/%E4%B8%93%E5%AE%B6%2F%285.5%29%20Opus) !",
    );
    expect(linkOf(selected.text)).toMatchObject({
      serverId: "srv_Ab-9",
      resourceId: specialProfile.id,
      label: "#专家 [Opus] (5.5) \\ 编程",
      start: 3,
    });
    const decoded = decodeMessageReferences(selected.text);
    expect(decoded.text).toBe("😀 #专家 [Opus] (5.5) \\ 编程 !");
    expect(decoded.references[0]).toMatchObject({
      start: 3,
      markdown: linkOf(selected.text).markdown,
    });

    const sent = legacyLink("😀 #专家 [Opus] (5.5) \\ 编程 !", {
      ...specialProfile,
      notes: "括号 ) 和换行\n下一行",
    });
    const legacy = decodeProfileReferences(sent).references[0];
    if (legacy?.kind !== "profile_reference") throw new Error("expected a profile reference");
    expect(legacy.profile.notes).toBe("括号 ) 和换行\n下一行");
    expect(legacy.start).toBe(3);
  });

  it.each([
    "[#name](paseo-profile:%broken)",
    "[#name](paseo-profile:%7B%7D)",
    "[#name](paseo-profile:not-json)",
    "plain #Claude Opus 5.5",
    "[normal](https://example.com)",
  ])("leaves invalid or ordinary text untouched: %s", (text) => {
    expect(decodeProfileReferences(text)).toEqual({ text, references: [] });
  });

  it("does not hide a forged label on a link with different metadata", () => {
    const encoded = legacyLink().replace("[#Claude Opus 5.5]", "[#Other]");
    expect(decodeProfileReferences(encoded)).toEqual({ text: encoded, references: [] });
  });

  it("does not encode stale ranges or duplicate overlapping references", () => {
    const selected = legacyDraft();
    expect(encodeProfileReferences({ text: "changed", attachments: selected.attachments })).toBe(
      "changed",
    );
    const doubled = encodeProfileReferences({
      ...selected,
      attachments: [...selected.attachments, ...selected.attachments],
    });
    expect(decodeProfileReferences(doubled).references).toHaveLength(1);
  });

  it("binds an agent session the same way, including spaces in the title", () => {
    const selected = insertSessionReference({
      text: "问 @au 进度",
      attachments: [],
      mention: { start: 2, end: 5 },
      session: {
        serverId: "local",
        agentId: "agt_auth_fix_123456",
        title: "Auth   fix",
        provider: "codex",
        model: "gpt-5",
        cwd: "/project",
        workspaceId: "ws_1",
      },
    });
    expect(selected.attachments).toEqual([]);
    expect(selected.text).toBe("问 [@Auth fix](paseo://local/session/agt_auth_fix_123456) 进度");
    const link = linkOf(selected.text);
    expect(link).toMatchObject({
      resource: "session",
      serverId: "local",
      resourceId: "agt_auth_fix_123456",
      start: 2,
    });
    expect(selected.text).not.toContain("/project");
    expect(selected.selection).toEqual({ start: link.end, end: link.end });
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: link.start, end: link.end }]);

    // Older builds bound the session's snapshot to the label.
    const snapshot: SessionReference = {
      kind: "session_reference",
      id: "legacy-session",
      serverId: "local",
      agentId: "agt_auth_fix_123456",
      title: "Auth fix",
      provider: "codex",
      model: "gpt-5",
      cwd: "/project",
      workspaceId: "ws_1",
      start: 2,
      end: 11,
    };
    const legacy = { text: "问 @Auth fix 进度", attachments: [snapshot] };
    const reference = legacy.attachments[0];
    const shifted = updateProfileReferences({
      previousText: legacy.text,
      text: `先${legacy.text}`,
      attachments: legacy.attachments,
    });
    expect(shifted.find((attachment) => attachment.kind === "session_reference")).toMatchObject({
      start: 3,
    });

    const deleted = applyProfileReferenceEdit({
      previousText: legacy.text,
      text: legacy.text.slice(0, reference.start + 1) + legacy.text.slice(reference.start + 2),
      attachments: legacy.attachments,
      selectionBefore: { start: reference.start + 1, end: reference.start + 1 },
    });
    expect(deleted.text).toBe("问  进度");
    expect(deleted.attachments).toEqual([]);

    const sent = encodeProfileReferences(legacy);
    expect(sent).toContain("](paseo-session:");
    const decoded = decodeProfileReferences(sent);
    expect(decoded.text).toBe(legacy.text);
    const restored = decoded.references[0];
    if (restored?.kind !== "session_reference") throw new Error("expected a session reference");
    expect(restored.agentId).toBe("agt_auth_fix_123456");
    expect(textReferenceToAgentAttachment(restored).text).toContain("cwd: /project");
    expect(textReferenceToAgentAttachment(restored).contextKind).toBe("agent_session");
  });
});
