import { describe, expect, it } from "vitest";
import type { PaseoSubagentRow, ProviderSubagentRow } from "./select";
import { createStopAllSubagents, type StopAllOutcome } from "./stop-subagents";

function paseo(id: string, turn: "open" | "idle" | "cancelling" = "idle"): PaseoSubagentRow {
  const open = turn !== "idle";
  return {
    kind: "paseo",
    address: { serverId: "server-1", agentId: id },
    id,
    provider: "codex",
    title: id,
    description: null,
    subtitle: null,
    status: open ? "running" : "idle",
    turn: open
      ? {
          phase: "open",
          turnId: null,
          startedAt: null,
          cancellationRequestId: turn === "cancelling" ? 1 : null,
        }
      : { phase: "idle", cancellationRequestId: null },
    requiresAttention: false,
    createdAt: new Date(),
  };
}

function provider(id: string): ProviderSubagentRow {
  return {
    kind: "provider",
    id,
    parentAgentId: "parent",
    provider: "codex",
    title: id,
    description: null,
    subtitle: null,
    status: "running",
    requiresAttention: false,
    createdAt: new Date(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sortedOutcome(outcome: StopAllOutcome): StopAllOutcome {
  return {
    stoppedIds: [...outcome.stoppedIds].sort(),
    skippedIds: [...outcome.skippedIds].sort(),
    failures: [...outcome.failures].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

describe("createStopAllSubagents", () => {
  it("interrupts every open Paseo turn in parallel and skips idle, cancelling, and provider rows", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const calls: string[] = [];
    const stoppable = new Set(["first", "second"]);
    const stop = createStopAllSubagents(
      [
        paseo("first", "open"),
        paseo("idle"),
        paseo("busy", "cancelling"),
        provider("native"),
        paseo("second", "open"),
      ],
      {
        stopSubagent: ({ agentId }) => {
          calls.push(agentId);
          return agentId === "first" ? first.promise : second.promise;
        },
        isStillStoppable: ({ agentId }) => stoppable.has(agentId),
      },
    );
    const progress: string[] = [];
    stop.subscribe(() => {
      const status = stop.getState().status;
      if (status.kind === "stopping")
        progress.push(`${status.completedCount}/${status.totalCount}`);
    });

    expect(stop.getState()).toEqual({ eligibleCount: 2, status: { kind: "idle" } });

    const operation = stop.stopAll();
    expect(stop.getState()).toEqual({
      eligibleCount: 2,
      status: { kind: "stopping", completedCount: 0, totalCount: 2 },
    });
    expect(calls.sort()).toEqual(["first", "second"]);
    await expect(stop.stopAll()).resolves.toEqual({
      stoppedIds: [],
      skippedIds: [],
      failures: [],
    });
    expect(calls).toEqual(["first", "second"]);

    first.resolve();
    await Promise.resolve();
    expect(stop.getState().status).toEqual({ kind: "stopping", completedCount: 1, totalCount: 2 });

    second.resolve();
    await expect(operation).resolves.toEqual({
      stoppedIds: ["first", "second"],
      skippedIds: [],
      failures: [],
    });
    expect(progress).toEqual(["0/2", "1/2", "2/2"]);
    expect(stop.getState()).toEqual({ eligibleCount: 2, status: { kind: "idle" } });
  });

  it("keeps a still-running failure retryable and treats a turn that already ended as skipped", async () => {
    const stoppable = new Set(["stuck", "finished"]);
    const error = new Error("host refused");
    const calls: string[] = [];
    const stop = createStopAllSubagents([paseo("stuck", "open"), paseo("finished", "open")], {
      stopSubagent: ({ agentId }) => {
        calls.push(agentId);
        if (agentId === "finished") stoppable.delete(agentId);
        return Promise.reject(error);
      },
      isStillStoppable: ({ agentId }) => stoppable.has(agentId),
    });

    await expect(stop.stopAll().then(sortedOutcome)).resolves.toEqual({
      stoppedIds: [],
      skippedIds: ["finished"],
      failures: [{ id: "stuck", error }],
    });
    expect(stop.getState()).toEqual({
      eligibleCount: 2,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });

    stop.setRows([paseo("stuck", "open")]);
    expect(stop.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });

    const retry = stop.stopAll();
    expect(calls).toEqual(["stuck", "finished", "stuck"]);
    stoppable.delete("stuck");
    await expect(retry.then(sortedOutcome)).resolves.toEqual({
      stoppedIds: [],
      skippedIds: ["stuck"],
      failures: [],
    });
    expect(stop.getState()).toEqual({ eligibleCount: 1, status: { kind: "idle" } });
  });

  it("clears a retained failure when the eligible set changes", async () => {
    const stop = createStopAllSubagents([paseo("stuck", "open")], {
      stopSubagent: () => Promise.reject(new Error("nope")),
      isStillStoppable: () => true,
    });

    await stop.stopAll();
    expect(stop.getState().status.kind).toBe("failed");

    stop.setRows([paseo("stuck", "open"), paseo("later", "open")]);
    expect(stop.getState()).toEqual({ eligibleCount: 2, status: { kind: "idle" } });
  });
});
