import { describe, expect, it } from "vitest";
import {
  AgentSkillsSaveSelectionRequestSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("agent skills protocol", () => {
  it("accepts host skill discovery without an agent and bounds usage records", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "skills.list.request",
        requestId: "catalog",
      }).success,
    ).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "skills.usage.record.request",
        requestId: "usage",
        submissionId: "message-1",
        paths: ["/skills/review/SKILL.md"],
      }).success,
    ).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "skills.usage.record.request",
        requestId: "usage",
        submissionId: "",
        paths: [],
      }).success,
    ).toBe(false);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "skills.list.response",
        payload: {
          requestId: "catalog",
          directory: "/home/user/.agents/skills",
          skipped: 0,
          skills: [
            {
              path: "/skills/review/SKILL.md",
              name: "review",
              description: "Review changes",
              usageCount: 2,
              lastUsedAt: 1,
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "old", features: {} })
        .features.skillCatalog,
    ).toBeUndefined();
  });

  it("parses dotted selection requests and confirmation", () => {
    expect(
      AgentSkillsSaveSelectionRequestSchema.parse({
        type: "agent.skills.save_selection.request",
        requestId: "request-1",
        selection: { mode: "custom", skills: ["paseo"] },
        confirmedRemovals: ["paseo-loop"],
      }),
    ).toMatchObject({ requestId: "request-1" });
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.skills.get_status.request",
        requestId: "request-2",
      }).success,
    ).toBe(true);
  });

  it("parses status responses and keeps the capability optional", () => {
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "agent.skills.get_status.response",
        payload: {
          requestId: "request-3",
          state: "not-installed",
          ops: [{ kind: "add", name: "paseo" }],
          available: ["paseo"],
          installed: [],
          selection: { mode: "all" },
        },
      }).success,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-daemon",
        features: {},
      }).features.skillManagement,
    ).toBeUndefined();
  });
});
