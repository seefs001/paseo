import { test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  expectStopAllGone,
  expectStopAllInProgress,
  expectStopAllRetry,
  expectSubagentRowVisible,
  holdSubagentStopRequest,
  openSubagentsTrack,
  rejectNextSubagentStopRequest,
  seedRunningSubagent,
  stopAllSubagents,
  stopSubagentFromTrack,
} from "../support/helpers/subagents";

test.describe("Stop subagents", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "stop-subagents-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("stops every running subagent from the track", async ({ page }) => {
    const parent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Stop-all parent",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    const child = await seedRunningSubagent(workspace, {
      parentId: parent.id,
      title: "Running child",
    });
    const gate = await holdSubagentStopRequest(page, child.id);

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, child.id);

    await stopAllSubagents(page);
    await gate.waitForRequest();
    await expectStopAllInProgress(page, 0, 1);

    gate.release();
    await workspace.client.waitForAgentUpsert(child.id, (snapshot) => snapshot.status === "idle");
    await expectStopAllGone(page);
    await expectSubagentRowVisible(page, child.id);
  });

  test("stops one running subagent from its row", async ({ page }) => {
    const parent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Row-stop parent",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    const child = await seedRunningSubagent(workspace, {
      parentId: parent.id,
      title: "Row child",
    });

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, child.id);

    await stopSubagentFromTrack(page, child.id);
    await workspace.client.waitForAgentUpsert(child.id, (snapshot) => snapshot.status === "idle");
    await expectStopAllGone(page);
    await expectSubagentRowVisible(page, child.id);
  });

  test("shows a retry when stopping all subagents fails", async ({ page }) => {
    const parent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Retry parent",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    const child = await seedRunningSubagent(workspace, {
      parentId: parent.id,
      title: "Retry child",
    });
    const rejection = await rejectNextSubagentStopRequest(page, child.id);

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, child.id);

    await stopAllSubagents(page);
    await rejection.waitForRejection();
    await expectStopAllRetry(page, 1, 1);

    await stopAllSubagents(page);
    await workspace.client.waitForAgentUpsert(child.id, (snapshot) => snapshot.status === "idle");
    await expectStopAllGone(page);
  });
});
