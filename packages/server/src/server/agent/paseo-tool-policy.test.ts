import { describe, expect, test } from "vitest";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";

import {
  isPaseoToolEnabled,
  mergeHostDisabledTools,
  resolvePaseoToolPolicy,
} from "./paseo-tool-policy.js";

describe("Paseo tool policy", () => {
  test("defaults to all Paseo tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderPaseoToolsPolicy;

    expect(
      resolvePaseoToolPolicy("custom-claude", {
        claude: { paseoTools: { enabled: false } },
        "custom-claude": { paseoTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(resolvePaseoToolPolicy("other-custom", { claude: { paseoTools: customPolicy } })).toBe(
      undefined,
    );
    expect(isPaseoToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isPaseoToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isPaseoToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isPaseoToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isPaseoToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });

  test("host settings disable tools without turning the provider policy off", () => {
    expect(mergeHostDisabledTools(undefined, undefined)).toBeUndefined();
    expect(mergeHostDisabledTools({ enabled: true }, [])).toEqual({ enabled: true });
    expect(
      mergeHostDisabledTools({ enabled: true, disabledTools: ["list_agents"] }, [
        "kill_agent",
        "list_agents",
      ]),
    ).toEqual({
      enabled: true,
      disabledTools: ["list_agents", "kill_agent"],
    });
    expect(
      isPaseoToolEnabled(mergeHostDisabledTools(undefined, ["kill_agent"]), "kill_agent"),
    ).toBe(false);
    expect(isPaseoToolEnabled(mergeHostDisabledTools(undefined, ["speak"]), "speak")).toBe(true);
  });
});
