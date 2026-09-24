import { test, expect } from "../support/fixtures";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { expectAgentTabActive } from "../support/helpers/launcher";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  detachSubagentFromTrack,
  expectSubagentRowGone,
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithSubagent,
  seedParentWithCrossWorkspaceSubagent,
} from "../support/helpers/subagents";

test.describe("Subagent detach", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subagent-detach-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("detaching a subagent focuses it as a workspace tab", async ({ page }) => {
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Detach parent",
      childTitle: "Detached child",
    });

    await openAgentRoute(page, {
      workspaceId: agents.workspaceId,
      agentId: agents.parent.id,
    });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, agents.child.id);

    await detachSubagentFromTrack(page, agents.child.id);

    await expectSubagentRowGone(page, agents.child.id);
    await expectWorkspaceTabVisible(page, agents.child.id);
    await expectAgentTabActive(page, agents.child.id);
    await expect(page.getByTestId("parent-agent-navigation").filter({ visible: true })).toHaveCount(
      0,
    );
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`returns to the parent without closing the child at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const agents = await seedParentWithSubagent(workspace, {
        parentTitle: "Return parent",
        childTitle: "Return child",
      });
      await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.child.id });
      const openParent = page
        .getByRole("button", { name: "Go to parent agent" })
        .filter({ visible: true });
      await expect(openParent).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("parent-navigation.png") });
      await openParent.click();
      await page.getByTestId("subagents-track-header").filter({ visible: true }).click();
      await expectSubagentRowVisible(page, agents.child.id);
      await expect(
        workspace.client.fetchAgent({ agentId: agents.child.id }),
      ).resolves.toMatchObject({
        agent: { id: agents.child.id, archivedAt: null },
      });
      await expect(
        page.getByTestId("parent-agent-navigation").filter({ visible: true }),
      ).toHaveCount(0);
    });
  }

  test("opens the parent in its own workspace", async ({ page }) => {
    const agents = await seedParentWithCrossWorkspaceSubagent(workspace, {
      parentTitle: "Other workspace parent",
      childTitle: "Other workspace child",
    });
    await openAgentRoute(page, {
      workspaceId: agents.child.workspaceId,
      agentId: agents.child.id,
    });
    await page
      .getByRole("button", { name: "Go to parent agent" })
      .filter({ visible: true })
      .click();
    await expectAgentTabActive(page, agents.parent.id);
    await expect(page).toHaveURL(new RegExp(`/workspace/${agents.parent.workspaceId}`));
  });
});
