import { describe, expect, test } from "vitest";

import {
  PI_DEFAULT_DISABLED_TOOLS,
  PI_DISABLED_TOOLS_FEATURE_ID,
  formatPiDisabledTools,
  isPiToolDisabled,
  parsePiDisabledToolsValue,
  piEnabledToolGroupLabels,
  resolvePiDisabledTools,
  togglePiToolGroup,
} from "./pi-disabled-tools.js";

describe("Pi disabled tools", () => {
  test("disables ScopeWeaver until a session sets the value", () => {
    expect(resolvePiDisabledTools(undefined)).toEqual([...PI_DEFAULT_DISABLED_TOOLS]);
    expect(resolvePiDisabledTools({})).toEqual(["scopeweaver_*"]);
    expect(isPiToolDisabled("scopeweaver_create_task", resolvePiDisabledTools(undefined))).toBe(
      true,
    );
    expect(isPiToolDisabled("read", resolvePiDisabledTools(undefined))).toBe(false);
  });

  test("treats an explicit empty value as every group enabled", () => {
    expect(resolvePiDisabledTools({ [PI_DISABLED_TOOLS_FEATURE_ID]: "" })).toEqual([]);
    expect(parsePiDisabledToolsValue("scopeweaver_*, bash")).toEqual(["scopeweaver_*", "bash"]);
    expect(formatPiDisabledTools(["scopeweaver_*"])).toBe("scopeweaver_*");
  });

  test("rejects patterns that are not a single tool glob", () => {
    expect(() => parsePiDisabledToolsValue("scopeweaver_*/../../x")).toThrow(/Invalid/);
    expect(() => parsePiDisabledToolsValue(["*a*"])).toThrow(/Invalid/);
    expect(() => parsePiDisabledToolsValue(1)).toThrow(/require/);
    expect(resolvePiDisabledTools({ [PI_DISABLED_TOOLS_FEATURE_ID]: "../settings" })).toEqual([
      "scopeweaver_*",
    ]);
  });

  test("toggles one group and names only exceptions to the default", () => {
    const disabled = togglePiToolGroup(["scopeweaver_*"], "scopeweaver_*", true);
    expect(disabled).toEqual([]);
    expect(
      piEnabledToolGroupLabels(disabled, [{ label: "ScopeWeaver", pattern: "scopeweaver_*" }]),
    ).toEqual(["ScopeWeaver"]);
    expect(
      piEnabledToolGroupLabels(
        ["scopeweaver_*"],
        [{ label: "ScopeWeaver", pattern: "scopeweaver_*" }],
      ),
    ).toEqual([]);
    expect(togglePiToolGroup([], "scopeweaver_*", false)).toEqual(["scopeweaver_*"]);
  });
});
