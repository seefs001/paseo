import { submittedSkillPaths } from "@getpaseo/protocol/skills";
import { describe, expect, it } from "vitest";
import { applySkillReplacement, findActiveSkill, rankSkills } from "./autocomplete";

describe("shared skill autocomplete", () => {
  it("accepts dollar and both yen signs at the cursor without treating prices, escaped dollars or links as skills", () => {
    for (const trigger of ["$", "¥", "￥"]) {
      const text = `请使用 ${trigger}review 后面的文字`;
      expect(findActiveSkill({ text, cursorIndex: 11 })).toEqual({
        start: 4,
        end: 11,
        query: "review",
      });
      expect(findActiveSkill({ text: trigger, cursorIndex: 1 })?.query).toBe("");
    }
    for (const text of [
      "cost $100",
      "¥30",
      "foo$bar",
      "\\$skill",
      "[$review](/a/SKILL.md)",
      "$(pwd)",
      "${HOME}",
    ]) {
      expect(findActiveSkill({ text, cursorIndex: text.length })).toBeNull();
    }
  });

  it("preserves surrounding text and round-trips paths with spaces, parentheses, unicode and percent signs", () => {
    const skill = { name: "review", path: "/Users/测试/my skills (100%) #1?/SKILL.md" };
    const text = applySkillReplacement({
      text: "before ¥rev after",
      range: { start: 7, end: 11, query: "rev" },
      skill,
    });
    expect(text).toContain("before [$review](");
    expect(text).toMatch(/\) after$/);
    expect(submittedSkillPaths(`${text} ${text}`)).toEqual([skill.path]);
    expect(submittedSkillPaths("[$broken](%GG/SKILL.md) $review")).toEqual([]);
  });

  it("filters names and descriptions while keeping descending frequency and deterministic ties", () => {
    const base = {
      path: "/skills/SKILL.md",
      description: "Review changes",
      lastUsedAt: 0,
      usageCount: 0,
    };
    const skills = [
      { ...base, name: "zebra", usageCount: 10 },
      { ...base, name: "alpha", usageCount: 3, lastUsedAt: 10 },
      { ...base, name: "beta", usageCount: 3, lastUsedAt: 20 },
      { ...base, name: "other", description: "Draw images" },
    ];
    expect(rankSkills(skills, "REVIEW").map((s) => s.name)).toEqual(["zebra", "beta", "alpha"]);
    expect(rankSkills(skills, "other").map((s) => s.name)).toEqual(["other"]);
    expect(skills[0].name).toBe("zebra");
  });
});
