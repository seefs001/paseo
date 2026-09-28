import type { ToolCallDetail, ToolCallTimelineItem } from "./agent-types.js";
import { getPaseoToolLeafName, isPaseoToolName } from "./tool-name-normalization.js";
import { stripCwdPrefix } from "./path-utils.js";

export type ToolCallDisplayInput = Pick<
  ToolCallTimelineItem,
  "name" | "status" | "error" | "metadata" | "detail"
> & {
  cwd?: string;
};

export interface ToolCallDisplayModel {
  displayName: string;
  summary?: string;
  errorText?: string;
}

interface DetailDisplay {
  displayName?: string;
  summary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function humanizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return name;
  }
  const readable = trimmed.replaceAll("__", " ");
  if (isPaseoToolName(trimmed)) {
    const leaf = getPaseoToolLeafName(trimmed);
    if (leaf) {
      return humanizeToolName(leaf);
    }
  }
  if (/[:./]/.test(readable)) {
    return readable;
  }

  return readable
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function formatErrorText(error: unknown): string | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error.content === "string") {
    return error.content;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function buildFilePathDisplay(
  displayName: string,
  filePath: string,
  cwd: string | undefined,
): DetailDisplay {
  return {
    displayName,
    summary: stripCwdPrefix(filePath, cwd),
  };
}

function buildCanonicalDetailDisplay(input: ToolCallDisplayInput): DetailDisplay {
  switch (input.detail.type) {
    case "shell":
      return {
        displayName: "Shell",
        summary: metadataString(input.metadata, "description") ?? input.detail.command,
      };
    case "read":
      return buildFilePathDisplay("Read", input.detail.filePath, input.cwd);
    case "edit":
      return buildFilePathDisplay("Edit", input.detail.filePath, input.cwd);
    case "write":
      return buildFilePathDisplay("Write", input.detail.filePath, input.cwd);
    case "search":
      return {
        displayName: "Search",
        summary: searchSummary(input.detail),
      };
    case "fetch":
      return {
        displayName: "Fetch",
        summary: input.detail.url,
      };
    case "worktree_setup":
      return {
        displayName: "Worktree setup",
        summary: input.detail.branchName,
      };
    case "sub_agent":
      return {
        displayName: readString(input.detail.subAgentType) ?? "Task",
        summary: readString(input.detail.description),
      };
    case "plain_text":
      return {
        summary: input.detail.label,
      };
    case "plan":
      return {
        displayName: "Plan",
      };
    case "unknown":
      return {};
    default:
      throw new Error("unreachable");
  }
}

function pathLabel(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? filePath;
}

function searchMatchCount(detail: Extract<ToolCallDetail, { type: "search" }>): number | undefined {
  if (detail.numMatches !== undefined) {
    return detail.numMatches;
  }
  const stub = detail.content?.match(/^found (\d+) matches?$/i);
  return stub ? Number(stub[1]) : undefined;
}

function searchSummary(detail: Extract<ToolCallDetail, { type: "search" }>): string | undefined {
  const query = detail.query.trim();
  const shortQuery =
    query.length > 0 && query.length <= 48 && !query.includes("\n") ? query : undefined;
  const count = searchMatchCount(detail);
  const fileCount = detail.filePaths?.length ?? 0;
  let place: string | undefined;
  if (fileCount === 1) {
    place = pathLabel(detail.filePaths?.[0] ?? "");
  } else if (fileCount > 1) {
    place = `${fileCount} files`;
  }
  if (shortQuery && place) {
    return `${shortQuery} · ${place}`;
  }
  if (shortQuery) {
    return shortQuery;
  }
  if (count !== undefined && place) {
    return `${count} matches · ${place}`;
  }
  if (count !== undefined) {
    return `${count} matches`;
  }
  if (place) {
    return place;
  }
  return query.length > 0 ? query : undefined;
}

export function searchToolsQuery(name: string): string | undefined {
  const match = /^Search tools:\s*"([\s\S]*)"\s*$/.exec(name.trim());
  return match?.[1] && match[1].length > 0 ? match[1] : undefined;
}

function buildUnknownDetailOverride(input: ToolCallDisplayInput): DetailDisplay {
  const quotedSearch = searchToolsQuery(input.name);
  if (quotedSearch) {
    return { displayName: "Search", summary: quotedSearch };
  }
  const lowerName = input.name.trim().toLowerCase();
  if (input.detail.type === "unknown" && lowerName === "task") {
    return {
      displayName: "Task",
      summary: isRecord(input.metadata) ? readString(input.metadata.subAgentActivity) : undefined,
    };
  }
  if (input.detail.type === "unknown" && lowerName === "thinking") {
    return {
      displayName: "Thinking",
    };
  }
  if (lowerName === "terminal") {
    return {
      displayName: "Terminal",
      summary: input.detail.type === "plain_text" ? readString(input.detail.label) : undefined,
    };
  }
  const summary =
    input.detail.type === "unknown" ? metadataString(input.metadata, "summary") : undefined;
  return summary ? { summary } : {};
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return isRecord(metadata) ? readString(metadata[key]) : undefined;
}

export function buildToolCallDisplayModel(input: ToolCallDisplayInput): ToolCallDisplayModel {
  const canonicalDisplay = buildCanonicalDetailDisplay(input);
  const unknownDetailOverride = buildUnknownDetailOverride(input);
  const displayName =
    unknownDetailOverride.displayName ??
    canonicalDisplay.displayName ??
    humanizeToolName(input.name);
  const summary = unknownDetailOverride.summary ?? canonicalDisplay.summary;
  const errorText = input.status === "failed" ? formatErrorText(input.error) : undefined;

  return {
    displayName,
    ...(summary ? { summary } : {}),
    ...(errorText ? { errorText } : {}),
  };
}
