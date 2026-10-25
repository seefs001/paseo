import { describe, expect, it } from "vitest";
import {
  CustomCommandSchema,
  CustomCommandValidationError,
  getCustomCommandNameError,
  normalizeCustomCommandName,
  normalizeCustomCommands,
  upsertCustomCommand,
  validateCustomCommand,
  type CustomCommand,
} from "./model";

const review: CustomCommand = {
  id: "review-1",
  name: "review",
  description: "Review changes",
  prompt: "Review the current changes",
  autoSend: false,
};

describe("custom command names", () => {
  it("removes leading slashes and surrounding whitespace without changing case or Chinese", () => {
    expect(normalizeCustomCommandName("  /检查代码  ")).toBe("检查代码");
    expect(normalizeCustomCommandName(" /Review ")).toBe("Review");
    expect(getCustomCommandNameError("检查代码")).toBe(null);
  });

  it.each(["", "/", "  "])("requires a name: %j", (name) => {
    expect(getCustomCommandNameError(name)).toBe("nameRequired");
  });

  it.each(["two words", "two\twords", "two\nwords", "some/name", 'a"b', "a'b"])(
    "rejects whitespace, slashes, and quotes: %j",
    (name) => {
      expect(getCustomCommandNameError(name)).toBe("nameInvalid");
    },
  );

  it.each(["exit", "quit", "q", "clear", "new", "share", "SHARE", "Share", "/EXIT"])(
    "reserves built-in names and aliases: %j",
    (name) => {
      expect(getCustomCommandNameError(name)).toBe("nameReserved");
    },
  );

  it("rejects a duplicate but lets an existing command keep its name and preserves case sensitivity", () => {
    expect(validateCustomCommand({ command: review, commands: [review] })).toEqual({});
    expect(
      validateCustomCommand({
        command: { ...review, id: "other", name: " /review " },
        commands: [review],
      }),
    ).toEqual({ name: "nameDuplicate" });
    expect(
      validateCustomCommand({
        command: { ...review, id: "other", name: "Review" },
        commands: [review],
      }),
    ).toEqual({});
  });
});

describe("custom command records", () => {
  it("defaults auto-send off and description empty while preserving prompt formatting", () => {
    expect(
      CustomCommandSchema.parse({
        id: "id-1",
        name: " /总结 ",
        prompt: "\n  Summarize\n  changes\n",
      }),
    ).toEqual({
      id: "id-1",
      name: "总结",
      prompt: "\n  Summarize\n  changes\n",
      description: "",
      autoSend: false,
    });
  });

  it("creates, edits, and renames a command without replacing its id or neighboring commands", () => {
    const commands = upsertCustomCommand({ command: review, commands: [] });
    const next = upsertCustomCommand({
      command: { ...review, id: "second", name: "总结" },
      commands,
    });
    const edited = { ...review, name: " /Review ", prompt: "Review tests", autoSend: true };
    expect(upsertCustomCommand({ command: edited, commands: next })).toEqual([
      { ...edited, name: "Review" },
      { ...review, id: "second", name: "总结" },
    ]);
  });

  it("returns actionable validation for a blank prompt and rejects invalid saves", () => {
    expect(
      validateCustomCommand({ command: { ...review, prompt: " \n\t" }, commands: [] }),
    ).toEqual({ prompt: "promptRequired" });
    expect(() =>
      upsertCustomCommand({ command: { ...review, name: "share" }, commands: [] }),
    ).toThrow(CustomCommandValidationError);
  });

  it("loads valid persisted commands without accepting reserved, invalid, or duplicate records", () => {
    expect(
      normalizeCustomCommands([
        review,
        { ...review, id: "duplicate-name" },
        { ...review, name: "same-id" },
        { ...review, id: "reserved", name: "SHARE" },
        { ...review, id: "invalid", prompt: " " },
        { ...review, id: "bad-toggle", name: "toggle", autoSend: "true" },
        { id: "chinese", name: "/总结", prompt: "总结改动" },
        null,
      ]),
    ).toEqual([
      review,
      { id: "chinese", name: "总结", description: "", prompt: "总结改动", autoSend: false },
    ]);
    expect(normalizeCustomCommands({ commands: [review] })).toEqual([]);
  });
});
