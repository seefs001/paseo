import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import {
  applyProfileReferenceEdit,
  decodeProfileReferences,
  encodeProfileReferences,
  findTextReferenceLinks,
  getProfileReferenceHighlights,
  insertProfileReference,
  insertSessionReference,
  profileReferenceToAgentAttachment,
  textReferenceToAgentAttachment,
  updateProfileReferences,
  type ProfileReference,
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

/** The profile reference a link in `text` resolves to. */
function linkedProfileOf(text: string): ProfileReference {
  const [reference, ...rest] = findTextReferenceLinks(text);
  if (reference?.kind !== "profile_reference" || rest.length > 0) {
    throw new Error("Expected exactly one profile link");
  }
  return reference;
}

/**
 * A draft saved before references were written as links: the visible label in the text and the
 * reference bound to its range. Those drafts still load, edit and send.
 */
function legacyDraft(text: string): { text: string; attachments: TextReference[] } {
  const decoded = decodeProfileReferences(text);
  return { text: decoded.text, attachments: decoded.references };
}

function referenceOf(attachments: readonly { kind: string }[]): ProfileReference {
  const reference = attachments.find(
    (attachment): attachment is ProfileReference => attachment.kind === "profile_reference",
  );
  if (!reference) throw new Error("Expected a profile reference");
  return reference;
}

describe("profile references", () => {
  it("inserts a Markdown link carrying the selected configuration snapshot, with the cursor after it", () => {
    const selected = insert();
    expect(selected.attachments).toEqual([]);
    const reference = linkedProfileOf(selected.text);
    expect(selected.text).toBe(`请用 ${selected.text.slice(reference.start, reference.end)} 帮忙`);
    expect(selected.text.slice(reference.start, reference.end)).toMatch(
      /^\[#Claude Opus 5\.5\]\(paseo-profile:[^\s)]+\)$/,
    );
    expect(decodeProfileReferences(selected.text).text).toBe("请用 #Claude Opus 5.5 帮忙");
    expect(reference.profile).toEqual(profile);
    expect(reference.profile).not.toBe(profile);
    expect(reference.profile.featureValues).not.toBe(profile.featureValues);
    expect(reference.serverId).toBe("host-a");
    expect(selected.selection).toEqual({ start: reference.end, end: reference.end });
    expect(getProfileReferenceHighlights(selected)).toEqual([
      { start: reference.start, end: reference.end },
    ]);
  });

  it("does not bind plain occurrences of the same name or a longer profile name", () => {
    const selected = insert("#cla and #Claude Opus 5.5 and #Claude Opus 5.5 Fast");
    const reference = linkedProfileOf(selected.text);
    expect(reference.start).toBe(0);
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: 0, end: reference.end }]);
    expect(encodeProfileReferences(selected)).toBe(selected.text);
    expect(selected.text.match(/paseo-profile:/g)).toHaveLength(1);
    const decoded = decodeProfileReferences(selected.text);
    expect(decoded.text).toBe("#Claude Opus 5.5 and #Claude Opus 5.5 and #Claude Opus 5.5 Fast");
    expect(decoded.references.map(({ start, end }) => [start, end])).toEqual([[0, 16]]);
  });

  it("shifts an exact reference when text is inserted before it and keeps it after appending", () => {
    const selected = legacyDraft(insert().text);
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
    const selected = legacyDraft(
      insertProfileReference({
        text: "#a #A",
        attachments: [],
        mention: { start: 0, end: 2 },
        profile: { id: "a", name: "A", provider: "pi" },
        serverId: "host-a",
      }).text,
    );
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

  it("replaces the snapshot when selecting a different same-named profile in the same range", () => {
    const first = insertProfileReference({
      text: "#a",
      attachments: [],
      mention: { start: 0, end: 2 },
      profile: { id: "a", name: "A", provider: "pi" },
      serverId: "host-a",
    });
    const firstLink = linkedProfileOf(first.text);
    const second = insertProfileReference({
      ...first,
      mention: { start: firstLink.start, end: firstLink.end },
      profile: { id: "b", name: "A", provider: "claude", model: "opus" },
      serverId: "host-b",
    });
    expect(second.attachments).toEqual([]);
    expect(decodeProfileReferences(second.text).text).toBe(
      decodeProfileReferences(first.text).text,
    );
    const replaced = linkedProfileOf(second.text);
    expect(replaced.serverId).toBe("host-b");
    expect(replaced.profile).toEqual({ id: "b", name: "A", provider: "claude", model: "opus" });
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
    const decoded = decodeProfileReferences(second.text);
    expect(
      decoded.references.map((reference) => {
        if (reference.kind !== "profile_reference") throw new Error("expected a profile reference");
        return [reference.serverId, reference.profile.id];
      }),
    ).toEqual([
      ["host-a", "opus"],
      ["host-b", "other"],
    ]);
  });

  it("unbinds when editing inside a reference rather than attaching to a matching name elsewhere", () => {
    const selected = legacyDraft(insert("#cla and #Claude Opus 5.5").text);
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
    // A link is ordinary text: backspace removes one character and a broken link is plain text.
    const linked = insert();
    const link = linkedProfileOf(linked.text);
    const labelEnd = link.start + "[#Claude Opus 5.5".length;
    const backspaced = linked.text.slice(0, labelEnd - 1) + linked.text.slice(labelEnd);
    expect(
      applyProfileReferenceEdit({
        previousText: linked.text,
        text: backspaced,
        attachments: linked.attachments,
      }),
    ).toEqual({ text: backspaced, attachments: [], selection: null });
    expect(findTextReferenceLinks(backspaced)).toEqual([]);

    const selected = legacyDraft(linked.text);
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
    const selected = legacyDraft(insert().text);
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
      { start: 0, end: linkedProfileOf(linked.text.trim()).end },
    ]);
    const selected = legacyDraft(linked.text);
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
    const selected = legacyDraft(insert().text);
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
    const selected = insert();
    expect(encodeProfileReferences(selected)).toBe(selected.text);
    const decoded = decodeProfileReferences(selected.text);
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
      name: "专家 [Opus] (5.5) \\ 编程",
      notes: "括号 ) 和换行\n下一行",
    };
    const selected = insertProfileReference({
      text: "😀 #x!",
      attachments: [],
      mention: { start: 3, end: 5 },
      profile: specialProfile,
      serverId: "host-a",
    });
    expect(selected.text.startsWith("😀 [#专家 \\[Opus\\] (5.5) \\\\ 编程](paseo-profile:")).toBe(
      true,
    );
    expect(linkedProfileOf(selected.text).profile).toEqual(specialProfile);
    const decoded = decodeProfileReferences(selected.text);
    expect(decoded.text).toBe("😀 #专家 [Opus] (5.5) \\ 编程 !");
    const reference = decoded.references[0];
    if (reference?.kind !== "profile_reference") throw new Error("expected a profile reference");
    expect(reference.profile).toEqual(specialProfile);
    expect(reference.start).toBe(3);
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
    const encoded = insert().text.replace("[#Claude Opus 5.5]", "[#Other]");
    expect(decodeProfileReferences(encoded)).toEqual({ text: encoded, references: [] });
  });

  it("does not encode stale ranges or duplicate overlapping references", () => {
    const selected = legacyDraft(insert().text);
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
    const [link, ...others] = findTextReferenceLinks(selected.text);
    if (link?.kind !== "session_reference" || others.length > 0) {
      throw new Error("expected one session link");
    }
    expect(link).toMatchObject({
      serverId: "local",
      title: "Auth fix",
      agentId: "agt_auth_fix_123456",
      start: 2,
    });
    expect(selected.text).toBe(`问 ${selected.text.slice(link.start, link.end)} 进度`);
    expect(selected.selection).toEqual({ start: link.end, end: link.end });
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: link.start, end: link.end }]);

    const legacy = legacyDraft(selected.text);
    expect(legacy.text).toBe("问 @Auth fix 进度");
    const reference = legacy.attachments[0];
    if (reference?.kind !== "session_reference") throw new Error("expected a session reference");
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

    expect(encodeProfileReferences(legacy)).toBe(selected.text);
    const decoded = decodeProfileReferences(selected.text);
    expect(decoded.text).toBe(legacy.text);
    const restored = decoded.references[0];
    if (restored?.kind !== "session_reference") throw new Error("expected a session reference");
    expect(restored.agentId).toBe("agt_auth_fix_123456");
    expect(textReferenceToAgentAttachment(restored).text).toContain("cwd: /project");
    expect(textReferenceToAgentAttachment(restored).contextKind).toBe("agent_session");
  });
});
