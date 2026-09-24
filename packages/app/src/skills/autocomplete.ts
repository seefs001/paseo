import type { SkillCatalogEntry } from "@getpaseo/protocol/skills";
import type { FileMentionRange } from "@/utils/file-mention-autocomplete";

export function findActiveSkill(input: {
  text: string;
  cursorIndex: number;
}): FileMentionRange | null {
  const cursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const match = /(?:^|[\s(（，。：；！？])([$¥￥])([^\s$¥￥/\\()[\]{}'"`<>]*)$/u.exec(
    input.text.slice(0, cursor),
  );
  if (!match || /^\d/.test(match[2])) return null;
  const start = cursor - match[2].length - 1;
  return { start, end: cursor, query: match[2] };
}

export function rankSkills(
  skills: readonly SkillCatalogEntry[],
  query: string,
): SkillCatalogEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  return skills
    .filter((skill) => {
      const text = `${skill.name} ${skill.description}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount ||
        b.lastUsedAt - a.lastUsedAt ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    );
}

export function applySkillReplacement(input: {
  text: string;
  range: FileMentionRange;
  skill: Pick<SkillCatalogEntry, "name" | "path">;
}): string {
  const label = input.skill.name.replace(/[[\]\\\r\n]/g, " ");
  const target = encodeURI(input.skill.path).replace(
    /[()#?]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const before = input.text.slice(0, input.range.start);
  const after = input.text.slice(input.range.end);
  const space = after.startsWith(" ") ? "" : " ";
  return `${before}[$${label}](${target})${space}${after}`;
}
