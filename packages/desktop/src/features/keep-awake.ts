import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, powerSaveBlocker } from "electron";
import { z } from "zod";

const KeepAwakeSettingsSchema = z.object({ enabled: z.boolean() });
let enabled = true;
let blockerId: number | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "keep-awake.json");
}

function stopKeepAwake(): void {
  if (blockerId === null) return;
  powerSaveBlocker.stop(blockerId);
  blockerId = null;
}

function applyKeepAwake(): void {
  if (!enabled) {
    stopKeepAwake();
    return;
  }
  if (blockerId === null) {
    // Keep agents reachable without preventing the display from sleeping.
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
  }
}

export async function initializeKeepAwake(): Promise<void> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    enabled = KeepAwakeSettingsSchema.parse(JSON.parse(raw)).enabled;
  } catch (error) {
    const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!isMissing) throw error;
  }
  applyKeepAwake();
  app.once("quit", stopKeepAwake);
}

export function getKeepAwake(): boolean {
  return enabled;
}

export async function setKeepAwake(input: unknown): Promise<boolean> {
  const settings = KeepAwakeSettingsSchema.parse(input);
  const filePath = settingsPath();
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
  enabled = settings.enabled;
  applyKeepAwake();
  return enabled;
}
