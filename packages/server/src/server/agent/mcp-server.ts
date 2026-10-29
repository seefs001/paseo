import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { formatCallArguments } from "./mcp-call-log.js";
import { addModelVisibleStructuredContent } from "./tools/paseo-tool-serialization.js";
import { createPaseoToolCatalog, type PaseoToolHostDependencies } from "./tools/paseo-tools.js";
import type { PaseoToolResult } from "./tools/types.js";

export interface McpToolCallRecord {
  tool: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
  arguments: string | null;
}

export type AgentMcpServerOptions = PaseoToolHostDependencies & {
  recordToolCall?: (event: McpToolCallRecord) => void;
};

type McpToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

function toMcpToolResult(result: PaseoToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const { recordToolCall, ...catalogOptions } = options;
  const catalog = await createPaseoToolCatalog(catalogOptions);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown, context?: McpToolContext) => {
        const started = Date.now();
        try {
          const result = await catalog.executeTool(tool.name, args, { signal: context?.signal });
          safeRecordToolCall(recordToolCall, {
            tool: tool.name,
            ok: result.isError !== true,
            error: result.isError === true ? "Tool returned an error" : null,
            durationMs: Date.now() - started,
            arguments: formatCallArguments(args),
          });
          return toMcpToolResult(result);
        } catch (error) {
          safeRecordToolCall(recordToolCall, {
            tool: tool.name,
            ok: false,
            error: error instanceof Error ? error.message : "Tool call failed",
            durationMs: Date.now() - started,
            arguments: formatCallArguments(args),
          });
          throw error;
        }
      },
    );
  }

  return server;
}

function safeRecordToolCall(
  recordToolCall: AgentMcpServerOptions["recordToolCall"],
  event: McpToolCallRecord,
): void {
  try {
    recordToolCall?.(event);
  } catch {
    // A log failure must not fail the tool call.
  }
}
