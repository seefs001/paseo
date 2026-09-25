import { expect, it } from "vitest";
import { createSidebarRecencySelector } from "./sidebar-recency";

function fixture() {
  const workspaces = new Map(
    ["a", "b"].map((id) => [
      `srv:${id}`,
      { workspaceKey: `srv:${id}`, serverId: "srv", statusEnteredAt: null },
    ]),
  );
  const a = {
    id: "agent-a",
    workspaceId: "a",
    updatedAt: new Date(10),
    lastActivityAt: new Date(10),
    archivedAt: null,
  };
  const b = {
    ...a,
    id: "agent-b",
    workspaceId: "b",
    updatedAt: new Date(20),
    lastActivityAt: new Date(20),
  };
  const host = {
    agents: new Map([
      [a.id, a],
      [b.id, b],
    ]),
    agentDetails: new Map(),
  };
  return {
    a,
    b,
    host,
    selector: createSidebarRecencySelector(workspaces),
    state: { sessions: { srv: host }, agentLastActivity: new Map<string, Date>() },
  };
}

it("reorders on metadata updates without requiring a status transition", () => {
  const { selector, state, host, a, b } = fixture();
  expect([...selector(state)]).toEqual([
    ["srv:b", 1],
    ["srv:a", 2],
  ]);
  const updatedHost = {
    ...host,
    agents: new Map([
      [a.id, { ...a, updatedAt: new Date(30) }],
      [b.id, b],
    ]),
  };
  expect([...selector({ ...state, sessions: { srv: updatedHost } })]).toEqual([
    ["srv:a", 1],
    ["srv:b", 2],
  ]);
});

it("uses streamed activity and preserves the rank reference while the order stays the same", () => {
  const { selector, state, a } = fixture();
  const first = selector(state);
  expect(selector({ ...state })).toBe(first);
  const streamed = selector({ ...state, agentLastActivity: new Map([[a.id, new Date(30)]]) });
  expect([...streamed]).toEqual([
    ["srv:a", 1],
    ["srv:b", 2],
  ]);
  expect(selector({ ...state, agentLastActivity: new Map([[a.id, new Date(40)]]) })).toBe(streamed);
});

it("does not let stale details, unrelated workspaces or archived sessions override current recency", () => {
  const { selector, state, host, a } = fixture();
  const details = new Map([
    [a.id, { ...a, updatedAt: new Date(1), lastActivityAt: new Date(1) }],
    ["outside", { ...a, id: "outside", workspaceId: "other", updatedAt: new Date(100) }],
    ["archived", { ...a, id: "archived", updatedAt: new Date(200), archivedAt: new Date(200) }],
  ]);
  const changed = { ...state, sessions: { srv: { ...host, agentDetails: details } } };
  expect([...selector(changed)]).toEqual([
    ["srv:b", 1],
    ["srv:a", 2],
  ]);
});
