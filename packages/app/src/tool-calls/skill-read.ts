import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { isMap, parseDocument } from "yaml";

const FRONTMATTER_LIMIT = 16_384;
const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// Immutable details are shared by codemode projection, grouping, and the badge.
const skillNames = new WeakMap<ToolCallDetail, string | undefined>();

function declaredSkillName(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const frontmatter = FRONTMATTER_PATTERN.exec(content.slice(0, FRONTMATTER_LIMIT));
  if (!frontmatter) return undefined;
  const document = parseDocument(frontmatter[1], { schema: "failsafe", uniqueKeys: true });
  if (document.errors.length > 0 || !isMap(document.contents)) return undefined;
  const value = document.get("name");
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (!name || name.length > 200 || /[\r\n]/.test(name)) return undefined;
  return name;
}

export function getSkillReadName(detail: ToolCallDetail | undefined): string | undefined {
  if (detail?.type !== "read") return undefined;
  if (!/(?:^|[\\/])SKILL\.md$/.test(detail.filePath)) return undefined;
  if (skillNames.has(detail)) return skillNames.get(detail);

  const directory = /(?:^|[\\/])([^\\/]+)[\\/]SKILL\.md$/.exec(detail.filePath)?.[1];
  const isRelativeDirectory = directory === "." || directory === "..";
  const directoryName = isRelativeDirectory ? undefined : directory;
  const readsFromStart = detail.offset === undefined || detail.offset === 1;
  const content = readsFromStart ? detail.content : undefined;
  // Pi's persisted codemode children contain args, but no individual read output.
  const name = declaredSkillName(content) ?? directoryName;
  skillNames.set(detail, name);
  return name;
}
