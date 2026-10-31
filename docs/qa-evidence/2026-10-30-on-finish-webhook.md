# MCP finish webhook QA

Date: 2026-10-30. Branch: `feat/on-finish-webhook`, base: `dev`.
Environment: macOS, Node v26.12.0, Bun 1.4.2.

## Scope and result

**PASS.** An isolated daemon received real MCP HTTP requests and posted to a real loopback HTTP
server. Only the provider was the repository's deterministic fake provider. No production daemon,
Grok endpoint, credentials, or port 6767 were used.

The script checked:

- Both tool schemas expose optional callback fields; create and follow-up send use request overrides
  or the daemon environment default.
- Payload metadata, current-turn response, 4,000-character cap, optional reply recipient, distinct
  run IDs, and repeated state updates.
- `idle`, `error`, error recovery without a stale error callback, and
  `pendingPermissions → idle → closed`.
- Actual 503 responses retry with identical body and idempotency key, 1s/2s delays, and a three-attempt
  limit. The agent stays idle while delivery retries. Redirects are rejected.
- Closing the MCP connection does not lose a callback. A later dispatch without a URL or default
  removes the prior callback.
- Plain HTTP without the explicit loopback switch is rejected before creation; remote routing is
  rejected when a callback is requested. The query sentinel never appears in MCP or daemon logs.
- Existing agent-scoped `notifyOnFinish` still dispatches the child's response to the parent.

The first check exposed adjacent turns being concatenated by the generic last-response reader.
The callback now reads the reported turn from the live timeline tail. No existing reader changed.

## Recorded output

```text
PASS schema, create/send, default/override, payload, dedup, distinct turns
PASS error, pendingPermissions -> idle -> closed, status dedup
PASS real HTTP 503 retries (1s/2s), stable body/key, 3-attempt bound, nonblocking, redirects rejected
PASS 4k cap, callback after MCP disconnect, omitted/default-free dispatch clears callback
PASS HTTPS validation before creation, remote rejection, MCP/debug/delivery log secret redaction
PASS existing agent-scoped notifyOnFinish
{
  "result": "PASS",
  "posts": 19,
  "sample": {
    "event": "agent.finish",
    "source": "paseo",
    "agentId": "ca84227a-ed19-4c23-b273-4880f5839cd4",
    "status": "idle",
    "runId": "fake-turn-0",
    "finishedAt": "2026-10-30T18:27:27.065Z",
    "lastResponse": "webhook done",
    "title": "Webhook QA",
    "workspaceId": "wks_56236da6f725f383",
    "serverId": "srv_rNncwxrgzNeY",
    "replyToAgentId": "SeefsBot"
  },
  "retryGapsMs": [
    1002,
    2003
  ]
}
```

## Existing checks

From the repository root:

```bash
bun run --cwd packages/server typecheck
bun run lint -- packages/server/src/server/agent/finish-webhooks.ts packages/server/src/server/agent/tools/paseo-tools.ts packages/server/src/server/agent/mcp-call-log.ts packages/server/src/server/bootstrap.ts
bun run format:check:files -- packages/server/src/server/agent/finish-webhooks.ts packages/server/src/server/agent/tools/paseo-tools.ts packages/server/src/server/agent/mcp-call-log.ts packages/server/src/server/bootstrap.ts FORK-CHANGELOG.md public-docs/mcp.md public-docs/mcp.zh-CN.md docs/qa-evidence/2026-10-30-on-finish-webhook.md
```

Server typecheck passed; lint reported zero warnings/errors. Formatting passed.
The pre-commit hook also ran the full workspace typecheck successfully (10.94 seconds).

After transferring the change to `dev`, the server stack build passed in
`/Users/seefs/work/paseo` with `npm run build:server`. Compiled MCP tool definitions include both
callback parameters, and `dist/server/server/agent/finish-webhooks.js` was generated.
Use the repository's native npm workspace runner for this build: Bun's command rewriting recursed,
and pnpm 12 attempted an automatic dependency installation that failed on an app patch. The affected
local dependencies were restored from the validated same-base worktree, with backups retained; no
package manifest or lockfile changes are included.

From `packages/server`:

```bash
../../node_modules/.bin/vitest run src/server/agent/mcp-server.test.ts --bail=1
../../node_modules/.bin/vitest run src/server/agent/mcp-call-log.test.ts --bail=1
```

Results: **194/194** MCP tests and **4/4** call-log tests passed. No test files changed, no new
unit/integration suite was added, and the full repository suite was not run.

## Reproduce the ad-hoc check

Use an installed checkout with workspace declarations built. Run from the repository root.
The script creates temporary daemon state and closes it in `finally`. It uses only a fake query key.

Extract the TypeScript block below into a scratch file:

```bash
mkdir -p .tmp
QA_SCRIPT=$(mktemp "$PWD/.tmp/webhook-qa-XXXXXX.mts")
python3 - "$QA_SCRIPT" <<'PY'
from pathlib import Path
import sys
text = Path("docs/qa-evidence/2026-10-30-on-finish-webhook.md").read_text()
script = text.split("\x60\x60\x60typescript\n", 1)[1].split("\n\x60\x60\x60", 1)[0]
Path(sys.argv[1]).write_text(script)
PY
node --import tsx "$QA_SCRIPT"
```

```typescript
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { Writable } from "node:stream";
import pino from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestPaseoDaemon } from "../packages/server/src/server/test-utils/paseo-daemon.js";
import { createTestAgentClients } from "../packages/server/src/server/test-utils/fake-agent-client.js";
import { getMcpCallLog } from "../packages/server/src/server/agent/mcp-call-log.js";

const received: { path: string; body: any; raw: string; key: string; at: number }[] = [];
const logs: string[] = [];
const parentPrompts: string[] = [];
const logger = pino(
  { level: "debug" },
  new Writable({
    write(chunk, _, next) {
      logs.push(chunk.toString());
      next();
    },
  }),
);
let releaseHeld!: () => void;
const held = new Promise<void>((resolve) => {
  releaseHeld = resolve;
});
const mock = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["content-type"], "application/json");
  const path = new URL(req.url!, "http://localhost").pathname;
  received.push({
    path,
    body: JSON.parse(raw),
    raw,
    key: String(req.headers["idempotency-key"]),
    at: Date.now(),
  });
  const count = received.filter((entry) => entry.path === path).length;
  if (path === "/fail" || (path === "/retry" && count < 3)) res.writeHead(503);
  else if (path === "/redirect")
    res.writeHead(302, { location: `http://127.0.0.1:${port}/redirect-target` });
  else res.writeHead(204);
  res.end();
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const port = (mock.address() as { port: number }).port;
const callback = (path: string) => `http://127.0.0.1:${port}${path}?key=QA_ONLY_SECRET`;
process.env.PASEO_ON_FINISH_WEBHOOK_ALLOW_HTTP_LOCALHOST = "1";
process.env.PASEO_ON_FINISH_WEBHOOK = callback("/default");
const daemon = await createTestPaseoDaemon({
  logger,
  mcpDebug: true,
  agentClients: createTestAgentClients({
    onStartTurn(prompt, config) {
      if (config.title === "Notify parent" && typeof prompt === "string")
        parentPrompts.push(prompt);
    },
    beforeTurnComplete: async (prompt) => {
      if (prompt === "hold for disconnect") await held;
    },
  }),
});
const manager = daemon.daemon.agentManager;
let client: Client;
const connect = async (callerAgentId?: string) => {
  const c = new Client({ name: "webhook-qa", version: "1.0.0" });
  const url = new URL(`http://127.0.0.1:${daemon.port}/mcp/agents`);
  if (callerAgentId) url.searchParams.set("callerAgentId", callerAgentId);
  await c.connect(new StreamableHTTPClientTransport(url));
  return c;
};
async function call(name: string, args: Record<string, unknown>, c = client) {
  const r = await c.callTool({ name, arguments: args });
  assert.notEqual(r.isError, true, JSON.stringify(r));
  return r.structuredContent as Record<string, any>;
}
async function waitFor(check: () => unknown, label: string) {
  const deadline = Date.now() + 12_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timeout: ${label}`);
    await pause(25);
  }
}
const events = (id: string, status: string) =>
  received.filter((entry) => entry.body.agentId === id && entry.body.status === status);
try {
  client = await connect();
  const { tools } = await client.listTools();
  for (const name of ["create_agent", "send_agent_prompt"]) {
    const schema = tools.find((tool) => tool.name === name)!.inputSchema;
    assert.equal((schema.properties!.onFinishWebhook as any).type, "string");
    assert.ok(!schema.required?.includes("onFinishWebhook"));
  }
  const workspace = await call("create_workspace", { isolation: "local", path: daemon.staticDir });
  const create = (extra = {}) =>
    call("create_agent", {
      provider: "claude/claude-test-model",
      title: "Webhook QA",
      workspaceId: workspace.workspaceId,
      initialPrompt: "respond with exactly: webhook done",
      settings: { modeId: "bypassPermissions" },
      ...extra,
    });
  const a = await create({ onFinishWebhook: callback("/override"), replyToAgentId: "SeefsBot" });
  await waitFor(() => events(a.agentId, "idle").length === 1, "creation callback");
  const first = events(a.agentId, "idle")[0]!;
  assert.equal(first.path, "/override");
  assert.equal(first.body.lastResponse, "webhook done");
  assert.equal(first.body.replyToAgentId, "SeefsBot");
  assert.equal(first.body.source, "paseo");
  assert.equal(first.body.event, "agent.finish");
  assert.equal(first.body.title, "Webhook QA");
  assert.equal(first.body.workspaceId, workspace.workspaceId);
  assert.ok(first.body.serverId);
  assert.equal(new Date(first.body.finishedAt).toISOString(), first.body.finishedAt);
  for (let i = 0; i < 10; i++) manager.notifyAgentState(a.agentId);
  await pause(100);
  assert.equal(events(a.agentId, "idle").length, 1);
  await call("send_agent_prompt", {
    agentId: a.agentId,
    prompt: "respond with exactly: default callback",
  });
  await waitFor(() => events(a.agentId, "idle").length === 2, "follow-up default");
  const second = events(a.agentId, "idle")[1]!;
  assert.equal(second.path, "/default");
  assert.equal(second.body.lastResponse, "default callback");
  assert.notEqual(first.body.runId, second.body.runId);
  assert.ok(!("replyToAgentId" in second.body));
  const defaultCreate = await create();
  await waitFor(() => events(defaultCreate.agentId, "idle").length === 1, "create default");
  assert.equal(events(defaultCreate.agentId, "idle")[0]!.path, "/default");
  console.log("PASS schema, create/send, default/override, payload, dedup, distinct turns");

  await call("send_agent_prompt", {
    agentId: a.agentId,
    prompt: "emit a turn failure",
    onFinishWebhook: callback("/error"),
  });
  await waitFor(() => events(a.agentId, "error").length === 1, "error callback");
  manager.notifyAgentState(a.agentId);
  await call("send_agent_prompt", {
    agentId: a.agentId,
    prompt: "respond with exactly: recovered",
    onFinishWebhook: callback("/recovered"),
  });
  await waitFor(() => events(a.agentId, "idle").length === 3, "error recovery completion");
  assert.equal(events(a.agentId, "error").length, 1);
  const p = await create({
    initialPrompt: "Run echo hello",
    settings: { modeId: "default" },
    onFinishWebhook: callback("/permission"),
  });
  await waitFor(() => events(p.agentId, "pendingPermissions").length === 1, "permission callback");
  for (let i = 0; i < 10; i++) manager.notifyAgentState(p.agentId);
  await pause(100);
  assert.equal(events(p.agentId, "pendingPermissions").length, 1);
  const request = [...manager.getAgent(p.agentId)!.pendingPermissions.keys()][0]!;
  await manager.respondToPermission(p.agentId, request, { behavior: "allow" });
  await waitFor(() => events(p.agentId, "idle").length === 1, "post-permission completion");
  assert.equal(
    events(p.agentId, "idle")[0]!.body.runId,
    events(p.agentId, "pendingPermissions")[0]!.body.runId,
  );
  await manager.closeAgent(p.agentId);
  await waitFor(() => events(p.agentId, "closed").length === 1, "closed callback");
  manager.notifyAgentState(p.agentId);
  console.log("PASS error, pendingPermissions -> idle -> closed, status dedup");

  const retry = await create({ onFinishWebhook: callback("/retry") });
  await waitFor(() => received.filter((e) => e.path === "/retry").length === 3, "retry success");
  const retries = received.filter((e) => e.path === "/retry");
  assert.equal(new Set(retries.map((e) => e.raw)).size, 1);
  assert.equal(new Set(retries.map((e) => e.key)).size, 1);
  assert.ok(retries[1]!.at - retries[0]!.at >= 900);
  assert.ok(retries[2]!.at - retries[1]!.at >= 1900);
  const failed = await create({ onFinishWebhook: callback("/fail") });
  await waitFor(() => received.some((e) => e.path === "/fail"), "first failure");
  assert.equal(manager.getAgent(failed.agentId)!.lifecycle, "idle");
  await waitFor(() => received.filter((e) => e.path === "/fail").length === 3, "retry exhaustion");
  await pause(1100);
  assert.equal(received.filter((e) => e.path === "/fail").length, 3);
  await create({ onFinishWebhook: callback("/redirect") });
  await waitFor(
    () => received.filter((e) => e.path === "/redirect").length === 3,
    "redirect rejection",
  );
  assert.ok(!received.some((e) => e.path === "/redirect-target"));
  console.log(
    "PASS real HTTP 503 retries (1s/2s), stable body/key, 3-attempt bound, nonblocking, redirects rejected",
  );

  const long = await create({
    initialPrompt: `respond with exactly: ${"x".repeat(5000)}`,
    onFinishWebhook: callback("/long"),
  });
  await waitFor(() => events(long.agentId, "idle").length === 1, "truncated response");
  assert.equal(events(long.agentId, "idle")[0]!.body.lastResponse.length, 4000);
  const disconnected = await create({
    initialPrompt: "hold for disconnect",
    onFinishWebhook: callback("/disconnect"),
  });
  await client.close();
  releaseHeld();
  await waitFor(() => events(disconnected.agentId, "idle").length === 1, "disconnected callback");
  client = await connect();
  delete process.env.PASEO_ON_FINISH_WEBHOOK;
  await call("send_agent_prompt", {
    agentId: a.agentId,
    prompt: "respond with exactly: no webhook",
  });
  await waitFor(() => manager.getAgent(a.agentId)!.lifecycle === "idle", "no callback turn");
  await pause(100);
  assert.equal(events(a.agentId, "idle").length, 3);
  console.log(
    "PASS 4k cap, callback after MCP disconnect, omitted/default-free dispatch clears callback",
  );

  const countBeforeInvalid = manager.listAgents().length;
  delete process.env.PASEO_ON_FINISH_WEBHOOK_ALLOW_HTTP_LOCALHOST;
  for (const url of [
    callback("/forbidden"),
    "http://example.com/callback?key=QA_ONLY_SECRET",
    "not a url",
    "https://example.com/callback#fragment",
  ]) {
    const r = await client.callTool({
      name: "create_agent",
      arguments: {
        provider: "claude/claude-test-model",
        title: "Invalid",
        workspaceId: workspace.workspaceId,
        initialPrompt: "unused",
        onFinishWebhook: url,
      },
    });
    assert.equal(r.isError, true);
  }
  assert.equal(manager.listAgents().length, countBeforeInvalid);
  const remote = await client.callTool({
    name: "send_agent_prompt",
    arguments: {
      serverId: "other-host",
      agentId: a.agentId,
      prompt: "unused",
      onFinishWebhook: "https://example.com/callback?key=QA_ONLY_SECRET",
    },
  });
  assert.equal(remote.isError, true);
  const logRecords = await getMcpCallLog(daemon.paseoHome).list(500);
  assert.ok(!JSON.stringify(logRecords).includes("QA_ONLY_SECRET"));
  assert.ok(!logs.join("").includes("QA_ONLY_SECRET"));
  console.log(
    "PASS HTTPS validation before creation, remote rejection, MCP/debug/delivery log secret redaction",
  );

  const parent = await create({ title: "Notify parent" });
  await waitFor(() => manager.getAgent(parent.agentId)!.lifecycle === "idle", "parent idle");
  const scoped = await connect(parent.agentId);
  try {
    const child = await call(
      "create_agent",
      {
        provider: "claude/claude-test-model",
        title: "Notify child",
        initialPrompt: "respond with exactly: child complete",
      },
      scoped,
    );
    await waitFor(
      () =>
        parentPrompts.some(
          (prompt) =>
            prompt.includes(`Agent ${child.agentId} (Notify child) finished.`) &&
            prompt.includes("child complete"),
        ),
      "existing parent notification",
    );
  } finally {
    await scoped.close();
  }
  console.log("PASS existing agent-scoped notifyOnFinish");
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        posts: received.length,
        sample: first.body,
        retryGapsMs: retries.slice(1).map((e, i) => e.at - retries[i]!.at),
      },
      null,
      2,
    ),
  );
} finally {
  releaseHeld();
  await client?.close();
  await daemon.close();
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
```

## Not covered

No real provider or Grok routine was called. Production HTTPS delivery must be checked once the
user supplies its URL/key. Restart recovery is outside the callback contract; see
[the MCP reference](../../public-docs/mcp.md#http-completion-callbacks).
