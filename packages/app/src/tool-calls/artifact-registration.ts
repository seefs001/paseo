import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { getToolLeafName, isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";

export type ArtifactRegistration =
  | { state: "pending"; title?: string }
  | { state: "failed"; title?: string }
  | { state: "registered"; title: string; artifactId: string }
  /** Completed, but this record carries no result (Pi persists codemode children as args only). */
  | { state: "unavailable"; title?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isRegisterArtifactCall(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  const isPaseo = isPaseoToolName(normalized) || normalized.startsWith("paseo_");
  return (
    isPaseo && normalized.endsWith("register_artifact") && getToolLeafName(normalized) !== null
  );
}

function unwrapResult(output: unknown): unknown {
  if (!isRecord(output)) return output;
  if (output.structuredContent !== undefined) return output.structuredContent;
  if (Array.isArray(output.content) && output.content.length === 1) {
    const item = output.content[0];
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      try {
        return JSON.parse(item.text) as unknown;
      } catch {
        return undefined;
      }
    }
  }
  return output;
}

/** Reads the daemon's registered entry from the call result; never matches by title or path. */
export function getArtifactRegistration(input: {
  toolName: string;
  status: string;
  detail: ToolCallDetail | undefined;
}): ArtifactRegistration | null {
  if (!isRegisterArtifactCall(input.toolName)) return null;
  const detail = input.detail;
  const args = detail?.type === "unknown" && isRecord(detail.input) ? detail.input : {};
  const requestedTitle = readString(args.title);
  if (input.status === "running" || input.status === "executing") {
    return { state: "pending", title: requestedTitle };
  }
  if (input.status !== "completed") return { state: "failed", title: requestedTitle };
  const result = detail?.type === "unknown" ? unwrapResult(detail.output) : undefined;
  const artifact = isRecord(result) && isRecord(result.artifact) ? result.artifact : null;
  const artifactId = readString(artifact?.id);
  if (!artifactId) return { state: "unavailable", title: requestedTitle };
  return {
    state: "registered",
    artifactId,
    title: readString(artifact?.title) ?? requestedTitle ?? artifactId,
  };
}
