import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { SkillCatalog } from "./catalog.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-skill-catalog-"));
  roots.push(root);
  const directory = path.join(root, ".agents", "skills");
  const home = path.join(root, ".paseo");
  await mkdir(directory, { recursive: true });
  return { root, directory, home, catalog: new SkillCatalog(home, directory) };
}

async function writeSkill(directory: string, name: string, text: string) {
  const folder = path.join(directory, name);
  await mkdir(folder, { recursive: true });
  const skillPath = path.join(folder, "SKILL.md");
  await writeFile(skillPath, text);
  return skillPath;
}

it("reads real YAML descriptions and symlinked skills, deduplicates aliases and isolates broken entries", async () => {
  const { root, directory, catalog } = await fixture();
  const external = await writeSkill(
    root,
    "shared",
    "---\nname: review\ndescription: >-\n  Review changes\n  and verify behavior.\n---\n# Instructions",
  );
  await symlink(path.dirname(external), path.join(directory, "review"), "junction");
  await symlink(path.dirname(external), path.join(directory, "review-alias"), "junction");
  await symlink(path.join(root, "missing"), path.join(directory, "broken"), "junction");
  await writeSkill(directory, "bad", "---\nname: [broken\n---\n");
  const basic = await writeSkill(
    directory,
    "basic",
    '\uFEFF---\r\nname: basic\r\ndescription: "A: quoted description"\r\n---\r\n',
  );
  const result = await catalog.list();
  expect(result.skipped).toBe(2);
  expect(result.skills.map((s) => [s.name, s.description])).toEqual([
    ["basic", "A: quoted description"],
    ["review", "Review changes and verify behavior."],
  ]);
  expect(result.skills[0].path).toBe(basic);
  expect(result.skills[1].path).toBe(path.join(directory, "review", "SKILL.md"));
});

it("serializes concurrent usage, deduplicates submissions and repeated references, ignores foreign paths, and persists across restarts", async () => {
  const { directory, home, catalog } = await fixture();
  const alpha = await writeSkill(directory, "alpha", "---\nname: alpha\ndescription: First\n---\n");
  const beta = await writeSkill(directory, "beta", "---\nname: beta\ndescription: Second\n---\n");
  await Promise.all([
    catalog.recordUsage("one", [beta, beta, "/private/foreign/SKILL.md"]),
    catalog.recordUsage("one", [beta]),
    catalog.recordUsage("two", [beta, alpha]),
  ]);
  const latestWrite = catalog.recordUsage("three", [beta]);
  expect((await catalog.list()).skills[0].usageCount).toBe(3);
  await latestWrite;
  const restarted = new SkillCatalog(home, directory);
  const result = await restarted.list();
  expect(result.skills.map((s) => [s.name, s.usageCount])).toEqual([
    ["beta", 3],
    ["alpha", 1],
  ]);
  await restarted.recordUsage("one", [beta]);
  expect((await restarted.list()).skills[0].usageCount).toBe(3);
  const stored = JSON.parse(await readFile(path.join(home, "skill-usage.json"), "utf8"));
  expect(Object.keys(stored.skills).sort()).toEqual([alpha, beta].sort());
});

it("returns an explicit empty catalog for a missing directory and sees newly installed skills on the next list", async () => {
  const { directory, home } = await fixture();
  const absent = path.join(directory, "absent");
  const catalog = new SkillCatalog(home, absent);
  expect(await catalog.list()).toEqual({ directory: absent, skills: [], skipped: 0 });
  await writeSkill(absent, "new", "---\nname: new\n---\n");
  expect((await catalog.list()).skills[0].name).toBe("new");
});
