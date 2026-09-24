import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { writeFileAtomic } from "../../atomic-file.js";
import type { AgentSessionConfig } from "../agent-sdk-types.js";
import { composeSystemPromptParts } from "../system-prompt.js";

const MANAGED_HEADER =
  "---\nalwaysApply: true\n---\n<!-- Managed by Paseo. Edit System prompt in Paseo Settings. -->\n\n";
// ponytail: serialize short file updates; use per-workspace queues if launch contention matters.
const writeRules = pLimit(1);

export function syncCursorRules(config: AgentSessionConfig): Promise<void> {
  return writeRules(async () => {
    const filePath = path.resolve(config.cwd, ".cursor", "rules", "paseo.mdc");
    const instructions = composeSystemPromptParts(
      config.systemPrompt,
      config.daemonAppendSystemPrompt,
    );
    let existing: string | undefined;
    try {
      const entry = await lstat(filePath);
      if (!entry.isFile()) {
        if (!instructions) return;
        throw new Error(
          `Cursor rule ${filePath} is not managed by Paseo; move it before setting a system prompt.`,
        );
      }
      existing = await readFile(filePath, "utf8");
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!missing) throw error;
    }
    const managed = existing?.startsWith(MANAGED_HEADER) === true;
    if (!instructions) {
      if (managed) await unlink(filePath);
      return;
    }
    if (existing !== undefined && !managed) {
      throw new Error(
        `Cursor rule ${filePath} is not managed by Paseo; move it before setting a system prompt.`,
      );
    }
    const content = `${MANAGED_HEADER}${instructions}\n`;
    if (content === existing) return;
    if (existing === undefined) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, { flag: "wx" });
      return;
    }
    await writeFileAtomic(filePath, content);
  });
}
