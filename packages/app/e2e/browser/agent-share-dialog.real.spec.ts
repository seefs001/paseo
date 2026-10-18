import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { waitForSettledPosition } from "../support/helpers/sheet-layout";
import {
  composerLocator,
  expectComposerVisible,
  submitMessageWithButton,
} from "../support/helpers/composer";

// An empty, offline Pi session fails export. A PATH shim also blocks all Gist uploads.
const piHome = path.join(tmpdir(), `paseo-share-dialog-pi-${randomUUID()}`);
test.use({
  e2eDaemonEnvironment: {
    PATH: `${path.join(piHome, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    PI_CODING_AGENT_DIR: piHome,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  },
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        pi: {
          enabled: true,
          command: [
            "pi",
            "--offline",
            "--no-extensions",
            "--no-mcp",
            "--no-skills",
            "--no-context-files",
            "--no-themes",
            "--no-prompt-templates",
            "--no-tools",
          ],
        },
      },
    },
  },
});

test.beforeAll(async () => {
  await mkdir(path.join(piHome, "bin"), { recursive: true });
  await writeFile(
    path.join(piHome, "bin", "gh"),
    "#!/bin/sh\nprintf 'Gist uploads are blocked in this test\\n' >&2\nexit 1\n",
    { mode: 0o755 },
  );
});
test.afterAll(async () => {
  await rm(piHome, { recursive: true, force: true });
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "compact", width: 390, height: 844 },
]) {
  test(`session sharing stays in a dialog without chat messages (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const gate = await installDaemonWebSocketGate(page);
    const workspace = await seedWorkspace({
      repoPrefix: "pi-share-dialog-",
      title: `Pi share ${viewport.name}`,
    });
    const observer = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "share-observer" });
    try {
      const agent = await workspace.client.createAgent({
        provider: "pi",
        cwd: workspace.workspaceDirectory,
        workspaceId: workspace.workspaceId,
        title: "Share dialog fixture",
      });
      const before = await observer.fetchAgentTimeline(agent.id);
      gate.holdNextServerMessage("agent.session.share.response");
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expectComposerVisible(page);
      await submitMessageWithButton(page, "/share");
      await gate.waitForHeldServerMessage("agent.session.share.response");
      await expect(page.getByTestId("agent-share-pending")).toBeVisible();
      await expect(page.getByTestId("agent-share-close")).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("agent-share-pending")).toBeVisible();
      gate.releaseHeldServerMessage("agent.session.share.response");
      await expect(page.getByTestId("agent-share-error")).toContainText("HTML export failed");
      await waitForSettledPosition(page.getByTestId("agent-share-retry"));
      await page.screenshot({ path: testInfo.outputPath(`share-dialog-${viewport.name}.png`) });

      gate.holdNextServerMessage("agent.session.share.response");
      await page.getByTestId("agent-share-retry").click();
      await gate.waitForHeldServerMessage("agent.session.share.response");
      await expect(page.getByTestId("agent-share-pending")).toBeVisible();
      gate.releaseHeldServerMessage("agent.session.share.response");
      await expect(page.getByTestId("agent-share-error")).toContainText("HTML export failed");
      await page.getByTestId("agent-share-close").click();
      await expect(page.getByTestId("agent-share-dialog")).not.toBeVisible();
      await expect(composerLocator(page)).toHaveValue("");
      const after = await observer.fetchAgentTimeline(agent.id);
      expect(after.entries).toEqual(before.entries);
      expect(after.window.nextSeq).toBe(before.window.nextSeq);
    } finally {
      await observer.close();
      await workspace.cleanup();
    }
  });
}
