import { describe, expect, test } from "vitest";
import { resolveParentAgentTarget } from "./parent-target";

describe("parent agent navigation", () => {
  test("uses the managed parent ID without assuming its workspace", () => {
    expect(
      resolveParentAgentTarget({
        target: { kind: "agent", agentId: "child" },
        parentAgentId: "parent",
        parentSubagentId: undefined,
      }),
    ).toEqual({ kind: "agent", agentId: "parent" });
  });

  test("hides navigation for root and detached agents", () => {
    expect(
      resolveParentAgentTarget({
        target: { kind: "agent", agentId: "root" },
        parentAgentId: null,
        parentSubagentId: undefined,
      }),
    ).toBeNull();
  });

  test.each([
    { parentSubagentId: undefined, expected: null },
    { parentSubagentId: null, expected: { kind: "agent", agentId: "root" } },
    {
      parentSubagentId: "direct-parent",
      expected: {
        kind: "provider_subagent",
        parentAgentId: "root",
        subagentId: "direct-parent",
      },
    },
  ])("resolves provider parent $parentSubagentId", ({ parentSubagentId, expected }) => {
    expect(
      resolveParentAgentTarget({
        target: { kind: "provider_subagent", parentAgentId: "root", subagentId: "child" },
        parentAgentId: null,
        parentSubagentId,
      }),
    ).toEqual(expected);
  });
});
