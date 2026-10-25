import { describe, expect, it } from "vitest";
import type { CustomCommand } from "./model";
import { expandCustomCommand, expandSelectedCustomCommand } from "./expand";
import { findActiveSlashCommand } from "@/utils/agent-command-autocomplete";

const review: CustomCommand = {
  id: "review-id",
  name: "review",
  description: "Review the changes",
  prompt: "Review the current changes.\nList actionable findings.",
  autoSend: false,
};

describe("custom command expansion", () => {
  it("expands an explicit command and preserves trailing context", () => {
    expect(
      expandCustomCommand({ text: "  /review focus on auth\nKeep it brief.", commands: [review] }),
    ).toEqual({
      command: review,
      text: `  ${review.prompt} focus on auth\nKeep it brief.`,
    });
  });

  it.each(["/rev", "/reviewer", "/Review", "/review/path", "Discuss /review", "https://review"])(
    "does not expand %s",
    (text) => {
      expect(expandCustomCommand({ text, commands: [review] })).toBeNull();
    },
  );

  it("does not recursively expand slash commands inside a configured prompt", () => {
    const command = { ...review, prompt: "/review and /quit are examples." };
    expect(expandCustomCommand({ text: "/review", commands: [command] })).toEqual({
      command,
      text: command.prompt,
    });
  });

  it("supports Unicode command names and multiline prompts", () => {
    const command = { ...review, name: "审查" };
    expect(expandCustomCommand({ text: "/审查", commands: [command] })).toEqual({
      command,
      text: command.prompt,
    });
  });

  it("expands a selected partial command without discarding surrounding text", () => {
    const text = "/rev additional context";
    const range = findActiveSlashCommand({ text, cursorIndex: 4 });
    if (!range) throw new Error("Expected an active slash command");
    expect(expandSelectedCustomCommand({ text, range, command: review })).toBe(
      `${review.prompt} additional context`,
    );
  });

  it("replaces the whole command token when the caret is inside it", () => {
    const text = "/review additional context";
    const range = findActiveSlashCommand({ text, cursorIndex: 4 });
    if (!range) throw new Error("Expected an active slash command");
    expect(expandSelectedCustomCommand({ text, range, command: review })).toBe(
      `${review.prompt} additional context`,
    );
  });
});
