import { expect, test, type Page } from "../support/fixtures";
import path from "node:path";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import {
  applyProfileFromPicker,
  drillIntoProvider,
  openModelPicker,
  seedAgentProfiles,
  seedModelProvider,
  expectComposerModel,
  expectComposerMode,
} from "../support/helpers/agent-profiles";
import { gotoWorkspace } from "../support/helpers/launcher";
import { createAgentTabFromMenu } from "../support/helpers/workspace-tabs";
import { getServerId } from "../support/helpers/server-id";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { fillComposerDraft } from "../support/helpers/composer";
import { gotoAppShell } from "../support/helpers/app";
import { captureWorkspaceAgentRequest } from "../support/helpers/creation";
import {
  connectNewWorkspaceDaemonClient,
  openGlobalNewWorkspaceComposer,
  selectNewWorkspaceProject,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

const CREATE_AGENT_PREFERENCES_KEY = "@paseo:create-agent-preferences";
const MODELESS_PROVIDER = "modeless-profile-e2e";
const MODELESS_MODEL = "pi-profile-model";

async function seedPoisonedModelessPreference(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey, provider, model }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          provider,
          providerPreferences: {
            [provider]: { model, mode: "full-access" },
            mock: { model: "ten-second-stream", mode: "load-test" },
          },
        } satisfies FormPreferences),
      );
    },
    {
      preferencesKey: CREATE_AGENT_PREFERENCES_KEY,
      provider: MODELESS_PROVIDER,
      model: MODELESS_MODEL,
    },
  );
}

async function readLastAgentProfile(page: Page): Promise<unknown> {
  return page.evaluate((host) => {
    const raw = localStorage.getItem("@paseo:create-agent-preferences");
    return raw ? JSON.parse(raw).lastAgentProfileByHost?.[host] : null;
  }, getServerId());
}

async function readProviderModePreference(page: Page, provider: string): Promise<unknown> {
  return page.evaluate(
    ({ preferencesKey, providerId }) => {
      const raw = localStorage.getItem(preferencesKey);
      if (!raw) return null;
      const preferences = JSON.parse(raw) as FormPreferences;
      return preferences.providerPreferences?.[providerId]?.mode ?? null;
    },
    { preferencesKey: CREATE_AGENT_PREFERENCES_KEY, providerId: provider },
  );
}

async function readProviderFeaturePreferences(page: Page, provider: string): Promise<unknown> {
  return page.evaluate(
    ({ preferencesKey, providerId }) => {
      const raw = localStorage.getItem(preferencesKey);
      if (!raw) return null;
      const preferences = JSON.parse(raw) as FormPreferences;
      return preferences.providerPreferences?.[providerId]?.featureValues ?? null;
    },
    { preferencesKey: CREATE_AGENT_PREFERENCES_KEY, providerId: provider },
  );
}

test.describe("Agent profiles repair modeless provider preferences", () => {
  test.describe.configure({ timeout: 240_000 });

  test("applying a profile heals a stale mode before returning to Pi", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "profile-modeless-preferences-" });
    const profiles = await seedAgentProfiles([
      {
        id: "agent_profile_modeless_repair",
        name: "Approval work",
        provider: "mock",
        model: "one-minute-stream",
        modeId: "approval-test",
      },
    ]);
    const provider = await seedModelProvider({
      id: MODELESS_PROVIDER,
      label: "Pi profile test",
      extends: "pi",
      command: [process.execPath, path.resolve("e2e/fixtures/fake-pi-rpc.mjs")],
      models: [
        {
          id: MODELESS_MODEL,
          label: "Pi profile model",
          description: "Modeless profile regression model",
        },
      ],
    });
    await seedPoisonedModelessPreference(page);
    const createAgentRecorder = await captureWorkspaceAgentRequest(page, { block: true });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);
      await selectNewWorkspaceProject(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

      await openModelPicker(page);
      await applyProfileFromPicker(page, "Approval work");

      await expect
        .poll(() => readProviderModePreference(page, MODELESS_PROVIDER), { timeout: 10_000 })
        .toBeNull();
      await expect
        .poll(() => readProviderModePreference(page, "mock"), { timeout: 10_000 })
        .toBe("approval-test");

      await openModelPicker(page);
      await drillIntoProvider(page, MODELESS_PROVIDER);
      await page.getByRole("button", { name: /Pi profile model/ }).click();

      await submitNewWorkspacePrompt(page, "Create a Pi agent after repairing preferences.");
      const createAgentRequest = await createAgentRecorder.waitForRequest();
      expect(createAgentRequest).toMatchObject({
        config: { provider: MODELESS_PROVIDER },
      });
      expect(createAgentRequest.config).not.toHaveProperty("modeId");
    } finally {
      await workspace.cleanup();
      await provider.restore();
      await profiles.restore();
    }
  });

  test("new drafts reload the complete last-used profile without changing open drafts", async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "profile-initialization-" });
    const providerId = "profile-initialization-e2e";
    const original = {
      id: "remembered-profile",
      name: "Remembered work",
      provider: providerId,
      model: "claude-opus-5",
      modeId: "bypassPermissions",
      thinkingOptionId: "low",
      featureValues: { fast_mode: false, auto_accept_mcp: true },
    };
    const profiles = await seedAgentProfiles([original]);
    const provider = await seedModelProvider({
      id: providerId,
      label: "Profile initialization",
      models: ["claude-opus-5", "claude-opus-4-6"].map((id) => ({
        id,
        label: id,
        description: id,
        thinkingOptions: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
      })),
    });
    const client = await connectNewWorkspaceDaemonClient();
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await createAgentTabFromMenu(page);
      await openModelPicker(page);
      await applyProfileFromPicker(page, original.name);
      await expectComposerModel(page, original.model);
      await expect.poll(() => readLastAgentProfile(page)).toBe(original.id);
      const latest = {
        ...original,
        model: "claude-opus-4-6",
        modeId: "plan",
        thinkingOptionId: "high",
        featureValues: { fast_mode: true, auto_accept_mcp: false },
      };
      await client.patchDaemonConfig({ agentProfiles: [latest] });
      await expectComposerModel(page, original.model);
      const fast = page
        .getByTestId("agent-feature-fast_mode")
        .filter({ visible: true })
        .locator("svg")
        .first();
      await expect(fast).toHaveCSS("stroke", "rgb(113, 113, 122)");

      await createAgentTabFromMenu(page);
      await expectComposerModel(page, latest.model);
      await expectComposerMode(page, "Plan mode");
      await expect(
        page
          .getByRole("button", { name: "Select thinking option (High)", exact: true })
          .filter({ visible: true }),
      ).toBeVisible();
      await expect(fast).toHaveCSS("stroke", "rgb(251, 191, 36)");
      await expect(
        page
          .getByTestId("agent-feature-auto_accept_mcp")
          .filter({ visible: true })
          .locator("svg")
          .first(),
      ).toHaveCSS("stroke", "rgb(113, 113, 122)");
      await page.screenshot({ path: testInfo.outputPath("restored-profile.png") });

      await page.getByTestId("agent-feature-fast_mode").filter({ visible: true }).click();
      await client.patchDaemonConfig({ agentProfiles: [{ ...latest, modeId: "default" }] });
      await expect(fast).toHaveCSS("stroke", "rgb(113, 113, 122)");
      await expectComposerMode(page, "Plan mode");
      await createAgentTabFromMenu(page);
      await expectComposerMode(page, "Always ask");
      await expect(fast).toHaveCSS("stroke", "rgb(251, 191, 36)");
    } finally {
      await client.close();
      await workspace.cleanup();
      await provider.restore();
      await profiles.restore();
    }
  });

  test("a failed profile initialization stays visible until retry succeeds", async ({ page }) => {
    test.setTimeout(150_000);
    const workspace = await seedWorkspace({ repoPrefix: "profile-initialization-retry-" });
    const profile = {
      id: "profile-retry",
      name: "Retry work",
      provider: "mock",
      model: "one-minute-stream",
      modeId: "approval-test",
    };
    const profiles = await seedAgentProfiles([profile]);
    const gate = await installDaemonWebSocketGate(page);
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await createAgentTabFromMenu(page);
      await openModelPicker(page);
      await applyProfileFromPicker(page, profile.name);
      await expect.poll(() => readLastAgentProfile(page)).toBe(profile.id);

      gate.holdNextServerMessage("get_daemon_config_response");
      await createAgentTabFromMenu(page);
      await gate.waitForHeldServerMessage("get_daemon_config_response");
      await fillComposerDraft(page, "Keep this draft while the profile loads.");
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }).filter({ visible: true }),
      ).toBeDisabled();
      const error = page.getByTestId("draft-profile-error").filter({ visible: true });
      await expect(error).toContainText("Timeout waiting for message", { timeout: 70_000 });
      // An expired response must not silently unblock submission or hide the failure.
      gate.releaseHeldServerMessage("get_daemon_config_response");
      await expect(error).toBeVisible();
      await error.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(error).toHaveCount(0);
      await expectComposerModel(page, "One minute stream");
      await expectComposerMode(page, "Approval test");
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }).filter({ visible: true }),
      ).toBeEnabled();
    } finally {
      await workspace.cleanup();
      await profiles.restore();
    }
  });

  test("cross-provider profile features survive immediate workspace creation", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "profile-feature-transition-" });
    const featureProviderId = "profile-feature-e2e";
    const featureModelId = "claude-opus-5";
    const profiles = await seedAgentProfiles([
      {
        id: "agent_profile_feature_transition",
        name: "Fast profile",
        provider: featureProviderId,
        model: featureModelId,
        modeId: "bypassPermissions",
        featureValues: { fast_mode: true },
      },
    ]);
    const provider = await seedModelProvider({
      id: featureProviderId,
      label: "Profile feature test",
      models: [
        {
          id: featureModelId,
          label: "Profile feature model",
          description: "Cross-provider feature regression model",
        },
      ],
    });
    const createAgentRecorder = await captureWorkspaceAgentRequest(page, { block: true });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openGlobalNewWorkspaceComposer(page);
      await selectNewWorkspaceProject(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

      await openModelPicker(page);
      await applyProfileFromPicker(page, "Fast profile");
      await expect
        .poll(() => readProviderFeaturePreferences(page, featureProviderId), { timeout: 10_000 })
        .toEqual({ fast_mode: true });
      await submitNewWorkspacePrompt(page, "Create an agent with profile features.");

      const createAgentRequest = await createAgentRecorder.waitForRequest();
      expect(createAgentRequest).toMatchObject({
        config: {
          provider: featureProviderId,
          featureValues: { fast_mode: true },
        },
      });
    } finally {
      await workspace.cleanup();
      await provider.restore();
      await profiles.restore();
    }
  });
});
