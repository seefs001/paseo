import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { Logger } from "pino";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import { PaseoToolInputError } from "./tools/types.js";

export interface FinishWebhookInput {
  onFinishWebhook?: string;
  replyToAgentId?: string;
}

export interface FinishWebhookTarget {
  url: string;
  replyToAgentId?: string;
}

export function resolveFinishWebhookTarget(
  input: FinishWebhookInput,
): FinishWebhookTarget | undefined {
  const value = input.onFinishWebhook ?? process.env.PASEO_ON_FINISH_WEBHOOK;
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaseoToolInputError("onFinishWebhook must be an absolute HTTPS URL");
  }
  const localHttp =
    process.env.PASEO_ON_FINISH_WEBHOOK_ALLOW_HTTP_LOCALHOST === "1" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash) {
    throw new PaseoToolInputError(
      "onFinishWebhook requires HTTPS without URL userinfo or a fragment; HTTP loopback requires PASEO_ON_FINISH_WEBHOOK_ALLOW_HTTP_LOCALHOST=1",
    );
  }
  return { url: url.href, replyToAgentId: input.replyToAgentId };
}

type FinishStatus = "idle" | "error" | "pendingPermissions" | "closed";

interface Watch {
  target: FinishWebhookTarget;
  runId: string;
  started: boolean;
  sent: Set<FinishStatus>;
}

interface FinishWebhookPayload {
  event: "agent.finish";
  source: "paseo";
  agentId: string;
  status: FinishStatus;
  runId: string;
  finishedAt: string;
  lastResponse: string;
  title?: string;
  workspaceId?: string;
  serverId: string;
  replyToAgentId?: string;
}

export interface FinishWebhooks {
  /** Install at creation or prompt dispatch, before consuming the accepted turn. */
  register(agentId: string, target: FinishWebhookTarget | undefined): void;
  close(): void;
}

interface Dependencies {
  agentManager: AgentManager;
  serverId: string;
  logger: Logger;
}

/** Daemon-owned observation outlives MCP sessions; HTTP never holds up agent dispatch. */
export function createFinishWebhooks(deps: Dependencies): FinishWebhooks {
  const watches = new Map<string, Watch>();
  const lifetime = new AbortController();

  function observe(agent: ManagedAgent): void {
    const watch = watches.get(agent.id);
    if (!watch) return;
    const turnId = agent.activeForegroundTurnId ?? agent.activeTurnId;
    if (agent.lifecycle === "running" && turnId) {
      if (turnId !== watch.runId) {
        watch.runId = turnId;
        watch.sent.clear();
      }
      watch.started = true;
    }
    let status: FinishStatus;
    if (agent.pendingPermissions.size > 0) status = "pendingPermissions";
    else if (agent.lifecycle === "error" || agent.lifecycle === "closed") status = agent.lifecycle;
    else if (agent.lifecycle === "idle" && watch.started) status = "idle";
    else return;
    if (watch.sent.has(status)) return;
    // Claim before any asynchronous work, including retries and later metadata-only updates.
    watch.sent.add(status);
    const payload: FinishWebhookPayload = {
      event: "agent.finish",
      source: "paseo",
      agentId: agent.id,
      status,
      runId: watch.runId,
      finishedAt: new Date().toISOString(),
      lastResponse: "",
      title: agent.config.title ?? undefined,
      workspaceId: agent.workspaceId,
      serverId: deps.serverId,
      replyToAgentId: watch.target.replyToAgentId,
    };
    void deliver(watch.target.url, payload);
  }

  async function deliver(url: string, payload: FinishWebhookPayload): Promise<void> {
    const fields = { agentId: payload.agentId, status: payload.status, runId: payload.runId };
    try {
      // Read the live tail synchronously, before a later turn can change the response.
      const { rows } = deps.agentManager.fetchTimeline(payload.agentId, {
        direction: "tail",
        limit: 20,
      });
      const chunks: string[] = [];
      for (const row of rows.toReversed()) {
        if (row.turnId !== payload.runId) continue;
        if (row.item.type === "assistant_message") chunks.push(row.item.text);
        else if (chunks.length) break;
      }
      payload.lastResponse = chunks.toReversed().join("").slice(0, 4000);
    } catch {
      deps.logger.warn(fields, "Could not read finish webhook response text");
    }
    const body = JSON.stringify(payload);
    const idempotencyKey = `${payload.agentId}:${payload.status}:${payload.runId}`;
    for (let attempt = 1; attempt <= 3 && !lifetime.signal.aborted; attempt++) {
      let httpStatus: number | undefined;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body,
          redirect: "error",
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
        });
        httpStatus = response.status;
        await response.body?.cancel();
        if (response.ok) {
          deps.logger.debug({ ...fields, attempt }, "Finish webhook delivered");
          return;
        }
      } catch {
        // Fetch errors and response bodies may contain the secret URL. Never log either.
      }
      if (lifetime.signal.aborted) return;
      deps.logger.warn({ ...fields, attempt, httpStatus }, "Finish webhook delivery failed");
      if (attempt < 3) {
        try {
          await pause(1000 * 2 ** (attempt - 1), undefined, { signal: lifetime.signal });
        } catch {
          return;
        }
      }
    }
  }

  const unsubscribe = deps.agentManager.subscribe(
    (event) => {
      if (event.type === "agent_state") observe(event.agent);
      else if (event.type === "agent_removed") watches.delete(event.agentId);
    },
    { replayState: false },
  );
  return {
    register(agentId, target) {
      if (lifetime.signal.aborted) return;
      if (!target) {
        watches.delete(agentId);
        return;
      }
      const agent = deps.agentManager.getAgent(agentId);
      const previous = watches.get(agentId);
      const runId = agent?.activeForegroundTurnId ?? agent?.activeTurnId;
      watches.set(agentId, {
        target,
        runId: runId ?? randomUUID(),
        started: agent?.lifecycle === "running",
        sent: previous && previous.runId === runId ? previous.sent : new Set(),
      });
      // A newly dispatched turn may still expose the preceding idle/error snapshot.
      if (agent?.lifecycle === "running") observe(agent);
    },
    close() {
      unsubscribe();
      lifetime.abort();
      watches.clear();
    },
  };
}
