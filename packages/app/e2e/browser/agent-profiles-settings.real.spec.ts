import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import {
  agentProfileRow,
  expectHostAgentProfiles,
  openAgentProfileSettings,
  seedAgentProfiles,
  seedModelProvider,
} from "../support/helpers/agent-profiles";

test("Pi Fast is visible in profile editing and persists after saving", async ({
  page,
}, testInfo) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "paseo-profile-pi-"));
  const providerId = "pi-profile-controls";
  const modelId = "profile-probe/responses-model";
  const profile = {
    id: "agent_profile_pi_fast",
    name: "Pi priority",
    provider: providerId,
    model: modelId,
  };
  // Only discovery RPCs run. The loopback endpoint must never receive a model request.
  await writeFile(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "profile-probe": {
          api: "openai-responses",
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "local-discovery-only",
          models: [{ id: "responses-model" }],
        },
      },
    }),
  );
  const provider = await seedModelProvider({
    id: providerId,
    label: "Pi profile controls",
    extends: "pi",
    command: [
      "pi",
      "--offline",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
    ],
    env: { PI_CODING_AGENT_DIR: agentDir },
    models: [{ id: modelId, label: "Responses model", description: "Profile controls probe" }],
  });
  const profiles = await seedAgentProfiles([profile]);
  try {
    await openAgentProfileSettings(page);
    const row = agentProfileRow(page, profile.name);
    await row.getByRole("button", { name: "Edit profile", exact: true }).click();
    const modal = page.getByTestId("agent-profile-edit-modal");
    const fast = modal.getByRole("switch", { name: "Fast", exact: true });
    await expect(fast).toBeVisible({ timeout: 30_000 });
    await expect(fast).not.toBeChecked();
    await fast.click();
    await expect(fast).toBeChecked();
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expectHostAgentProfiles([{ ...profile, featureValues: { fast_mode: true } }]);

    await row.getByRole("button", { name: "Edit profile", exact: true }).click();
    await expect(fast).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("pi-profile-fast-enabled.png") });
    await fast.click();
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expectHostAgentProfiles([{ ...profile, featureValues: { fast_mode: false } }]);
  } finally {
    await profiles.restore();
    await provider.restore();
    await rm(agentDir, { recursive: true, force: true });
  }
});
