import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PASEO_AGENT_TOOL_NAMES } from "@getpaseo/protocol/paseo-agent-tools";

const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "paseo-tools.ts");

describe("Paseo agent tool names", () => {
  test("the settings list matches the tools the daemon registers", async () => {
    const source = await readFile(sourcePath, "utf8");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map(
      (match) => match[1],
    );
    expect(registered).toEqual([...PASEO_AGENT_TOOL_NAMES]);
  });
});
