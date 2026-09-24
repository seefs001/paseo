import { z } from "zod";

export const SkillCatalogEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  description: z.string(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.number().nonnegative(),
});
export type SkillCatalogEntry = z.infer<typeof SkillCatalogEntrySchema>;

export const SkillsListRequestSchema = z.object({
  type: z.literal("skills.list.request"),
  requestId: z.string(),
});

export const SkillsListResponseSchema = z.object({
  type: z.literal("skills.list.response"),
  payload: z.object({
    requestId: z.string(),
    directory: z.string(),
    skills: z.array(SkillCatalogEntrySchema),
    skipped: z.number().int().nonnegative(),
  }),
});
export type SkillsList = z.infer<typeof SkillsListResponseSchema>["payload"];

export const SkillsRecordUsageRequestSchema = z.object({
  type: z.literal("skills.usage.record.request"),
  requestId: z.string(),
  submissionId: z.string().min(1).max(128),
  paths: z.array(z.string().min(1).max(4096)).max(100),
});

export const SkillsRecordUsageResponseSchema = z.object({
  type: z.literal("skills.usage.record.response"),
  payload: z.object({ requestId: z.string() }),
});

export function submittedSkillPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/\[\$[^\]\r\n]+\]\(([^\s)]+)\)/g)) {
    try {
      const path = decodeURIComponent(match[1]);
      if (path.endsWith("/SKILL.md") || path.endsWith("\\SKILL.md")) paths.add(path);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  return [...paths];
}
