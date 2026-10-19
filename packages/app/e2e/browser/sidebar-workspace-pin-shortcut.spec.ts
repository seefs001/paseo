import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  expectNewWorkspaceProjectSelected,
  openNewWorkspaceComposer,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";

// The pin shortcut used to be registered by the sidebar row itself, so it silently did nothing
// whenever the row was unmounted — a collapsed project section being the common case. It now
// lives in a single always-mounted handler keyed on the active route selection.
const PIN_SHORTCUT = "ControlOrMeta+Shift+P";

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

function pinnedSection(page: Page) {
  return page.getByTestId("sidebar-pinned-section");
}

// Opens the workspace so it becomes the active route selection, which is what the shortcut acts on.
async function openWorkspace(page: Page, workspaceId: string) {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
}

// The project key is host-scoped and not exposed by the seed helper, so the header is addressed by
// its display name, scoped to project rows so a workspace row can never match. Pressing the header
// toggles the section, which unmounts every workspace row under it.
async function collapseProjectSection(page: Page, project: SeededWorkspace): Promise<void> {
  const header = page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: project.projectDisplayName });
  await expect(header).toHaveCount(1, { timeout: 30_000 });

  await header.click();
  await expect(workspaceRow(page, project.workspaceId)).toHaveCount(0, { timeout: 10_000 });
}

async function switchToStatusGrouping(page: Page): Promise<void> {
  await selectSidebarStatusGrouping(page);
  await expect(page.getByTestId("sidebar-status-list-scroll")).toBeVisible({ timeout: 10_000 });
}

// Status mode buckets workspaces by state rather than project, so the group holding this workspace
// is discovered from the rows container it sits in rather than assumed.
async function collapseStatusGroupContaining(page: Page, workspaceId: string): Promise<void> {
  const rows = page
    .locator('[data-testid^="sidebar-status-group-rows-"]')
    .filter({ has: workspaceRow(page, workspaceId) });
  await expect(rows).toHaveCount(1, { timeout: 30_000 });

  const rowsTestId = await rows.getAttribute("data-testid");
  const bucket = rowsTestId?.replace("sidebar-status-group-rows-", "");
  expect(bucket).toBeTruthy();

  await page.getByTestId(`sidebar-status-group-${bucket}`).click();
  await expect(workspaceRow(page, workspaceId)).toHaveCount(0, { timeout: 10_000 });
}

function readSessionMessage(
  message: string | Buffer,
): { type?: unknown; requestId?: unknown } | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    if (envelope.type !== "session" || typeof envelope.message !== "object") {
      return null;
    }
    return envelope.message as { type?: unknown; requestId?: unknown };
  } catch {
    return null;
  }
}

const PIN_REJECTION_MESSAGE = "Pin rejected by test.";

interface PinRpcGate {
  /** Pin requests the client has sent so far. */
  sentCount(): number;
  connectionCount(): number;
}

// Proxies everything so the app boots against the real daemon, counting pin RPCs and optionally
// rejecting the first `rejectFirst` of them. The count asserts how many pins one keypress actually
// dispatched, which the rendered pin state cannot show — a toggle that fired twice lands back
// where it started.
async function installPinRpcGate(
  page: Page,
  options: { rejectFirst?: number; disconnectFirst?: number } = {},
): Promise<PinRpcGate> {
  const rejectFirst = options.rejectFirst ?? 0;
  const disconnectFirst = options.disconnectFirst ?? 0;
  let sent = 0;
  let connections = 0;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = readSessionMessage(message);
      if (
        sessionMessage?.type === "workspace.pin.set.request" &&
        typeof sessionMessage.requestId === "string"
      ) {
        sent += 1;
        if (sent <= disconnectFirst) {
          ws.close({ code: 1011, reason: "Connection interrupted by test" });
          return;
        }
        if (sent <= rejectFirst) {
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: sessionMessage.requestId,
                  requestType: "workspace.pin.set.request",
                  error: PIN_REJECTION_MESSAGE,
                  code: "transport",
                },
              },
            }),
          );
          return;
        }
      }

      try {
        server.send(message);
      } catch {
        // server socket already closed
      }
    });

    server.onMessage((message) => {
      if (readSessionMessage(message)?.type === "status") {
        connections += 1;
      }
      try {
        ws.send(message);
      } catch {
        // client socket already closed
      }
    });
  });

  return { sentCount: () => sent, connectionCount: () => connections };
}

async function addPinnedWorkspaces(seeded: SeededWorkspace, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const created = await seeded.client.createWorkspace({
      source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
      title: `Pinned workspace ${index + 1}`,
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create pinned workspace");
    }
    await seeded.client.setWorkspacePinned(created.workspace.id, true);
    ids.push(created.workspace.id);
  }
  return ids;
}

async function unpinAll(page: Page): Promise<void> {
  await page.getByTestId("sidebar-pinned-actions").click();
  await page.getByTestId("sidebar-unpin-all").click();
}

test.describe("Unpin all workspaces", () => {
  test("unpins collapsed and overflow items without archiving workspaces", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "unpin-all-overflow-" });
    try {
      const ids = await addPinnedWorkspaces(workspace, 21);
      await gotoAppShell(page);
      await expect(page.getByTestId("sidebar-pinned-show-more")).toBeVisible();
      await expect(
        pinnedSection(page).locator('[data-testid^="sidebar-workspace-row-"]'),
      ).toHaveCount(20);

      await page.getByTestId("sidebar-pinned-section-header").click();
      await expect(page.getByTestId("sidebar-pinned-list")).toHaveCount(0);
      await unpinAll(page);

      await expect(pinnedSection(page)).toHaveCount(0);
      const remaining = await workspace.client.fetchWorkspaces();
      expect(remaining.entries.map((entry) => entry.id).sort()).toEqual(
        [workspace.workspaceId, ...ids].sort(),
      );
      expect(remaining.entries).toEqual(
        expect.arrayContaining(ids.map((id) => expect.objectContaining({ id, pinnedAt: null }))),
      );
      await page.reload();
      await expect(workspaceRow(page, ids[20])).toBeVisible();
      await expect(pinnedSection(page)).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("unpins every workspace in status grouping", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "unpin-all-status-" });
    try {
      const ids = await addPinnedWorkspaces(workspace, 2);
      await gotoAppShell(page);
      await switchToStatusGrouping(page);
      await unpinAll(page);

      await expect(pinnedSection(page)).toHaveCount(0);
      await expect(workspaceRow(page, workspace.workspaceId)).toBeVisible();
      for (const id of ids) {
        await expect(workspaceRow(page, id)).toBeVisible();
      }
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows a persistent error after a disconnect and allows retry", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "unpin-all-disconnect-" });
    try {
      await addPinnedWorkspaces(workspace, 2);
      const gate = await installPinRpcGate(page, { disconnectFirst: 1 });
      await gotoAppShell(page);
      await unpinAll(page);

      await expect(page.getByTestId("sidebar-unpin-all-error")).toBeVisible();
      await expect(page.getByTestId("sidebar-unpin-all-error")).toContainText(
        "Unable to unpin all workspaces. Try again.",
      );
      await expect.poll(() => gate.connectionCount()).toBeGreaterThan(1);
      await expect(page.getByTestId("sidebar-unpin-all")).toBeEnabled();
      await page.getByTestId("sidebar-unpin-all").click();
      await expect(pinnedSection(page)).toHaveCount(0);
      await expect(page.getByTestId("sidebar-unpin-all-error")).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Pin workspace shortcut", () => {
  test("dispatches pin once and keeps project creation reachable", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "pin-project-creation-",
      title: "Pinned workspace",
    });

    try {
      const gate = await installPinRpcGate(page);

      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await test.step("sends one RPC for each pin transition", async () => {
        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
        expect(gate.sentCount()).toBe(1);

        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
        expect(gate.sentCount()).toBe(2);
        await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);
      });

      await test.step("keeps the pinned project available to workspace creation", async () => {
        await page.keyboard.press(PIN_SHORTCUT);
        await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
        expect(gate.sentCount()).toBe(3);

        await openNewWorkspaceComposer(page, workspace);
        await expectNewWorkspaceProjectSelected(page, workspace.projectDisplayName);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("pins the active workspace while its project section is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-collapsed-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);
      await collapseProjectSection(page, workspace);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      await expect(
        pinnedSection(page).getByTestId(
          `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
        ),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("unpins the active workspace while the Pinned section is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-unpin-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);
      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });

      await page.getByTestId("sidebar-pinned-section-header").click();
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(0, { timeout: 10_000 });

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("pins the active workspace while its status group is collapsed", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-status-" });

    try {
      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);
      await switchToStatusGrouping(page);
      await collapseStatusGroupContaining(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      await expect(
        pinnedSection(page).getByTestId(
          `sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`,
        ),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("shows an error toast when the host rejects the pin, and the next press succeeds", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "pin-shortcut-failure-" });

    try {
      const gate = await installPinRpcGate(page, { rejectFirst: 1 });

      await gotoAppShell(page);
      await openWorkspace(page, workspace.workspaceId);

      await page.keyboard.press(PIN_SHORTCUT);

      await expect(page.getByTestId("app-toast-message")).toContainText(PIN_REJECTION_MESSAGE, {
        timeout: 10_000,
      });
      await expect(pinnedSection(page)).toHaveCount(0);
      await expect(workspaceRow(page, workspace.workspaceId)).toHaveCount(1);

      // The failure must leave the action usable: the in-flight guard has to release the key so a
      // retry is not swallowed. Without that release the workspace is unpinnable for the session.
      await page.keyboard.press(PIN_SHORTCUT);

      await expect(pinnedSection(page)).toBeVisible({ timeout: 10_000 });
      expect(gate.sentCount()).toBe(2);
    } finally {
      await workspace.cleanup();
    }
  });
});
