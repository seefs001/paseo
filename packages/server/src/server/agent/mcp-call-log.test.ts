import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  McpCallLog,
  jsonRpcCalls,
  recordMcpRequestBody,
  resolveCallLabels,
} from "./mcp-call-log.js";

describe("McpCallLog", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("records calls newest first and reloads them from disk", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-mcp-calls-"));
    tempDirs.push(paseoHome);
    const log = new McpCallLog(paseoHome, undefined, { memoryLimit: 2 });
    log.record({
      callerAgentId: "agent_old",
      method: "tools/list",
      tool: null,
      ok: true,
      error: null,
      durationMs: 4,
    });
    log.record({
      callerAgentId: "agent_new",
      method: "tools/call",
      tool: "list_agents",
      ok: false,
      error: "Tool returned an error",
      durationMs: 12.8,
    });
    log.record({
      callerAgentId: null,
      method: "initialize",
      tool: null,
      ok: true,
      error: null,
      durationMs: 1,
    });

    expect((await log.list(10)).map((call) => call.method)).toEqual(["initialize", "tools/call"]);
    expect((await log.list(10))[1]).toMatchObject({
      tool: "list_agents",
      ok: false,
      durationMs: 12,
      callerAgentId: "agent_new",
    });

    await log.flush();
    const lines = readFileSync(path.join(paseoHome, "mcp-calls.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const reloaded = new McpCallLog(paseoHome, undefined, { memoryLimit: 2 });
    expect((await reloaded.list(10)).map((call) => call.method)).toEqual([
      "initialize",
      "tools/call",
    ]);
  });

  test("skips tool calls that were already recorded from execution", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-mcp-calls-"));
    tempDirs.push(paseoHome);
    const log = new McpCallLog(paseoHome);
    recordMcpRequestBody(log, {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_agents", arguments: { secret: "nope" } },
      },
      callerAgentId: "agent_1",
      labels: [],
      ok: true,
      error: null,
      durationMs: 3,
      skipToolCalls: 1,
    });
    recordMcpRequestBody(log, {
      body: [
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_agents" } },
      ],
      callerAgentId: null,
      labels: [],
      ok: false,
      error: "HTTP 500",
      durationMs: 8,
      skipToolCalls: 0,
    });

    const listed = await log.list(10);
    expect(listed.map((call) => call.method)).toEqual(["tools/call", "tools/list"]);
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(jsonRpcCalls({ method: "initialize" })).toEqual([
      { method: "initialize", tool: null, arguments: null },
    ]);
  });

  test("stores tool arguments and clips long inputs", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-mcp-calls-"));
    tempDirs.push(paseoHome);
    const log = new McpCallLog(paseoHome);
    recordMcpRequestBody(log, {
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: { path: "src/app.ts", note: "x".repeat(5_000) },
        },
      },
      callerAgentId: "agent_1",
      labels: [],
      ok: true,
      error: null,
      durationMs: 5,
      skipToolCalls: 0,
    });

    const call = (await log.list(1))[0];
    expect(call?.tool).toBe("read_file");
    expect(call?.arguments).toContain("src/app.ts");
    expect(call?.arguments?.endsWith("…")).toBe(true);
    expect(call?.arguments?.length).toBeLessThanOrEqual(4_001);
  });

  test("labels calls from the MCP URL and the caller agent, and keeps them on reload", async () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-mcp-calls-"));
    tempDirs.push(paseoHome);
    const labels = resolveCallLabels({
      connection: [" cursor ,review", "cursor", ""],
      agentLabels: {
        campaign: "launch",
        "paseo.parent-agent-id": "agent_parent",
      },
    });
    expect(labels).toEqual(["cursor", "review", "campaign=launch"]);
    expect(resolveCallLabels({ connection: "x".repeat(60), agentLabels: null })).toEqual([
      "x".repeat(48),
    ]);
    expect(resolveCallLabels({ connection: undefined, agentLabels: null })).toEqual([]);

    const log = new McpCallLog(paseoHome);
    recordMcpRequestBody(log, {
      body: { jsonrpc: "2.0", id: 5, method: "tools/list" },
      callerAgentId: "agent_1",
      labels,
      ok: true,
      error: null,
      durationMs: 2,
      skipToolCalls: 0,
    });
    log.record({
      callerAgentId: null,
      method: "initialize",
      tool: null,
      ok: true,
      error: null,
      durationMs: 1,
      labels: [],
    });
    await log.flush();

    const reloaded = await new McpCallLog(paseoHome).list(10);
    expect(reloaded.map((call) => call.labels)).toEqual([
      undefined,
      ["cursor", "review", "campaign=launch"],
    ]);
  });
});
