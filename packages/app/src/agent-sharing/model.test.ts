import { describe, expect, test } from "vitest";
import type { AgentSessionShareResult } from "@getpaseo/protocol/messages";
import { openAgentShare, type AgentSharePorts } from "./model";

const RESULT: AgentSessionShareResult = {
  viewerUrl: "https://pi.dev/session/#abc123",
  gistUrl: "https://gist.github.com/test-user/abc123",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeSharePorts implements AgentSharePorts {
  request = deferred<AgentSessionShareResult>();
  copyResult = deferred<void>();
  shareCalls = 0;
  readonly copies: string[] = [];

  share(): Promise<AgentSessionShareResult> {
    this.shareCalls += 1;
    return this.request.promise;
  }

  copy(value: string): Promise<void> {
    this.copies.push(value);
    return this.copyResult.promise;
  }
}

describe("agent share dialog model", () => {
  test("starts one upload, blocks retry and close while pending, then exposes the links", async () => {
    const ports = new FakeSharePorts();
    const model = openAgentShare(ports);
    expect(model.getState()).toEqual({ status: "pending" });
    model.retry();
    expect(model.close()).toBe(false);
    expect(ports.shareCalls).toBe(1);

    ports.request.resolve(RESULT);
    await ports.request.promise;

    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "idle" },
    });
    model.retry();
    expect(ports.shareCalls).toBe(1);
    expect(model.close()).toBe(true);
  });

  test("keeps a failure visible until the user retries and publishes the retried result", async () => {
    const ports = new FakeSharePorts();
    const model = openAgentShare(ports);
    ports.request.reject(new Error("Host disconnected"));
    await ports.request.promise.catch(() => undefined);
    expect(model.getState()).toEqual({ status: "error", message: "Host disconnected" });

    ports.request = deferred<AgentSessionShareResult>();
    model.retry();
    model.retry();
    expect(model.getState()).toEqual({ status: "pending" });
    expect(ports.shareCalls).toBe(2);
    ports.request.resolve(RESULT);
    await ports.request.promise;
    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "idle" },
    });
  });

  test("copies the viewer link once, shows pending and success, and never uploads again", async () => {
    const ports = new FakeSharePorts();
    const model = openAgentShare(ports);
    ports.request.resolve(RESULT);
    await ports.request.promise;

    const copying = model.copyLink();
    await model.copyLink();
    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "copying" },
    });
    expect(model.close()).toBe(false);
    ports.copyResult.resolve();
    await copying;
    expect(ports.copies).toEqual([RESULT.viewerUrl]);
    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "copied" },
    });
    expect(ports.shareCalls).toBe(1);
  });

  test("keeps copy errors and external-link failures in the dialog without losing links", async () => {
    const ports = new FakeSharePorts();
    const model = openAgentShare(ports);
    ports.request.resolve(RESULT);
    await ports.request.promise;
    const copying = model.copyLink();
    ports.copyResult.reject(new Error("Clipboard unavailable"));
    await copying;
    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "error", message: "Clipboard unavailable" },
    });
    model.reportActionError(new Error("Browser unavailable"));
    expect(model.getState()).toEqual({
      status: "success",
      result: RESULT,
      feedback: { status: "error", message: "Browser unavailable" },
    });
  });

  test("a closed dialog ignores further commands and a new dialog starts fresh", async () => {
    const ports = new FakeSharePorts();
    const model = openAgentShare(ports);
    ports.request.reject(new Error("Export failed"));
    await ports.request.promise.catch(() => undefined);
    expect(model.close()).toBe(true);
    model.retry();
    await model.copyLink();
    model.reportActionError(new Error("Late result"));
    expect(model.getState()).toEqual({ status: "error", message: "Export failed" });
    expect(ports.shareCalls).toBe(1);
    expect(ports.copies).toEqual([]);

    const next = new FakeSharePorts();
    expect(openAgentShare(next).getState()).toEqual({ status: "pending" });
    expect(next.shareCalls).toBe(1);
    next.request.resolve(RESULT);
    await next.request.promise;
  });
});
