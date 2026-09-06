import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";

test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        grok: { extends: "acp", label: "Grok", command: ["grok", "agent", "stdio"] },
      },
    },
  },
});

test("shows real Grok output speed in the usage tooltip on wide and compact layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const workspace = await seedWorkspace({ repoPrefix: "grok-token-speed-" });
  try {
    const agent = await workspace.client.createAgent({
      provider: "grok",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Grok token speed",
      initialPrompt: "Reply with exactly: Hello from Grok. Do not use tools or inspect files.",
    });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await expectComposerVisible(page);
    const finish = await workspace.client.waitForFinish(agent.id, 180_000);
    expect(finish.status).toBe("idle");
    expect(finish.final?.lastError ?? null).toBeNull();
    await testInfo.attach("agent-snapshot", {
      body: JSON.stringify(await workspace.client.fetchAgent({ agentId: agent.id })),
      contentType: "application/json",
    });

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const meter = page.getByTestId("context-window-meter");
      await expect(meter).toBeVisible();
      await meter.hover();
      const speed = page.getByTestId("output-token-speed");
      await expect(speed).toBeVisible();
      await expect(speed).toContainText(/Last turn average: \d+\.\d token\/s/);
      await expect(speed).toContainText("Includes model request waiting time.");
      await page.screenshot({
        path: testInfo.outputPath(`grok-token-speed-${width}.png`),
        animations: "disabled",
      });
      await page.mouse.move(0, 0);
      await expect(speed).not.toBeVisible();
    }
  } finally {
    await page.screenshot({ path: testInfo.outputPath("grok-token-speed-final.png") });
    await workspace.cleanup();
  }
});
