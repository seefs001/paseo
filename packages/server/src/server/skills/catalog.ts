import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { SkillCatalogEntry, SkillsList } from "@getpaseo/protocol/skills";
import { writeJsonFileAtomic } from "../atomic-file.js";

const MetadataSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(16_384).default(""),
});
const UsageSchema = z.object({
  skills: z.record(
    z.string(),
    z.object({ count: z.number().int().nonnegative(), lastUsedAt: z.number().nonnegative() }),
  ),
  submissions: z.array(z.string()),
});
type Usage = z.infer<typeof UsageSchema>;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readSkill(skillPath: string): Promise<SkillCatalogEntry | null> {
  // Skill directories are often symlinks into a user's shared skills repository.
  const file = await fs.open(skillPath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    const content = await file.readFile("utf8");
    const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!frontmatter) return null;
    const document = parseDocument(frontmatter[1], { schema: "failsafe", uniqueKeys: true });
    if (document.errors.length > 0) return null;
    const metadata = MetadataSchema.safeParse(document.toJS({ maxAliasCount: 0 }));
    if (!metadata.success) return null;
    return { path: skillPath, ...metadata.data, usageCount: 0, lastUsedAt: 0 };
  } finally {
    await file.close();
  }
}

export class SkillCatalog {
  private readonly usagePath: string;
  private write: Promise<void> = Promise.resolve();

  constructor(
    paseoHome: string,
    private readonly directory = path.join(homedir(), ".agents", "skills"),
  ) {
    this.usagePath = path.join(paseoHome, "skill-usage.json");
  }

  private async readUsage(): Promise<Usage> {
    try {
      return UsageSchema.parse(JSON.parse(await fs.readFile(this.usagePath, "utf8")));
    } catch (error) {
      if (isMissing(error)) return { skills: {}, submissions: [] };
      throw error;
    }
  }

  async list(): Promise<Omit<SkillsList, "requestId">> {
    await this.write;
    return this.readCatalog();
  }

  private async readCatalog(): Promise<Omit<SkillsList, "requestId">> {
    const usage = await this.readUsage();
    let entries;
    try {
      entries = await fs.readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return { directory: this.directory, skills: [], skipped: 0 };
      throw error;
    }
    const skills: SkillCatalogEntry[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillPath = path.join(this.directory, entry.name, "SKILL.md");
      try {
        const canonicalPath = await fs.realpath(skillPath);
        if (seen.has(canonicalPath)) continue;
        const skill = await readSkill(skillPath);
        if (!skill) {
          skipped += 1;
          continue;
        }
        seen.add(canonicalPath);
        const recorded = usage.skills[skill.path];
        skill.usageCount = recorded?.count ?? 0;
        skill.lastUsedAt = recorded?.lastUsedAt ?? 0;
        skills.push(skill);
      } catch {
        // One broken link or unreadable/malformed skill must not hide the rest of the catalog.
        skipped += 1;
      }
    }
    skills.sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        b.lastUsedAt - a.lastUsedAt ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    );
    return { directory: this.directory, skills, skipped };
  }

  recordUsage(submissionId: string, paths: readonly string[]): Promise<void> {
    const operation = this.write.then(async () => {
      const usage = await this.readUsage();
      if (usage.submissions.includes(submissionId)) return undefined;
      const catalog = await this.readCatalog();
      const available = new Set(catalog.skills.map((skill) => skill.path));
      const now = Date.now();
      for (const skillPath of new Set(paths)) {
        if (!available.has(skillPath)) continue;
        usage.skills[skillPath] = {
          count: (usage.skills[skillPath]?.count ?? 0) + 1,
          lastUsedAt: now,
        };
      }
      // ponytail: retain 512 submission receipts; use durable message receipts if long-term replay is needed.
      usage.submissions = [...usage.submissions, submissionId].slice(-512);
      await writeJsonFileAtomic(this.usagePath, usage);
      return undefined;
    });
    this.write = operation.catch(() => undefined);
    return operation;
  }
}
