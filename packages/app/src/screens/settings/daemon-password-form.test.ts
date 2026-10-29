import { describe, expect, it } from "vitest";
import { passwordDraftError } from "./daemon-password-form";

describe("password draft", () => {
  it("requires a password and a matching confirmation", () => {
    expect(passwordDraftError("", "")).toBe("empty");
    expect(passwordDraftError("secret", "other")).toBe("mismatch");
    expect(passwordDraftError("secret", "secret")).toBeNull();
  });
});
