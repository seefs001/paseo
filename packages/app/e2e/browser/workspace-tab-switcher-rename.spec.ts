import { z } from "zod";
import { loadProtocolSchemas } from "../support/helpers/daemon-client-loader";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import type { SeedDaemonClient } from "../support/helpers/seed-client";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

/**
 * Compact "sessions dropdown" rename path. The desktop rename specs drive the right-click
 * `workspace-tab-context-*` menu, which portals into overlay-root and was never broken. This
 * exercises the tab switcher's per-session actions on a phone-sized viewport — the path that
 * regressed when the actions menu presented as a popover instead of a bottom sheet.
 */
test.describe("Workspace session rename (compact tab switcher)", () => {
  test("renames an agent session from the switcher's per-session actions sheet", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.setViewportSize(MOBILE_VIEWPORT);
    const initialTitle = `switcher-rename-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-switcher-rename-",
      title: initialTitle,
    });

    try {
      await openAgentRoute(page, session);
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toBeVisible({
        timeout: 30_000,
      });

      // Open the sessions dropdown (a bottom sheet on compact).
      await page.getByRole("button", { name: /Switch tabs/ }).click();
      await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible(
        {
          timeout: 10_000,
        },
      );

      // Open this session's "…" actions. Before the fix this tried to open a popover-Modal
      // that never surfaced over the sheet on native; it now opens as a stacked sheet.
      const menuBase = `workspace-tab-menu-agent_${session.agentId}`;
      const actionsTrigger = page.getByTestId(`${menuBase}-trigger`);
      await expect(actionsTrigger).toBeVisible({ timeout: 15_000 });
      await actionsTrigger.click();

      const renameItem = page.getByTestId(`${menuBase}-rename`);
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-agent-${session.agentId}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toHaveValue(initialTitle);

      const renamed = "Renamed from the dropdown";
      await input.fill(renamed);
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toContainText(renamed, {
        timeout: 15_000,
      });
      await expect.poll(() => fetchAgentTitle(session.client, session.agentId)).toBe(renamed);
    } finally {
      await session.cleanup();
    }
  });
});

async function installTitlePreview(
  page: import("@playwright/test").Page,
  client: SeedDaemonClient,
) {
  const { SessionInboundMessageSchema } = await loadProtocolSchemas();
  const prompts: string[] = [];
  const envelope = z.object({ type: z.literal("session"), message: SessionInboundMessageSchema });
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => ws.send(message));
    ws.onMessage(async (message) => {
      if (typeof message !== "string") {
        server.send(message);
        return;
      }
      const parsed = envelope.safeParse(JSON.parse(message));
      if (!parsed.success || parsed.data.message.type !== "agent.titles.preview.request") {
        server.send(message);
        return;
      }
      const request = parsed.data.message;
      prompts.push(request.prompt);
      const directory = await client.fetchAgents({ scope: "active" });
      const titles = new Map<string, string | null>();
      for (const entry of directory.entries) titles.set(entry.agent.id, entry.agent.title ?? null);
      const proposals = request.agentIds.map((agentId) => {
        const previousTitle = titles.get(agentId) ?? null;
        return { agentId, previousTitle, title: `Suggested ${previousTitle}` };
      });
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "agent.titles.preview.response",
            payload: { requestId: request.requestId, proposals, skipped: [] },
          },
        }),
      );
    });
  });
  return prompts;
}

test("open-session picker sorts, switches, previews names and preserves concurrent edits", async ({
  page,
}) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "open-session-picker-",
    title: "Alpha task",
  });
  try {
    const beta = await session.client.createAgent({
      provider: "mock",
      model: "e2e-fast-stream",
      modeId: "load-test",
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      title: "Beta task",
    });
    const prompts = await installTitlePreview(page, session.client);
    await openAgentRoute(page, session);
    await expectWorkspaceTabVisible(page, session.agentId);
    await openAgentRoute(page, { workspaceId: session.workspaceId, agentId: beta.id });
    await expectWorkspaceTabVisible(page, beta.id);
    const trigger = page.getByTestId("session-picker-trigger").filter({ visible: true }).first();
    await trigger.click();
    const picker = page.getByTestId("combobox-desktop-container");
    await expect(
      picker.getByRole("button", { name: /Alpha task|Beta task/ }).first(),
    ).toHaveAttribute("aria-label", "Beta task");
    await picker.getByRole("button", { name: "Alpha task", exact: true }).click();
    await expect(
      page.getByTestId(`workspace-tab-agent_${session.agentId}`).first(),
    ).toHaveAttribute("aria-selected", "true");
    await trigger.click();
    await page.screenshot({ path: test.info().outputPath("session-picker-desktop.png") });
    await page.getByTestId("session-picker-rename").click();
    const sheet = page.getByTestId("session-rename-sheet");
    await expect(sheet).toBeVisible();
    const instructions = page.getByTestId("session-rename-prompt");
    await instructions.fill("Use concise Chinese task names");
    await page.getByTestId("session-rename-generate").click();
    await expect(page.getByTestId(`session-rename-title-${session.agentId}`)).toHaveValue(
      "Suggested Alpha task",
    );
    expect(prompts).toEqual(["Use concise Chinese task names"]);
    expect(await fetchAgentTitle(session.client, session.agentId)).toBe("Alpha task");
    await sheet.getByRole("checkbox", { name: "Beta task", exact: true }).click();
    await session.client.updateAgent(session.agentId, { name: "Changed elsewhere" });
    await page.getByTestId("session-rename-apply").click();
    await expect(sheet).toContainText("Name changed elsewhere");
    expect(await fetchAgentTitle(session.client, session.agentId)).toBe("Changed elsewhere");
    expect(await fetchAgentTitle(session.client, beta.id)).toBe("Beta task");
    await page.getByTestId("session-rename-generate").click();
    await expect(page.getByTestId(`session-rename-title-${session.agentId}`)).toHaveValue(
      "Suggested Changed elsewhere",
    );
    await sheet.getByRole("checkbox", { name: "Beta task", exact: true }).click();
    await page.getByTestId(`session-rename-title-${session.agentId}`).fill("My chosen title");
    await page.screenshot({ path: test.info().outputPath("session-rename-preview.png") });
    await page.getByTestId("session-rename-apply").click();
    await expect(sheet).toContainText("Applied");
    await expect
      .poll(() => fetchAgentTitle(session.client, session.agentId))
      .toBe("My chosen title");
    expect(await fetchAgentTitle(session.client, beta.id)).toBe("Beta task");
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.setViewportSize(MOBILE_VIEWPORT);
    await trigger.click();
    await expect(page.getByRole("button", { name: "My chosen title", exact: true })).toBeVisible();
    await page.getByTestId("session-picker-rename").click();
    await expect(instructions).toHaveValue("Use concise Chinese task names");
    await page.getByTestId("session-rename-generate").click();
    await expect(page.getByTestId(`session-rename-title-${session.agentId}`)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("session-rename-compact.png") });
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
  } finally {
    await session.cleanup();
  }
});
