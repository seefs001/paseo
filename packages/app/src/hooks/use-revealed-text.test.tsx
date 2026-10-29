// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRevealedText } from "./use-revealed-text";

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let now = 0;

function installFrameClock(): void {
  nextFrameId = 1;
  now = 0;
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
}

function flushFrame(): void {
  const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!next) throw new Error("expected a reveal frame");
  frames.delete(next[0]);
  now += 32;
  act(() => {
    next[1](now);
  });
}

function pointer(type: "pointerdown" | "pointerup" | "pointercancel", target: EventTarget): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.defineProperty(event, "isPrimary", { value: true });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("useRevealedText selection hold", () => {
  let chat: HTMLDivElement;
  let paragraph: HTMLParagraphElement;

  beforeEach(() => {
    installFrameClock();
    chat = document.createElement("div");
    chat.dataset.testid = "agent-chat-scroll";
    paragraph = document.createElement("p");
    paragraph.textContent = "reasoning";
    chat.append(paragraph);
    document.body.append(chat);
  });

  afterEach(async () => {
    document.getSelection()?.removeAllRanges();
    pointer("pointercancel", document);
    document.dispatchEvent(new Event("selectionchange"));
    await Promise.resolve();
    chat.remove();
    vi.unstubAllGlobals();
  });

  it("stops the reveal while the pointer is down on chat text, then catches up", async () => {
    const growing = `Hello${"x".repeat(200)}`;
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "Hello" } },
    );
    expect(result.current).toBe("Hello");

    rerender({ text: growing });
    flushFrame();
    const frozen = result.current;
    expect(frozen.length).toBeGreaterThan("Hello".length);
    expect(frozen.length).toBeLessThan(growing.length);

    pointer("pointerdown", paragraph);
    rerender({ text: `${growing} more` });
    expect(frames.size).toBe(0);
    expect(result.current).toBe(frozen);

    pointer("pointerup", paragraph);
    await Promise.resolve();
    rerender({ text: `${growing} more` });
    flushFrame();
    expect(result.current.length).toBeGreaterThan(frozen.length);
  });

  it("keeps the reveal held after mouseup while the chat selection is still open", () => {
    const growing = `Hello${"x".repeat(200)}`;
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "Hello" } },
    );
    rerender({ text: growing });
    flushFrame();
    const frozen = result.current;

    pointer("pointerdown", paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = document.getSelection();
    if (!selection) throw new Error("expected a selection");
    act(() => {
      selection.removeAllRanges();
      selection.addRange(range);
    });
    pointer("pointerup", paragraph);
    rerender({ text: `${growing} more` });
    expect(result.current).toBe(frozen);
    expect(frames.size).toBe(0);
  });

  it("does not hold the reveal for a press on a chat control", () => {
    const button = document.createElement("button");
    chat.append(button);
    const growing = `Hello${"x".repeat(200)}`;
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "Hello" } },
    );
    rerender({ text: growing });
    pointer("pointerdown", button);
    flushFrame();
    expect(result.current.length).toBeGreaterThan("Hello".length);
  });
});
