import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { cancelAgent, expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

type WebSocketMessage = string | Buffer;

const COMPACT_VIEWPORT = { width: 390, height: 520 };

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function cloneToolCallWithId(
  message: WebSocketMessage,
  callId: string,
  sequenceOffset: number,
): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { seq?: number; event?: { item?: { callId?: string } } } };
  };
  const payload = envelope.message?.payload;
  const item = payload?.event?.item;
  if (!payload || !item?.callId || typeof payload.seq !== "number") {
    throw new Error("Expected a tool-call session message");
  }
  item.callId = callId;
  payload.seq += sequenceOffset;
  return JSON.stringify(envelope);
}

function shiftTimelineSequence(
  message: WebSocketMessage,
  sequenceOffset: number,
): WebSocketMessage {
  if (sequenceOffset === 0) {
    return message;
  }
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { message?: { payload?: { seq?: number } } };
    const payload = envelope.message?.payload;
    if (typeof payload?.seq !== "number") {
      return message;
    }
    payload.seq += sequenceOffset;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}

async function holdStreamAfterFirstCompletedToolCall(page: Page, agentId: string) {
  let firstCallId: string | null = null;
  let firstCompletedMessage: WebSocketMessage | null = null;
  let isHolding = false;
  let sequenceOffset = 0;
  const heldMessages: WebSocketMessage[] = [];
  let sendToPage: ((message: WebSocketMessage) => void) | null = null;
  let resolveFirstCompleted!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    sendToPage = (message) => ws.send(message);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (isHolding) {
        heldMessages.push(message);
        return;
      }

      ws.send(shiftTimelineSequence(message, sequenceOffset));
      const toolCall = getToolCallStatus(message, agentId);
      firstCallId ??= toolCall?.callId ?? null;
      if (toolCall?.callId === firstCallId && toolCall.status === "completed") {
        firstCompletedMessage = message;
        isHolding = true;
        resolveFirstCompleted();
      }
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    release(extraCompletedCalls = 0) {
      isHolding = false;
      if (extraCompletedCalls > 0 && (!firstCallId || !firstCompletedMessage)) {
        throw new Error("Expected the first completed tool call before release");
      }
      for (let index = 0; index < extraCompletedCalls; index += 1) {
        sendToPage?.(
          cloneToolCallWithId(
            firstCompletedMessage as WebSocketMessage,
            `${firstCallId}:${index}`,
            index + 1,
          ),
        );
      }
      sequenceOffset = extraCompletedCalls;
      for (const message of heldMessages.splice(0)) {
        sendToPage?.(shiftTimelineSequence(message, sequenceOffset));
      }
    },
  };
}

async function showSkillRead(page: Page, source: "codemode" | "direct"): Promise<void> {
  let firstCallId: string | null = null;
  function replaceFirstToolCall(_key: string, value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value;
    if (!("type" in value) || value.type !== "tool_call") return value;
    if (!("callId" in value) || typeof value.callId !== "string") return value;
    firstCallId ??= value.callId;
    if (value.callId !== firstCallId) return value;
    if (source === "direct") {
      return {
        ...value,
        provider: "pi",
        name: "read",
        detail: {
          type: "read",
          filePath: "/skills/checkout-copy/SKILL.md",
          content: "---\nname: paseo-committee\n---\n# Committee Skill",
        },
      };
    }
    return {
      ...value,
      provider: "pi",
      name: "codemode",
      detail: {
        type: "unknown",
        input: "await tools.read({ path: '/skills/code-review/SKILL.md' });",
        output: {
          details: {
            calls: [
              {
                id: `${value.callId}/skill`,
                name: "read",
                args: JSON.stringify({ path: "/skills/code-review/SKILL.md" }),
                status: "ok",
              },
              {
                id: `${value.callId}/shell`,
                name: "bash",
                args: JSON.stringify({ command: "echo codemode-other-tool" }),
                status: "ok",
              },
            ],
          },
        },
      },
    };
  }
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const rewritten: unknown = JSON.parse(raw, replaceFirstToolCall);
      socket.send(JSON.stringify(rewritten));
    });
  });
}

async function configureOverviewToolCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ chatDisplay: "collapseToolCalls" }),
    );
  });
}

async function createOverviewAgent(page: Page, title: string) {
  await configureOverviewToolCalls(page);
  return seedMockAgentWorkspace({
    repoPrefix: "tool-call-overview-sheet-",
    title,
    model: "ten-second-stream",
  });
}

async function openOverviewAgent(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  await openAgentRoute(page, {
    workspaceId: agent.workspaceId,
    agentId: agent.agentId,
  });
  await expectComposerVisible(page);
}

function hasScrolledToLatest(root: HTMLElement): boolean {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    const maximumScrollTop = node.scrollHeight - node.clientHeight;
    return maximumScrollTop > 0 && Math.abs(node.scrollTop - maximumScrollTop) <= 1;
  }
  return false;
}

function readScrollMetrics(root: HTMLElement) {
  const badgeElements = root.querySelectorAll<HTMLElement>("[data-testid=tool-call-badge]");
  const latestBadge = badgeElements.item(badgeElements.length - 1);
  const scrollables = [];
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    scrollables.push({
      className: node.className,
      clientHeight: node.clientHeight,
      rect: node.getBoundingClientRect().toJSON(),
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      tagName: node.tagName,
    });
  }
  return {
    latestBadgeRect: latestBadge?.getBoundingClientRect().toJSON(),
    rootRect: root.getBoundingClientRect().toJSON(),
    scrollables,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

for (const level of ["overview", "detailed"] as const) {
  test(`keeps skill reads outside collapsed Codemode in ${level} mode`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((toolCallDetailLevel) => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ toolCallDetailLevel }));
    }, level);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "codemode-skill-read-",
      title: "Codemode skill reads",
      model: "ten-second-stream",
    });
    try {
      await showSkillRead(page, "codemode");
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await agent.client.sendAgentMessage(agent.agentId, "Show the skill reading instructions.");
      const skill = page.getByTestId("tool-call-badge").filter({ hasText: "Read skill" });
      const codemode = page.getByTestId("tool-call-group").filter({ hasText: "Codemode" }).first();
      await expect(skill).toHaveCount(1);
      // Stop after the first tool so later mock cycles do not scroll this row away.
      await cancelAgent(page);
      await skill.scrollIntoViewIfNeeded();
      await expect(skill).toContainText("code-review");
      await expect(skill).toBeVisible();
      await expect(codemode.getByTestId("tool-call-badge")).toHaveCount(0);
      await codemode.getByRole("button").first().click();
      await expect(codemode).toContainText("echo codemode-other-tool");
      await expect(codemode.getByText("Read skill", { exact: true })).toHaveCount(0);
      await expect(skill).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("codemode-skills.png") });

      await page.reload();
      await expect(skill).toHaveCount(1);
      await skill.scrollIntoViewIfNeeded();
      await expect(skill).toBeVisible();
      await expect(codemode.getByTestId("tool-call-badge")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
}

test("shows the declared skill name on compact layouts and after reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const agent = await createOverviewAgent(page, "Declared skill name");
  try {
    await showSkillRead(page, "direct");
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Read the committee skill.");
    const skill = page.getByTestId("tool-call-badge").filter({ hasText: "Read skill" });
    await expect(skill).toContainText("paseo-committee");
    await cancelAgent(page);
    await skill.scrollIntoViewIfNeeded();
    await expect(skill).not.toContainText("checkout-copy");
    await expect(skill).not.toContainText("Committee Skill");
    await page.screenshot({ path: testInfo.outputPath("declared-skill-name.png") });
    await page.reload();
    await expect(skill).toContainText("paseo-committee");
    await skill.scrollIntoViewIfNeeded();
    await expect(skill).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test.describe("compact overview tool calls", () => {
  test.use({ viewport: COMPACT_VIEWPORT, hasTouch: true });

  test("keeps a live group sheet current and stacks individual details above it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Compact overview tool calls");

    try {
      const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise the overview tool-call sheet.");
      await gate.waitForFirstCompleted();

      const group = page.getByTestId("tool-call-group").first();
      await expect(group).toBeVisible();
      await group.click();

      const sheet = page.getByTestId("tool-call-group-sheet");
      const summary = page.getByTestId("tool-call-group-sheet-summary");
      await expect(sheet).toBeVisible();
      const initialSummary = await summary.innerText();

      gate.release(10);
      const badges = sheet.getByTestId("tool-call-badge");
      await expect.poll(() => badges.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(11);
      await expect(summary).not.toHaveText(initialSummary);
      await expect.poll(() => sheet.evaluate(hasScrolledToLatest)).toBe(true);
      const scrollMetrics = await sheet.evaluate(readScrollMetrics);
      await testInfo.attach("compact-overview-scroll-metrics", {
        body: JSON.stringify(scrollMetrics, null, 2),
        contentType: "application/json",
      });

      await badges.last().click();
      const detailClose = page.getByTestId("tool-call-sheet-close");
      await expect(detailClose).toBeVisible();

      await detailClose.click();
      await expect(detailClose).toBeHidden();
      await expect(sheet).toBeVisible();

      await testInfo.attach("compact-overview-tool-call-group", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await page.getByTestId("tool-call-group-sheet-close").click();
      await expect(sheet).toBeHidden();
      await expect(group).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});

test("keeps overview tool calls inline on desktop", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await createOverviewAgent(page, "Desktop overview tool calls");

  try {
    const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise desktop overview tool calls.");
    await gate.waitForFirstCompleted();
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();

    // Keep streaming layout changes out of the pointer-down/pointer-up interval.
    const header = group.getByRole("button").first();
    await header.click();
    await expect(group.getByTestId("tool-call-badge").first()).toBeVisible();
    await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);

    gate.release(1);
    await expect.poll(() => group.getByTestId("tool-call-badge").count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});
