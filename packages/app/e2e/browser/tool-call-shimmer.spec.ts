import { test, expect } from "../support/fixtures";
import { gateSecondToolCall } from "../support/helpers/tool-call-gate";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("keeps a retained overview heading free of an infinite shimmer when it starts loading", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ chatDisplay: "collapseToolCalls" }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-shimmer-",
    title: "Tool-call shimmer",
    model: "ten-second-stream",
  });

  try {
    const gate = await gateSecondToolCall(page, agent.agentId);
    await openAgentRoute(page, {
      workspaceId: agent.workspaceId,
      agentId: agent.agentId,
    });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Prove the overview shimmer lifecycle.");

    await gate.waitForFirstCompleted();
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();
    const idleGroupHandle = await group.elementHandle();
    if (!idleGroupHandle) {
      throw new Error("Expected the idle tool-call group to be mounted");
    }
    await expect(group.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);

    await gate.waitForSecondRunning();
    gate.releaseSecondRunning();
    await expect(group.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    const sameGroupNode = await group.evaluate(
      (node, previous) => node === previous,
      idleGroupHandle,
    );

    expect(sameGroupNode).toBe(true);
  } finally {
    await agent.cleanup();
  }
});
