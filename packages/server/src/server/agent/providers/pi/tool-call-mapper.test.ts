import { describe, expect, test } from "vitest";

import { mapToolDetail, parseToolArgs, parseToolResult } from "./tool-call-mapper.js";

describe("Pi tool call mapper", () => {
  test("maps bash args and result to shell detail", () => {
    const toolCall = parseToolArgs("bash", { command: "echo hello" });
    const result = parseToolResult({ output: "hello\n", exitCode: 0 });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "shell",
      command: "echo hello",
      output: "hello\n",
      exitCode: 0,
    });
  });

  test("keeps nullable Pi optional arguments on typed read and shell cards", () => {
    expect(mapToolDetail(parseToolArgs("read", { path: "a.ts", offset: null, limit: 20 }))).toEqual(
      {
        type: "read",
        filePath: "a.ts",
        offset: undefined,
        limit: 20,
        content: undefined,
      },
    );
    expect(mapToolDetail(parseToolArgs("bash", { command: "pwd", timeout: null }))).toEqual({
      type: "shell",
      command: "pwd",
      output: undefined,
      exitCode: undefined,
    });
    expect(parseToolArgs("read", { path: null, limit: 20 })).toEqual({
      kind: "unknown",
      toolName: "read",
      args: { path: null, limit: 20 },
    });
  });

  test.each(["grep", "find", "ls"])("keeps %s RPC text content in the search detail", (name) => {
    const args = { pattern: "TODO", path: "src" };
    const result = parseToolResult({ content: [{ type: "text", text: "src/a.ts" }] });
    expect(mapToolDetail(parseToolArgs(name, args), result)).toMatchObject({
      type: "search",
      content: "src/a.ts",
    });
  });

  test("maps legacy edit args to edit detail with diff", () => {
    const toolCall = parseToolArgs("edit", {
      path: "app.ts",
      old_string: "before",
      new_string: "after",
    });
    const result = parseToolResult({ details: { diff: "-before\n+after" } });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "edit",
      filePath: "app.ts",
      oldString: "before",
      newString: "after",
      unifiedDiff: "-before\n+after",
    });
  });

  test("preserves ordinary writes as write details", () => {
    const toolCall = parseToolArgs("write", {
      path: "notes.txt",
      content: "unchanged\n",
    });

    expect(mapToolDetail(toolCall, parseToolResult({ text: "Wrote notes.txt" }))).toEqual({
      type: "write",
      filePath: "notes.txt",
      content: "unchanged\n",
    });
  });

  test("preserves unknown tool input and parsed output", () => {
    const toolCall = parseToolArgs("custom_tool", { value: 42 });
    const result = parseToolResult({ text: "custom result" });

    expect(mapToolDetail(toolCall, result)).toEqual({
      type: "unknown",
      input: { value: 42 },
      output: { text: "custom result" },
    });
  });
});
