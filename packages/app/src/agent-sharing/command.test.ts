import { describe, expect, test } from "vitest";
import { parseSessionShareCommand, supportsSessionShareCommand } from "./command";

describe("session share command", () => {
  test("intercepts Pi on old hosts so feature gating cannot fall back to chat", () => {
    const capabilities = {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    };
    expect(supportsSessionShareCommand({ provider: "pi", capabilities })).toBe(true);
    expect(supportsSessionShareCommand({ provider: "claude", capabilities })).toBe(false);
    expect(supportsSessionShareCommand(null)).toBe(false);
  });
  test.each(["/share", " /share ", "/SHARE"])("opens the dialog for %s", (text) => {
    expect(parseSessionShareCommand({ text, enabled: true, hasAttachments: false })).toEqual({
      args: "",
    });
  });

  test("keeps invalid arguments inside the dialog instead of submitting a prompt", () => {
    expect(
      parseSessionShareCommand({ text: "/share public", enabled: true, hasAttachments: false }),
    ).toEqual({ args: "public" });
  });

  test.each([
    { text: "/share-other", enabled: true, hasAttachments: false },
    { text: "explain /share", enabled: true, hasAttachments: false },
    { text: "/share", enabled: false, hasAttachments: false },
    { text: "/share", enabled: true, hasAttachments: true },
  ])("does not intercept unrelated or unsupported submissions: %j", (input) => {
    expect(parseSessionShareCommand(input)).toBeNull();
  });
});
