import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  awaitAssistantMessage,
  expectAgentIdle,
  expectInlineWorkingIndicator,
  expectRunningAgentChrome,
  expectTurnCopyButton,
  expectScrollFollowsNewContent,
} from "../support/helpers/agent-stream";
import {
  expectScrollStaysFixed,
  clickToolCallBesideScrollToBottomButton,
  readScrollMetrics,
  scrollAgentChatToBottom,
  scrollChatAwayFromBottom,
  waitForScrollableChat,
} from "../support/helpers/agent-bottom-anchor";
import { delayCreatedAgentInitialTailResponse } from "../support/helpers/agent-timeline-gate";
import { selectModel } from "../support/helpers/app";
import { clickNewChat } from "../support/helpers/launcher";
import { expectComposerVisible, startRunningMockAgent } from "../support/helpers/composer";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  seedRunningMockAgentWorkspace,
} from "../support/helpers/mock-agent";

import { daemonWsRoutePattern } from "../support/helpers/daemon-port";

const SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE = 360;

async function omitRecordedTurnInfo(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const envelope: unknown = JSON.parse(raw);
      socket.send(JSON.stringify(envelope, omitTurnInfo));
    });
  });
}

function omitTurnInfo(key: string, value: unknown): unknown {
  return key === "turnInfo" ? undefined : value;
}

test.describe("Agent stream UI", () => {
  for (const compact of [false, true]) {
    test(`shows recorded turn information beside copy (${compact ? "compact" : "desktop"})`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(
        compact ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      );
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const agent = await seedMockAgentWorkspace({
        repoPrefix: "stream-turn-info-",
        title: "Recorded turn information",
        model: "ten-second-stream",
        featureValues: { fast_mode: !compact },
        initialPrompt: "emit 1 coalesced agent stream updates for turn information.",
      });
      try {
        await agent.client.waitForFinish(agent.agentId, 30_000);
        await openAgentRoute(page, agent);
        await awaitAssistantMessage(page);
        await scrollAgentChatToBottom(page);
        const trigger = page.getByTestId("assistant-turn-info-trigger").last();
        await expect(trigger).toBeVisible();
        const footer = trigger.locator("..");
        await expect(footer.getByRole("button", { name: "Copy turn", exact: true })).toBeVisible();
        await trigger.click();
        const panel = page.getByTestId(
          compact ? "assistant-turn-info-content-content" : "assistant-turn-info-content",
        );
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("ten-second-stream");
        await expect(
          panel.getByText("Fast / Priority", { exact: true }).locator(".."),
        ).toContainText(compact ? "Not requested" : "Requested");
        await expect(panel).toContainText("not provider confirmation");
        await expect(
          panel.getByRole("menuitem", { name: "Copy information", exact: true }),
        ).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath("turn-info.png") });
        await panel.getByRole("menuitem", { name: "Copy information", exact: true }).click();
        await expect(panel.getByText("Copied", { exact: true })).toBeVisible();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain("Model at turn start: ten-second-stream");
        expect(copied).toContain(`Fast / Priority: ${compact ? "Not requested" : "Requested"}`);
        await page
          .getByRole("button", {
            name: compact ? "Bottom sheet backdrop" : "Menu backdrop",
            exact: true,
          })
          .click({ position: { x: 10, y: 10 } });
        await expect(panel).toHaveCount(0);
        await trigger.click();
        await expect(panel).toBeVisible();
        if (!compact) {
          await page.evaluate(() => {
            Object.defineProperty(navigator.clipboard, "writeText", {
              configurable: true,
              value: async () => {
                throw new Error("Denied");
              },
            });
            Object.defineProperty(document, "execCommand", {
              configurable: true,
              value: () => {
                throw new Error("Denied");
              },
            });
          });
          await panel.getByRole("menuitem", { name: "Copy information", exact: true }).click();
          await expect(panel.getByRole("alert")).toContainText("Could not copy information");
          await expect(panel.getByText("Copied", { exact: true })).toHaveCount(0);
        }
      } finally {
        await agent.cleanup();
      }
    });
  }

  test("shows unrecorded turn information from an older host without using current settings", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "stream-turn-info-legacy-",
      title: "Unrecorded turn information",
      model: "ten-second-stream",
      initialPrompt: "emit 1 coalesced agent stream updates for legacy turn information.",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await omitRecordedTurnInfo(page);
      await openAgentRoute(page, agent);
      await awaitAssistantMessage(page);
      await scrollAgentChatToBottom(page);
      await page.getByTestId("assistant-turn-info-trigger").last().click();
      const panel = page.getByTestId("assistant-turn-info-content");
      await expect(panel).toBeVisible();
      await expect(
        panel.getByText("Model at turn start", { exact: true }).locator(".."),
      ).toContainText("Not recorded");
      await expect(panel.getByText("Fast / Priority", { exact: true }).locator("..")).toContainText(
        "Not recorded",
      );
      await expect(panel).not.toContainText("ten-second-stream");
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps running agent chrome after page refresh", async ({ page }) => {
    const title = "Running agent refresh";
    const agent = await seedRunningMockAgentWorkspace({
      repoPrefix: "stream-running-refresh-",
      title,
      model: "five-minute-stream",
      initialPrompt: "Stay running while the page refreshes.",
    });
    try {
      await openAgentRoute(page, agent);
      await expectRunningAgentChrome(page, title);

      await page.reload();

      await expectRunningAgentChrome(page, title);
    } finally {
      await agent.cleanup();
    }
  });

  test("auto-scroll sticks to bottom across token bursts", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-scroll-",
      model: "one-minute-stream",
      prompt: "Stream for auto-scroll test.",
    });
    try {
      await awaitAssistantMessage(page);
      await expectScrollFollowsNewContent(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the active Markdown root mounted across streamed text updates", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-markdown-root-",
      model: "one-minute-stream",
      prompt: "Stream for Markdown root stability test.",
    });
    try {
      const assistantMessage = page.getByTestId("assistant-message").last();
      await expect(assistantMessage).toContainText("walking through", { timeout: 30_000 });

      const activeBlock = assistantMessage.locator(":scope > *").last();
      const initialText = (await activeBlock.textContent()) ?? "";
      const activeBlockHandle = await activeBlock.elementHandle();
      if (!activeBlockHandle) {
        throw new Error("Expected the active assistant message to contain a block");
      }
      const markdownRoot = await activeBlock.locator(":scope > *").first().elementHandle();
      if (!markdownRoot) {
        throw new Error("Expected the active assistant block to contain a Markdown root");
      }

      await page.evaluate((block) => {
        const evidence = { addedNodes: 0, characterDataMutations: 0, removedNodes: 0 };
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            evidence.addedNodes += record.addedNodes.length;
            evidence.removedNodes += record.removedNodes.length;
            if (record.type === "characterData") evidence.characterDataMutations += 1;
          }
        });
        observer.observe(block, { characterData: true, childList: true, subtree: true });
        Object.assign(window, {
          __markdownRootEvidence: evidence,
          __markdownRootObserver: observer,
        });
      }, activeBlockHandle);

      await expect
        .poll(async () => ((await activeBlock.textContent()) ?? "").length)
        .toBeGreaterThan(initialText.length + 80);

      const evidence = await page.evaluate((root) => {
        const state = window as typeof window & {
          __markdownRootEvidence?: {
            addedNodes: number;
            characterDataMutations: number;
            removedNodes: number;
          };
          __markdownRootObserver?: MutationObserver;
        };
        state.__markdownRootObserver?.disconnect();
        const messages = document.querySelectorAll('[data-testid="assistant-message"]');
        const message = messages.item(messages.length - 1);
        const block = message?.lastElementChild;
        return {
          ...state.__markdownRootEvidence,
          connected: root.isConnected,
          sameRoot: block?.firstElementChild === root,
        };
      }, markdownRoot);

      await testInfo.attach("markdown-root-stability", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      expect(evidence.connected).toBe(true);
      expect(evidence.sameRoot).toBe(true);
      expect(
        evidence.removedNodes,
        `Streaming Markdown replaced mounted descendants: ${JSON.stringify(evidence)}`,
      ).toBe(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the viewport fixed after the user scrolls away during a stream", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "stream-scroll-away-",
      title: "Scroll-away anchor",
      model: "five-minute-stream",
      initialPrompt: "emit 120 agent stream updates for scroll-away setup.",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await openAgentRoute(page, {
        workspaceId: agent.workspaceId,
        agentId: agent.agentId,
      });
      await expectComposerVisible(page);
      await agent.client.sendAgentMessage(agent.agentId, "Stream for scroll-away anchor test.");
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      await awaitAssistantMessage(page);
      await waitForScrollableChat(page, {
        minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
        timeout: 30_000,
      });
      const baseline = await scrollChatAwayFromBottom(page, {
        deltaY: -900,
        minDistanceFromBottom: 300,
      });
      await expectScrollStaysFixed(page, baseline, { durationMs: 30_000 });

      const finalMetrics = await readScrollMetrics(page);
      expect(finalMetrics.contentHeight).toBeGreaterThan(baseline.contentHeight);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the viewport fixed when delayed authoritative history arrives after scroll-away", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(180_000);
    const timelineGate = await delayCreatedAgentInitialTailResponse(page);
    const workspace = await withWorkspace({
      prefix: "stream-scroll-away-delayed-history-",
    });
    await workspace.navigateTo();
    await clickNewChat(page);
    await page.getByText("Model defaults are still loading").waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    await expectComposerVisible(page);
    await selectModel(page, "Five minute stream");

    const prompt = "Stream for delayed authoritative history scroll-away test.";
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(prompt, { exact: true }).first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await timelineGate.waitForCreatedAgent();
    await timelineGate.waitForDelayedResponse();
    await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    // Reasoning rows collapse when the mock starts its next assistant response. Wait past
    // that transition so their temporary height cannot satisfy the scroll-away setup.
    await awaitAssistantMessage(page, "Now I have a clearer picture.");
    await waitForScrollableChat(page, {
      minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
      timeout: 45_000,
    });
    const baseline = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });

    timelineGate.release();
    await timelineGate.waitForForwardedResponse();
    await expectScrollStaysFixed(page, baseline);
  });

  test("keeps tool calls clickable beside the scroll-to-bottom button", async ({ page }) => {
    test.setTimeout(60_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "stream-scroll-button-hit-area-",
      title: "Scroll button hit area",
      model: "ten-second-stream",
      initialPrompt: "Stream enough content to exercise the scroll button hit area.",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await openAgentRoute(page, {
        workspaceId: agent.workspaceId,
        agentId: agent.agentId,
      });
      await waitForScrollableChat(page, {
        minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
        timeout: 30_000,
      });

      const hitArea = await clickToolCallBesideScrollToBottomButton(page);

      expect(hitArea).toEqual({
        outsideButton: true,
        toolCallReceivesPointer: true,
        withinButtonBand: true,
      });
    } finally {
      await agent.cleanup();
    }
  });

  test("working-indicator transitions to copy-button when stream ends", async ({ page }) => {
    test.setTimeout(60_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-indicator-",
      model: "ten-second-stream",
      prompt: "Stream briefly for indicator transition test.",
    });
    try {
      await awaitAssistantMessage(page);
      await expectInlineWorkingIndicator(page);
      await expectAgentIdle(page, 30_000);
      await scrollAgentChatToBottom(page);
      await expectTurnCopyButton(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("shows elapsed timer on first app-created running turn", async ({ page, withWorkspace }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "stream-first-app-turn-timer-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await page.getByText("Model defaults are still loading").waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    const prompt = "Stream briefly for first app-created turn timer test.";
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(prompt, { exact: true }).first().waitFor({ state: "visible" });
    await awaitAssistantMessage(page);
    await expectInlineWorkingIndicator(page);
    await page.getByTestId("turn-working-elapsed").waitFor({ state: "visible", timeout: 5_000 });
  });
});
