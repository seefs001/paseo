import { expect, test, type Page } from "../support/fixtures";
import { composerLocator, expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openSettings } from "../support/helpers/app";
import {
  expectSessionRowArchived,
  expectWorkspaceTabHidden,
  expectWorkspaceTabVisible,
  openSessions,
} from "../support/helpers/archive-tab";

interface SlashCommandScenario {
  agentId: string;
  workspaceId: string;
  title: string;
}

const REPLACEMENT_PROMPT = "Replacement prompt after slash clear.";

async function withOpenReadyMockAgent(
  page: Page,
  input: {
    title: string;
    model?: string;
    modeId?: string;
  },
  run: (scenario: SlashCommandScenario) => Promise<void>,
): Promise<void> {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "client-slash-command-",
    title: input.title,
    model: input.model,
    modeId: input.modeId,
    initialPrompt: "Prepare a client slash command test agent.",
  });

  try {
    await openAgentRoute(page, session);
    await expectWorkspaceTabVisible(page, session.agentId);
    await expectComposerVisible(page);

    await run({ agentId: session.agentId, workspaceId: session.workspaceId, title: input.title });
  } finally {
    await session.cleanup();
  }
}

async function runClientSlashCommand(page: Page, command: "/quit" | "/clear"): Promise<void> {
  const input = composerLocator(page);
  await expect(input).toBeEditable({ timeout: 30_000 });
  await input.fill(command);
  await expect(input).toHaveValue(command);
  await input.press("Enter");
}

async function selectClientSlashCommand(page: Page, query: string, label: string): Promise<void> {
  const input = composerLocator(page);
  await expect(input).toBeEditable({ timeout: 30_000 });
  await input.fill(query);
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await input.press("Enter");
}

async function expectAgentArchivedInSessions(page: Page, title: string): Promise<void> {
  await openSessions(page);
  await expectSessionRowArchived(page, title);
}

async function expectReplacementDraftMatchesPreviousSetup(page: Page): Promise<void> {
  await expectComposerVisible(page);
  await expect(
    page.getByRole("button", { name: "Select model (Ten second stream)" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Select agent mode (Load test)" })).toBeVisible();
}

async function createAgentFromReplacementDraft(page: Page): Promise<void> {
  await submitMessage(page, REPLACEMENT_PROMPT);
}

async function waitForReplacementAgentId(page: Page, oldAgentId: string): Promise<string> {
  let newAgentId: string | null = null;
  await expect
    .poll(
      async () => {
        const ids = await page
          .locator('[data-testid^="workspace-tab-agent_"]')
          .evaluateAll((nodes) =>
            nodes.flatMap((node) => {
              if (!(node instanceof HTMLElement)) {
                return [];
              }
              const testId = node.getAttribute("data-testid") ?? "";
              if (!testId.startsWith("workspace-tab-agent_")) {
                return [];
              }
              if (node.offsetParent === null) {
                return [];
              }
              return [testId.slice("workspace-tab-agent_".length)];
            }),
          );
        newAgentId = ids.find((id) => id !== oldAgentId) ?? null;
        return newAgentId;
      },
      { timeout: 30_000 },
    )
    .not.toBeNull();
  if (!newAgentId) {
    throw new Error("Replacement agent was not created.");
  }
  return newAgentId;
}

async function openCustomCommands(page: Page): Promise<void> {
  await openSettings(page);
  await page
    .getByTestId("settings-sidebar")
    .getByRole("button", {
      name: "Custom commands",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("custom-commands-section")).toBeVisible();
}

async function seedAutoSendCommand(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({
        language: "en",
        customCommands: [
          {
            id: "custom-auto",
            name: "qaprompt",
            description: "Send a configured prompt",
            prompt: "Explain the current changes in plain language.",
            autoSend: true,
          },
        ],
      }),
    );
  });
}

async function selectAutoSendCommand(page: Page): Promise<void> {
  const input = composerLocator(page);
  await input.fill("/qapro");
  const option = page
    .getByTestId("composer-autocomplete-popover")
    .getByText("/qaprompt", { exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

async function deleteCustomCommand(page: Page): Promise<void> {
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-testid^="custom-command-delete-"]').click();
}

test.describe("Custom commands", () => {
  test("settings create, edit, persist and delete a prompt used by the composer", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await withOpenReadyMockAgent(page, { title: "Custom command settings" }, async (session) => {
      await openCustomCommands(page);
      await page.getByTestId("custom-command-add").click();
      await page.getByTestId("custom-command-name").fill("/qareview");
      await page.getByTestId("custom-command-description").fill("Review my local changes");
      await page.getByTestId("custom-command-prompt").fill("Review the current changes.");
      await expect(page.getByTestId("custom-command-auto-send")).not.toBeChecked();
      await page.getByTestId("custom-command-save").click();
      await expect(page.getByText("/qareview", { exact: true })).toBeVisible();

      await page.reload();
      await page.locator('[data-testid^="custom-command-edit-"]').click();
      await expect(page.getByTestId("custom-command-name")).toHaveValue("qareview");
      await expect(page.getByTestId("custom-command-description")).toHaveValue(
        "Review my local changes",
      );
      const prompt = "Review the current changes.\nReport only actionable findings.";
      await page.getByTestId("custom-command-prompt").fill(prompt);
      await page.getByTestId("custom-command-save").click();
      await expect(page.getByTestId("custom-command-form")).not.toBeVisible();

      await openAgentRoute(page, session);
      const input = composerLocator(page);
      await input.fill("/qarev");
      await expect(
        page.getByTestId("composer-autocomplete-popover").getByRole("button", {
          name: "/qareview. Review my local changes",
          exact: true,
        }),
      ).toBeVisible();
      await input.press("Enter");
      await expect(input).toHaveValue(prompt);
      await expect(
        page.getByTestId("user-message").filter({ hasText: "Report only actionable findings." }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(
        page.getByTestId("user-message").filter({ hasText: "Report only actionable findings." }),
      ).toBeVisible();
      await expect(input).toHaveValue("");

      await openCustomCommands(page);
      await deleteCustomCommand(page);
      await expect(page.getByTestId("custom-commands-empty")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("custom-commands-empty")).toBeVisible();
    });
  });

  test("selecting an auto-send command submits the expanded prompt", async ({ page }) => {
    await seedAutoSendCommand(page);
    await withOpenReadyMockAgent(page, { title: "Custom command auto-send" }, async () => {
      await selectAutoSendCommand(page);
      await expect(
        page.getByTestId("user-message").filter({
          hasText: "Explain the current changes in plain language.",
        }),
      ).toBeVisible();
      await expect(composerLocator(page)).toHaveValue("");
      await submitMessage(page, "/qaprompt Focus on testing.");
      await expect(
        page.getByTestId("user-message").filter({
          hasText: "Explain the current changes in plain language. Focus on testing.",
        }),
      ).toBeVisible();
    });
  });

  test("a failed auto-send keeps the expanded prompt available for retry", async ({ page }) => {
    await seedAutoSendCommand(page);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "custom-command-retry-",
      title: "Custom command retry",
      featureValues: { mockPromptRejections: 1 },
    });
    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await selectAutoSendCommand(page);
      await expect(
        page.getByText("Requested mock prompt rejection", { exact: true }),
      ).toBeVisible();
      await expect(composerLocator(page)).toHaveValue(
        "Explain the current changes in plain language.",
      );
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(
        page.getByTestId("user-message").filter({
          hasText: "Explain the current changes in plain language.",
        }),
      ).toBeVisible();
      await expect(composerLocator(page)).toHaveValue("");
      await expect(
        page.getByText("Requested mock prompt rejection", { exact: true }),
      ).not.toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
});

test.describe("Client slash commands", () => {
  test("slash quit archives the active agent and removes its tab", async ({ page }) => {
    await withOpenReadyMockAgent(page, { title: "Slash quit e2e" }, async ({ agentId, title }) => {
      await runClientSlashCommand(page, "/quit");
      await expectWorkspaceTabHidden(page, agentId);
      await expectAgentArchivedInSessions(page, title);
    });
  });

  test("slash quit selected from autocomplete archives immediately", async ({ page }) => {
    await withOpenReadyMockAgent(
      page,
      { title: "Slash quit autocomplete e2e" },
      async ({ agentId, title }) => {
        await selectClientSlashCommand(page, "/qu", "/exit");
        await expectWorkspaceTabHidden(page, agentId);
        await expectAgentArchivedInSessions(page, title);
      },
    );
  });

  test("slash clear replaces the active agent with a matching draft", async ({ page }) => {
    await withOpenReadyMockAgent(
      page,
      { title: "Slash clear e2e", model: "ten-second-stream", modeId: "load-test" },
      async ({ agentId, title }) => {
        await runClientSlashCommand(page, "/clear");
        await expectWorkspaceTabHidden(page, agentId);
        await expectReplacementDraftMatchesPreviousSetup(page);
        await createAgentFromReplacementDraft(page);
        await waitForReplacementAgentId(page, agentId);
        await expectAgentArchivedInSessions(page, title);
      },
    );
  });
});
