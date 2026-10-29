import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import {
  applyProfileReferenceEdit,
  decodeProfileReferences,
  encodeProfileReferences,
  getProfileReferenceHighlights,
  insertProfileReference,
  insertSessionReference,
  profileReferenceToAgentAttachment,
  textReferenceToAgentAttachment,
  updateProfileReferences,
  type ProfileReference,
  type SessionReference,
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

function referenceOf(attachments: ReturnType<typeof insert>["attachments"]): ProfileReference {
  const reference = attachments.find((attachment) => attachment.kind === "profile_reference");
  if (!reference) throw new Error("Expected a profile reference");
  return reference;
}

describe("profile references", () => {
  it("inserts display text and a selected configuration snapshot, with the cursor after it", () => {
    const selected = insert();
    expect(selected.text).toBe("请用 #Claude Opus 5.5 帮忙");
    const reference = referenceOf(selected.attachments);
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
    expect(getProfileReferenceHighlights(selected)).toEqual([{ start: 0, end: 16 }]);
    const encoded = encodeProfileReferences(selected);
    expect(encoded.match(/paseo-profile:/g)).toHaveLength(1);
    expect(decodeProfileReferences(encoded).text).toBe(selected.text);
  });

  it("shifts an exact reference when text is inserted before it and keeps it after appending", () => {
    const selected = insert();
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
    const selected = insertProfileReference({
      text: "#a #A",
      attachments: [],
      mention: { start: 0, end: 2 },
      profile: { id: "a", name: "A", provider: "pi" },
      serverId: "host-a",
    });
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
    const second = insertProfileReference({
      ...first,
      mention: { start: 0, end: 2 },
      profile: { id: "b", name: "A", provider: "claude", model: "opus" },
      serverId: "host-b",
    });
    expect(second.text).toBe(first.text);
    expect(second.attachments).toHaveLength(1);
    const replaced = decodeProfileReferences(encodeProfileReferences(second)).references[0];
    if (replaced?.kind !== "profile_reference") throw new Error("expected a profile reference");
    expect(replaced.profile.id).toBe("b");
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
    const decoded = decodeProfileReferences(encodeProfileReferences(second));
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
    const selected = insert("#cla and #Claude Opus 5.5");
    const text = selected.text.replace("#Claude", "#Cllaude");
    const attachments = updateProfileReferences({
      previousText: selected.text,
      text,
      attachments: selected.attachments,
    });
    expect(attachments).toEqual([]);
    expect(encodeProfileReferences({ text, attachments })).toBe(text);
  });

  it("deletes a selected token atomically with backspace and drops its metadata", () => {
    const selected = insert();
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
    const selected = insert();
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
    const selected = insert(" \n #cla \n ");
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
    const selected = insert();
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
    const decoded = decodeProfileReferences(encodeProfileReferences(selected));
    expect(decoded.text).toBe(selected.text);
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
    const decoded = decodeProfileReferences(encodeProfileReferences(selected));
    expect(decoded.text).toBe(selected.text);
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
    const encoded = encodeProfileReferences(insert()).replace("[#Claude Opus 5.5]", "[#Other]");
    expect(decodeProfileReferences(encoded)).toEqual({ text: encoded, references: [] });
  });

  it("does not encode stale ranges or duplicate overlapping references", () => {
    const selected = insert();
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
    expect(selected.text).toBe("问 @Auth fix 进度");
    const reference = selected.attachments.find(
      (attachment): attachment is SessionReference => attachment.kind === "session_reference",
    );
    if (!reference) throw new Error("expected a session reference");
    expect(reference).toMatchObject({
      title: "Auth fix",
      agentId: "agt_auth_fix_123456",
      start: 2,
    });
    expect(selected.selection).toEqual({ start: reference.end, end: reference.end });
    expect(getProfileReferenceHighlights(selected)).toEqual([
      { start: reference.start, end: reference.end },
    ]);

    const shifted = updateProfileReferences({
      previousText: selected.text,
      text: `先${selected.text}`,
      attachments: selected.attachments,
    });
    expect(shifted.find((attachment) => attachment.kind === "session_reference")).toMatchObject({
      start: 3,
    });

    const deleted = applyProfileReferenceEdit({
      previousText: selected.text,
      text: selected.text.slice(0, reference.start + 1) + selected.text.slice(reference.start + 2),
      attachments: selected.attachments,
      selectionBefore: { start: reference.start + 1, end: reference.start + 1 },
    });
    expect(deleted.text).toBe("问  进度");
    expect(deleted.attachments).toEqual([]);

    const decoded = decodeProfileReferences(encodeProfileReferences(selected));
    expect(decoded.text).toBe(selected.text);
    const restored = decoded.references[0];
    if (restored?.kind !== "session_reference") throw new Error("expected a session reference");
    expect(restored.agentId).toBe("agt_auth_fix_123456");
    expect(textReferenceToAgentAttachment(restored).text).toContain("cwd: /project");
    expect(textReferenceToAgentAttachment(restored).contextKind).toBe("agent_session");
  });
});
