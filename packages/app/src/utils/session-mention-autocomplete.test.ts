import { describe, expect, it } from "vitest";
import {
  applySessionMentionReplacement,
  buildAgentSessionAddressCard,
  isPathMentionQuery,
  rankSessionMentionCandidates,
  resolveComposerMentionMode,
  type SessionMentionCandidate,
} from "./session-mention-autocomplete";

function candidate(
  overrides: Partial<SessionMentionCandidate> & Pick<SessionMentionCandidate, "id">,
): SessionMentionCandidate {
  return {
    serverId: "local",
    title: overrides.id,
    provider: "cursor",
    model: "grok-4.6",
    cwd: "/repo",
    workspaceId: "ws-1",
    parentAgentId: null,
    activityAt: 1,
    isOpenTab: false,
    ...overrides,
  };
}

describe("isPathMentionQuery", () => {
  it("treats slash-containing queries as file paths", () => {
    expect(isPathMentionQuery("src/foo")).toBe(true);
    expect(isPathMentionQuery("foo")).toBe(false);
    expect(isPathMentionQuery("")).toBe(false);
  });
});

describe("resolveComposerMentionMode", () => {
  it("keeps path queries on files and uses sessions for empty or name queries", () => {
    expect(
      resolveComposerMentionMode({ mentionQuery: null, canAttachSessionMention: true }),
    ).toBeNull();
    expect(
      resolveComposerMentionMode({ mentionQuery: "src/foo", canAttachSessionMention: true }),
    ).toBe("file");
    expect(resolveComposerMentionMode({ mentionQuery: "", canAttachSessionMention: true })).toBe(
      "session",
    );
    expect(
      resolveComposerMentionMode({ mentionQuery: "auth", canAttachSessionMention: true }),
    ).toBe("session");
  });

  it("falls back to file mentions when the composer cannot attach a session", () => {
    expect(resolveComposerMentionMode({ mentionQuery: "", canAttachSessionMention: false })).toBe(
      "file",
    );
    expect(
      resolveComposerMentionMode({ mentionQuery: "auth", canAttachSessionMention: false }),
    ).toBe("file");
  });
});

describe("applySessionMentionReplacement", () => {
  it("removes the active @token so the attachment carries the address", () => {
    expect(
      applySessionMentionReplacement({
        text: "handoff to @auth",
        mention: { start: 11, end: 16, query: "auth" },
      }),
    ).toBe("handoff to ");
  });
});

describe("rankSessionMentionCandidates", () => {
  it("excludes the current session and orders subagents, workspace, then open tabs", () => {
    const ranked = rankSessionMentionCandidates({
      currentAgentId: "self",
      currentWorkspaceId: "ws-1",
      query: "",
      agents: [
        candidate({ id: "self", activityAt: 90 }),
        candidate({
          id: "other-host-tab",
          workspaceId: "ws-2",
          isOpenTab: true,
          activityAt: 80,
        }),
        candidate({ id: "workspace-old", activityAt: 10 }),
        candidate({ id: "workspace-new", activityAt: 50 }),
        candidate({
          id: "child",
          parentAgentId: "self",
          activityAt: 5,
        }),
        candidate({
          id: "other-closed",
          workspaceId: "ws-2",
          activityAt: 99,
        }),
      ],
    });

    expect(ranked.map((agent) => agent.id)).toEqual([
      "child",
      "workspace-new",
      "workspace-old",
      "other-host-tab",
      "other-closed",
    ]);
  });

  it("filters by title, id, provider, or model without requiring a path", () => {
    const ranked = rankSessionMentionCandidates({
      currentAgentId: "self",
      currentWorkspaceId: "ws-1",
      query: "fable",
      agents: [
        candidate({ id: "a", title: "Claude Fable review", model: "claude-fable-5" }),
        candidate({ id: "b", title: "Grok work", model: "grok-4.6" }),
      ],
    });

    expect(ranked.map((agent) => agent.id)).toEqual(["a"]);
  });
});

describe("buildAgentSessionAddressCard", () => {
  it("includes a copyable agentId instead of transcript text", () => {
    const card = buildAgentSessionAddressCard({
      agentId: "agt_auth_fix_123456",
      serverId: "local",
      title: "Auth fix",
      provider: "cursor",
      model: "grok-4.6",
      cwd: "/repo",
      workspaceId: "ws-1",
    });

    expect(card).toContain("agentId: agt_auth_fix_123456");
    expect(card).toContain("shortId: agt_aut");
    expect(card).toContain("get_agent_activity");
    expect(card).not.toContain("User:");
  });
});
