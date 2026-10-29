import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DaemonConfigStore } from "./daemon-config-store.js";
import { saveDaemonPassword } from "./daemon-password.js";
import { loadPersistedConfig } from "./persisted-config.js";

describe("saveDaemonPassword", () => {
  const tempDirs: string[] = [];
  const previousEnv = process.env.PASEO_PASSWORD;

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.PASEO_PASSWORD;
    else process.env.PASEO_PASSWORD = previousEnv;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("stores a hash and never the password", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-password-"));
    tempDirs.push(paseoHome);
    saveDaemonPassword(paseoHome, "correct horse");

    const password = loadPersistedConfig(paseoHome).daemon?.auth?.password;
    expect(password).toMatch(/^\$2[aby]\$/);
    expect(password).not.toContain("correct horse");
    expect(JSON.stringify(loadPersistedConfig(paseoHome))).not.toContain("passwordSet");
  });

  test("refuses a password owned by the launch environment", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-password-"));
    tempDirs.push(paseoHome);
    process.env.PASEO_PASSWORD = "from-env";
    expect(() => saveDaemonPassword(paseoHome, "correct horse")).toThrow(/PASEO_PASSWORD/);
    expect(loadPersistedConfig(paseoHome).daemon?.auth?.password).toBeUndefined();
  });
});

describe("DaemonConfigStore password flag", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("records that a password is set without writing the flag to disk", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-daemon-config-store-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });

    const before = loadPersistedConfig(paseoHome);
    store.setPasswordConfigured(true);

    expect(store.get().passwordSet).toBe(true);
    expect(loadPersistedConfig(paseoHome)).toEqual(before);
  });
});
