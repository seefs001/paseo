import { describe, expect, test } from "vitest";
import { parseGrokTurnUsage } from "./grok-usage.js";

describe("Grok turn usage", () => {
  test("reports average output speed for the matching turn, including API waiting time", () => {
    expect(
      parseGrokTurnUsage({
        method: "_x.ai/session_notification",
        params: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "turn_completed",
            prompt_id: "turn-1",
            usage: { outputTokens: 250, apiDurationMs: 2_000 },
          },
        },
        sessionId: "session-1",
        turnId: "turn-1",
      }),
    ).toEqual({ outputTokensPerSecond: 125 });
  });

  test.each([
    { usage: { outputTokens: 0, apiDurationMs: 2_000 }, expected: 0 },
    { usage: { outputTokens: 250, apiDurationMs: 0 }, expected: null },
    { usage: { outputTokens: 250 }, expected: null },
    { usage: { apiDurationMs: 2_000 }, expected: null },
    { usage: null, expected: null },
    { usage: undefined, expected: null },
    { usage: { outputTokens: 250, apiDurationMs: 2_000, usageIsIncomplete: true }, expected: null },
  ])(
    "does not invent a speed from unavailable or incomplete timing: $usage",
    ({ usage, expected }) => {
      expect(
        parseGrokTurnUsage({
          method: "_x.ai/session_notification",
          params: {
            sessionId: "session-1",
            update: { sessionUpdate: "turn_completed", prompt_id: "turn-1", usage },
          },
          sessionId: "session-1",
          turnId: "turn-1",
        }),
      ).toEqual({ outputTokensPerSecond: expected });
    },
  );

  test.each([
    { outputTokens: -1, apiDurationMs: 1_000 },
    { outputTokens: 10, apiDurationMs: -1 },
    { outputTokens: "250", apiDurationMs: 2_000 },
    { outputTokens: 250, apiDurationMs: Infinity },
    { outputTokens: NaN, apiDurationMs: 2_000 },
  ])("ignores malformed usage: %j", (usage) => {
    expect(
      parseGrokTurnUsage({
        method: "_x.ai/session_notification",
        params: {
          sessionId: "session-1",
          update: { sessionUpdate: "turn_completed", prompt_id: "turn-1", usage },
        },
        sessionId: "session-1",
        turnId: "turn-1",
      }),
    ).toBeNull();
  });

  test("ignores other methods, sessions, replayed turns and duplicates do not accumulate", () => {
    const notification = {
      method: "_x.ai/session_notification",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "turn_completed",
          prompt_id: "turn-1",
          usage: { outputTokens: 250, apiDurationMs: 2_000 },
        },
      },
      sessionId: "session-1",
      turnId: "turn-1",
    };
    expect(
      parseGrokTurnUsage({ ...notification, method: "other/session_notification" }),
    ).toBeNull();
    expect(parseGrokTurnUsage({ ...notification, sessionId: "other-session" })).toBeNull();
    expect(parseGrokTurnUsage({ ...notification, turnId: null })).toBeNull();
    expect(parseGrokTurnUsage({ ...notification, turnId: "next-turn" })).toBeNull();
    expect(parseGrokTurnUsage(notification)).toEqual({ outputTokensPerSecond: 125 });
    expect(parseGrokTurnUsage(notification)).toEqual({ outputTokensPerSecond: 125 });
  });
});
