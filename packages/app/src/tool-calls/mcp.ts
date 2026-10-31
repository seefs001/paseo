import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";

interface CodemodeMcpCall {
  serverName: string;
  toolName: string;
}

/** Pi names MCP tools explicitly; script source is not evidence that a tool ran. */
export function getCodemodeMcpCall(
  input: Pick<ToolCallTimelineItem, "name" | "metadata">,
): CodemodeMcpCall | null {
  if (typeof input.metadata?.parentToolCallId !== "string") return null;
  const match = /^mcp__(.+?)__(.+)$/.exec(input.name);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}
