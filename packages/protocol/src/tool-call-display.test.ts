import { describe, expect, it } from "vitest";

import { buildToolCallDisplayModel } from "./tool-call-display.js";
import { buildPiToolCallMetadata } from "./pi-tool-presentation.js";

describe("shared tool-call display mapping", () => {
  it.each([
    ["read", { path: "/repo/src/a.ts", offset: 10, limit: 20 }, "src/a.ts · lines 10–29"],
    ["read", { path: "/repo/src/a.ts", offset: null, limit: 1 }, "src/a.ts · line 1"],
    ["read", { path: "/repo/src/a.ts", offset: 10 }, "src/a.ts · from line 10"],
    ["bash", { command: "git status", timeout: 30 }, "git status · timeout 30s"],
    ["bash", { command: "pwd", timeout: null }, "pwd"],
    [
      "edit",
      {
        path: "/repo/a.ts",
        edits: [
          { oldText: "a", newText: "b" },
          { oldText: "c", newText: "d" },
        ],
      },
      "a.ts · 2 edits",
    ],
    ["write", { path: "/repo/a.ts", content: "a\nb\n" }, "a.ts · 2 lines"],
    ["write", { path: "/repo/a.ts", content: "\n" }, "a.ts · 1 line"],
    ["write", { path: "/repo/a.ts", content: "" }, "a.ts · 0 lines"],
    [
      "grep",
      { pattern: "TODO", path: "/repo/src", glob: "*.ts", ignoreCase: true },
      "TODO · src · *.ts · ignore case",
    ],
    ["find", { pattern: "*.ts", path: "/repo/src" }, "*.ts · src"],
    ["ls", { path: "/repo", limit: 20 }, ". · limit 20"],
    ["tool_search", { query: "paseo agents", limit: 3 }, "paseo agents · limit 3"],
    ["web_search", { queries: ["Pi RPC", "Pi tools"] }, "Pi RPC · Pi tools"],
    ["web_search", { query: "Pi RPC", numResults: 5 }, "Pi RPC · 5 results"],
    [
      "fetch_content",
      { urls: ["https://pi.dev", "https://paseo.sh"] },
      "https://pi.dev · https://paseo.sh",
    ],
    [
      "get_search_content",
      { responseId: "search-1", url: "https://pi.dev", offset: 0, limit: 100 },
      "https://pi.dev · chars 0–99",
    ],
    ["source_check", { claim: "Pi supports RPC" }, "Pi supports RPC"],
  ])("promotes fixed Pi %s arguments into the collapsed summary", (name, args, summary) => {
    const detail = { type: "unknown", input: args, output: null } as const;
    const display = buildToolCallDisplayModel({
      name,
      status: "running",
      error: null,
      detail,
      metadata: buildPiToolCallMetadata(name, args),
      cwd: "/repo",
    });
    expect(display.summary).toBe(summary);
    expect(detail.input).toEqual(args);
  });

  it("bounds header text without putting full commands into metadata", () => {
    const command = "x".repeat(1000);
    expect(buildPiToolCallMetadata("bash", { command })).toEqual({
      piToolSummary: [{ kind: "text", value: `${"x".repeat(239)}…` }],
    });
  });

  it("ignores malformed Pi presentation metadata", () => {
    expect(
      buildToolCallDisplayModel({
        name: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath: "a.ts" },
        metadata: { piToolSummary: [{ kind: "secret", value: "hidden" }] },
      }),
    ).toEqual({ displayName: "Read", summary: "a.ts" });
  });

  it("does not promote arbitrary extension arguments or script source", () => {
    expect(buildPiToolCallMetadata("custom_tool", { query: "secret", token: "secret" })).toEqual(
      {},
    );
    expect(buildPiToolCallMetadata("codemode", { code: "secret" })).toEqual({});
    expect(buildPiToolCallMetadata("read", { path: 42, limit: -1 })).toEqual({});
  });

  it("keeps Pi metadata on typed cards without changing their name or error", () => {
    expect(
      buildToolCallDisplayModel({
        name: "read",
        status: "failed",
        error: "File not found",
        detail: { type: "read", filePath: "/repo/a.ts", offset: 10, limit: 20 },
        metadata: buildPiToolCallMetadata("read", { path: "/repo/a.ts", offset: 10, limit: 20 }),
        cwd: "/repo",
      }),
    ).toEqual({ displayName: "Read", summary: "a.ts · lines 10–29", errorText: "File not found" });
  });

  it("builds summary from canonical detail", () => {
    const display = buildToolCallDisplayModel({
      name: "read_file",
      status: "running",
      error: null,
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
      },
      cwd: "/tmp/repo",
    });

    expect(display).toEqual({
      displayName: "Read",
      summary: "src/index.ts",
    });
  });

  it("does not infer summaries from unknown raw detail", () => {
    const display = buildToolCallDisplayModel({
      name: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: { command: "npm test" },
        output: null,
      },
    });

    expect(display).toEqual({
      displayName: "Exec command",
    });
  });

  it("uses sub-agent detail for task label and description", () => {
    const display = buildToolCallDisplayModel({
      name: "task",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        log: "[Read] README.md",
      },
    });

    expect(display).toEqual({
      displayName: "Explore",
      summary: "Inspect repository structure",
    });
  });

  it("builds display model for worktree setup detail", () => {
    const display = buildToolCallDisplayModel({
      name: "paseo_worktree_setup",
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/tmp/repo/.paseo/worktrees/repo/branch",
        branchName: "feature-branch",
        log: "==> [1/1] Running: npm install\n",
        commands: [
          {
            index: 1,
            command: "npm install",
            cwd: "/tmp/repo/.paseo/worktrees/repo/branch",
            log: "==> [1/1] Running: npm install\n",
            status: "running",
            exitCode: null,
          },
        ],
      },
    });

    expect(display).toEqual({
      displayName: "Worktree setup",
      summary: "feature-branch",
    });
  });

  it("provides errorText for failed calls", () => {
    const display = buildToolCallDisplayModel({
      name: "shell",
      status: "failed",
      error: { message: "boom" },
      detail: {
        type: "unknown",
        input: null,
        output: null,
      },
    });

    expect(display.errorText).toBe('{\n  "message": "boom"\n}');
  });

  it("labels terminal interaction rows without a summary when no command is available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
    });
  });

  it("uses the command as terminal interaction summary when available", () => {
    const display = buildToolCallDisplayModel({
      name: "terminal",
      status: "completed",
      error: null,
      detail: {
        type: "plain_text",
        label: "npm run test",
        icon: "square_terminal",
      },
    });

    expect(display).toEqual({
      displayName: "Terminal",
      summary: "npm run test",
    });
  });

  it("shows a match count instead of a long search pattern", () => {
    const pattern = "function buildSearchAcpToolDetail|function resolveToolCallName";
    const display = buildToolCallDisplayModel({
      name: "search",
      status: "completed",
      error: null,
      detail: {
        type: "search",
        query: pattern,
        toolName: "grep",
        content: "found 5 matches",
        filePaths: ["packages/server/src/server/agent/providers/acp-agent.ts"],
      },
    });

    expect(display).toEqual({
      displayName: "Search",
      summary: "5 matches · acp-agent.ts",
    });
  });

  it("reads the query out of a Search tools title", () => {
    const display = buildToolCallDisplayModel({
      name: 'Search tools: "paseo list agents"',
      status: "completed",
      error: null,
      detail: {
        type: "unknown",
        input: { query: "paseo list agents", limit: 5, variant: "Search" },
        output: { type: "SearchTool", result_count: 1, content: '{"results":[]}' },
      },
    });

    expect(display).toEqual({
      displayName: "Search",
      summary: "paseo list agents",
    });
  });

  it("humanizes two-segment MCP tool names", () => {
    const display = buildToolCallDisplayModel({
      name: "nowledge-mem__memory_search",
      status: "completed",
      error: null,
      detail: { type: "unknown", input: { query: "paseo" }, output: null },
      metadata: { summary: "paseo" },
    });

    expect(display).toEqual({
      displayName: "Nowledge mem memory search",
      summary: "paseo",
    });
  });

  it("humanizes Paseo MCP tool names (Claude Code format)", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__paseo__create_agent",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create agent");
  });

  it("humanizes Paseo MCP tool names (Codex format)", () => {
    const display = buildToolCallDisplayModel({
      name: "paseo.create_agent",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Create agent");
  });

  it("humanizes list_agents Paseo tool", () => {
    const display = buildToolCallDisplayModel({
      name: "mcp__paseo__list_agents",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("List agents");
  });

  it("does not override speak tool display name", () => {
    const display = buildToolCallDisplayModel({
      name: "speak",
      status: "running",
      error: null,
      detail: { type: "unknown", input: null, output: null },
    });
    expect(display.displayName).toBe("Speak");
  });

  it("labels plan detail rows as Plan", () => {
    const display = buildToolCallDisplayModel({
      name: "plan",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "### Login Screen\n- Build layout",
      },
    });

    expect(display).toEqual({
      displayName: "Plan",
    });
  });
});
