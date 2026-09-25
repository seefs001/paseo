import { expect, it } from "vitest";
import { collectOpenSessions, type SessionListAgent } from "./model";

it("lists only open agent tabs across panes and orders by conversation activity, not title edits", () => {
  const older = {
    title: "Older",
    provider: "codex",
    lastActivityAt: new Date(100),
    updatedAt: new Date(9999),
  };
  const newer = { ...older, title: "Newer", lastActivityAt: new Date(200) };
  const entries = collectOpenSessions({
    tabs: [
      { tabId: "old", target: { kind: "agent", agentId: "a" }, createdAt: 1 },
      { tabId: "new", target: { kind: "agent", agentId: "b" }, createdAt: 1 },
      { tabId: "terminal", target: { kind: "terminal", terminalId: "t" }, createdAt: 1 },
      { tabId: "archived", target: { kind: "agent", agentId: "c" }, createdAt: 1 },
    ],
    agents: new Map<string, SessionListAgent>([
      ["a", older],
      ["not-open", newer],
      ["c", { ...older, archivedAt: new Date() }],
    ]),
    details: new Map([["b", newer]]),
    activity: new Map(),
    untitled: "Untitled",
  });
  expect(entries.map((entry) => entry.tabId)).toEqual(["new", "old"]);
});

it("uses streaming activity when the directory snapshot has not caught up", () => {
  const agent = { title: null, provider: "codex", lastActivityAt: new Date(100) };
  const entries = collectOpenSessions({
    tabs: [{ tabId: "one", target: { kind: "agent", agentId: "a" }, createdAt: 1 }],
    agents: new Map([["a", agent]]),
    details: new Map(),
    activity: new Map([["a", new Date(300)]]),
    untitled: "Untitled",
  });
  expect(entries[0]).toMatchObject({ title: "Untitled", activityAt: 300 });
});

it("does not let an old streaming timestamp hide newer directory activity", () => {
  const agent = { title: "Current", provider: "codex", lastActivityAt: new Date(500) };
  const entries = collectOpenSessions({
    tabs: [{ tabId: "one", target: { kind: "agent", agentId: "a" }, createdAt: 1 }],
    agents: new Map([["a", agent]]),
    details: new Map(),
    activity: new Map([["a", new Date(100)]]),
    untitled: "Untitled",
  });
  expect(entries[0].activityAt).toBe(500);
});
