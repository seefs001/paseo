import { z } from "zod";
import { buildPiToolCallMetadata } from "@getpaseo/protocol/pi-tool-presentation";
import { mapCustomMessageToToolCall } from "../custom-message.js";
import type { AgentStreamEvent, AgentTimelineItem, ToolCallDetail } from "../../agent-sdk-types.js";
import {
  materializeProviderImage,
  renderProviderImageOutputAsAssistantMarkdown,
} from "../provider-image-output.js";
import {
  createPiExtensionHost,
  type PiExtensionEventOutput,
  type PiExtensionHost,
} from "./extensions/index.js";
import type { PiAgentMessage, PiImageContent, PiTextContent } from "./rpc-types.js";
import {
  extractTextFromToolResult,
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  splitPiToolResultImages,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

export interface PiCapturedUserMessageEntry {
  id: string;
  text: string;
}

const PiHistoryMarkerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message") }),
  z.object({
    kind: z.literal("web"),
    id: z.string().min(1),
    search: z
      .object({
        queries: z.array(
          z.object({
            query: z.string(),
            results: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
          }),
        ),
      })
      .optional(),
    fetch: z
      .object({
        pages: z.array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
            error: z.string().optional(),
          }),
        ),
      })
      .optional(),
  }),
]);

export type PiHistoryMarker = z.infer<typeof PiHistoryMarkerSchema>;
type PiWebHistoryMarker = Extract<PiHistoryMarker, { kind: "web" }>;

export function parsePiHistoryMarkers(value: unknown): PiHistoryMarker[] {
  if (!Array.isArray(value)) return [];
  const markers: PiHistoryMarker[] = [];
  for (const entry of value) {
    const parsed = PiHistoryMarkerSchema.safeParse(entry);
    if (parsed.success) markers.push(parsed.data);
  }
  return markers;
}

function historyMarkersMatch(
  messages: readonly PiAgentMessage[],
  markers: readonly PiHistoryMarker[],
): boolean {
  if (markers.length === 0) return false;
  let messageMarkers = 0;
  for (const marker of markers) {
    if (marker.kind === "message") messageMarkers += 1;
  }
  return messageMarkers === messages.length;
}

export interface PiHistoryMapperHooks {
  mapCustomMessage?: (
    text: string,
    provider: string,
  ) => Extract<AgentStreamEvent, { type: "timeline" }> | null;
  resolveToolCallId?: (toolCallId: string, toolCall: PiTrackedToolCall) => string;
  mapToolDetail?: (
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    context: { toolCallId: string },
  ) => ToolCallDetail | null;
}

function isTextContentBlock(block: unknown): block is PiTextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "text" &&
    typeof Reflect.get(block, "text") === "string"
  );
}

export function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n\n");
}

export class PiHistoryMapper {
  private readonly pendingToolCalls = new Map<string, PiTrackedToolCall>();
  private readonly hydrations: Promise<AgentStreamEvent[]>[] = [];
  private userIndex = 0;
  private assistantIndex = 0;
  private customIndex = 0;

  constructor(
    private readonly provider: string,
    private readonly userEntries: readonly PiCapturedUserMessageEntry[] = [],
    private readonly hooks: PiHistoryMapperHooks = {},
    private readonly extensionHost: PiExtensionHost = createPiExtensionHost(),
  ) {}

  async mapMessages(
    messages: readonly PiAgentMessage[],
    markers: readonly PiHistoryMarker[] = [],
  ): Promise<AgentStreamEvent[]> {
    const events: AgentStreamEvent[] = [];
    if (!historyMarkersMatch(messages, markers)) {
      for (const message of messages) {
        events.push(...(await this.mapMessage(message)));
      }
      return events;
    }
    let messageIndex = 0;
    for (const marker of markers) {
      if (marker.kind === "message") {
        const message = messages[messageIndex];
        messageIndex += 1;
        if (message) events.push(...(await this.mapMessage(message)));
        continue;
      }
      events.push(...webHistoryEvents(this.provider, marker));
    }
    return events;
  }

  private async mapMessage(message: PiAgentMessage): Promise<AgentStreamEvent[]> {
    switch (message.role) {
      case "user":
        return this.mapUserMessage(message);
      case "custom":
        return this.mapCustomMessage(message);
      case "assistant":
        return this.mapAssistantMessage(message);
      case "toolResult":
        return this.mapToolResultMessage(message);
      case "bashExecution":
        return [this.mapBashExecutionMessage(message)];
      case "compactionSummary":
        return [this.mapCompactionSummary(message)];
      case "branchSummary":
        return this.mapBranchSummary(message);
      default:
        return [];
    }
  }

  async hydrate(): Promise<AgentStreamEvent[]> {
    return (await Promise.all(this.hydrations)).flat();
  }

  private mapUserMessage(message: Extract<PiAgentMessage, { role: "user" }>): AgentStreamEvent[] {
    const text = getUserMessageText(message.content);
    this.userIndex += 1;
    if (!text) {
      return [];
    }
    const userEntry = this.userEntries[this.userIndex - 1];
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: {
          type: "user_message",
          text,
          ...(userEntry ? { messageId: userEntry.id } : {}),
        },
      },
    ];
  }

  private mapCustomMessage(
    message: Extract<PiAgentMessage, { role: "custom" }>,
  ): AgentStreamEvent[] {
    const extensionMapping = this.extensionHost.mapCustomMessage(message);
    const extensionEvents = this.extensionEvents(extensionMapping);
    if (message.display === false) return extensionEvents;
    const text = getUserMessageText(message.content);
    const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
    if (mappedEvent) {
      return [...extensionEvents, mappedEvent];
    }
    return [
      ...extensionEvents,
      ...(text
        ? [
            {
              type: "timeline",
              provider: this.provider,
              item: mapCustomMessageToToolCall(
                message,
                text,
                `${this.provider}-custom-${++this.customIndex}`,
              ),
            } as AgentStreamEvent,
          ]
        : []),
    ];
  }

  private mapAssistantMessage(
    message: Extract<PiAgentMessage, { role: "assistant" }>,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    this.assistantIndex += 1;
    const messageId =
      message.responseId || `${this.provider}-history-assistant-${this.assistantIndex}`;
    for (const content of message.content) {
      if (content.type === "text" && content.text) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "assistant_message", text: content.text, messageId },
        });
        continue;
      }
      if (content.type === "thinking" && content.thinking) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "reasoning", text: content.thinking },
        });
        continue;
      }
      if (content.type === "toolCall") {
        const tracked = parseToolArgs(content.name, content.arguments);
        this.pendingToolCalls.set(content.id, tracked);
        const mapping = this.extensionHost.mapToolCall({
          callId: content.id,
          toolName: tracked.toolName,
          args: tracked.args,
          status: "running",
          result: null,
        });
        const detail = this.mapToolDetail(content.id, tracked, null, mapping?.detail);
        if (!detail) {
          continue;
        }
        events.push({
          type: "timeline",
          provider: this.provider,
          item: {
            type: "tool_call",
            callId: this.resolveToolCallId(content.id, tracked),
            name: mapping?.name ?? tracked.toolName,
            status: "running",
            detail,
            error: null,
            metadata: buildPiToolCallMetadata(tracked.toolName, tracked.args),
          },
        });
        events.push(...this.extensionEvents(mapping));
      }
    }
    return events;
  }

  private async mapToolResultMessage(
    message: Extract<PiAgentMessage, { role: "toolResult" }>,
  ): Promise<AgentStreamEvent[]> {
    const tracked =
      this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
    this.pendingToolCalls.delete(message.toolCallId);
    const result = parseToolResult({ content: message.content, details: message.details });
    // Pull image blocks out of the result so base64 never reaches the tool output, then render
    // each one as an assistant_message markdown image after the tool_call (mirroring the live
    // path and the Claude provider, upstream #1717).
    const { images, result: splitResult } = splitPiToolResultImages(result);
    const mapping = this.extensionHost.mapToolCall({
      callId: message.toolCallId,
      toolName: tracked.toolName,
      args: tracked.args,
      status: message.isError ? "failed" : "completed",
      result: splitResult,
    });
    const detail = this.mapToolDetail(message.toolCallId, tracked, splitResult, mapping?.detail);
    if (!detail) {
      return [];
    }
    const imageEvents: AgentStreamEvent[] = [];
    for (const image of images) {
      const item = await renderProviderImageOutputAsAssistantMarkdown(image, {
        materialize: materializeProviderImage,
      });
      if (item) imageEvents.push({ type: "timeline", provider: this.provider, item });
    }
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: toToolResultTimelineItem({
          callId: this.resolveToolCallId(message.toolCallId, tracked),
          name: mapping?.name ?? tracked.toolName,
          isError: Boolean(message.isError),
          detail,
          errorText: extractTextFromToolResult(splitResult) ?? "Tool call failed",
          metadata: buildPiToolCallMetadata(tracked.toolName, tracked.args),
        }),
      },
      ...imageEvents,
      ...this.extensionEvents(mapping),
    ];
  }

  private extensionEvents(mapping: PiExtensionEventOutput | undefined): AgentStreamEvent[] {
    if (!mapping) return [];
    this.hydrations.push(mapping.hydration);
    return mapping.events;
  }

  private mapCompactionSummary(
    message: Extract<PiAgentMessage, { role: "compactionSummary" }>,
  ): AgentStreamEvent {
    return {
      type: "timeline",
      provider: this.provider,
      item: {
        type: "compaction",
        status: "completed",
        ...(typeof message.tokensBefore === "number" ? { preTokens: message.tokensBefore } : {}),
      },
    };
  }

  private mapBranchSummary(
    message: Extract<PiAgentMessage, { role: "branchSummary" }>,
  ): AgentStreamEvent[] {
    const summary = message.summary?.trim();
    if (!summary) return [];
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: {
          type: "notification",
          level: "info",
          message: summary,
        },
      },
    ];
  }

  private mapBashExecutionMessage(
    message: Extract<PiAgentMessage, { role: "bashExecution" }>,
  ): AgentStreamEvent {
    const detail: ToolCallDetail = {
      type: "shell",
      command: message.command,
      output: message.output,
      exitCode: message.exitCode ?? null,
    };
    return {
      type: "timeline",
      provider: this.provider,
      item: {
        type: "tool_call",
        callId: `pi-bash-${message.timestamp}`,
        name: "bash",
        status: message.cancelled ? "canceled" : "completed",
        detail,
        error: null,
      },
    };
  }

  private resolveToolCallId(toolCallId: string, toolCall: PiTrackedToolCall): string {
    return this.hooks.resolveToolCallId?.(toolCallId, toolCall) ?? toolCallId;
  }

  private mapToolDetail(
    toolCallId: string,
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    extensionDetail?: ToolCallDetail,
  ): ToolCallDetail | null {
    const hook = this.hooks.mapToolDetail;
    return hook
      ? hook(toolCall, result, { toolCallId })
      : (extensionDetail ?? mapToolDetail(toolCall, result));
  }
}

export async function* streamPiHistory(
  provider: string,
  messages: PiAgentMessage[],
  userEntries: readonly PiCapturedUserMessageEntry[] = [],
  hooks: PiHistoryMapperHooks = {},
  // At most eight 2 MiB child files per replay; remaining cards keep their summaries.
  extensionHost: PiExtensionHost = createPiExtensionHost(undefined, undefined, 16 * 1024 * 1024),
  markers: readonly PiHistoryMarker[] = [],
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const mapper = new PiHistoryMapper(provider, userEntries, hooks, extensionHost);
  const replayMarkers = historyMarkersMatch(messages, markers)
    ? markers
    : messages.map(() => ({ kind: "message" as const }));
  let messageIndex = 0;
  for (const marker of replayMarkers) {
    if (signal?.aborted) return;
    if (marker.kind === "web") {
      for (const event of webHistoryEvents(provider, marker)) {
        if (signal?.aborted) return;
        yield event;
      }
      continue;
    }
    const message = messages[messageIndex];
    messageIndex += 1;
    if (!message) continue;
    for (const event of await mapper.mapMessages([message])) {
      if (signal?.aborted) return;
      yield event;
    }
  }
  for (const event of await mapper.hydrate()) {
    if (signal?.aborted) return;
    yield event;
  }
}

function webHistoryEvents(provider: string, marker: PiWebHistoryMarker): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  const queries = marker.search ? marker.search.queries : [];
  for (const [index, query] of queries.entries()) {
    const detail: ToolCallDetail = {
      type: "search",
      query: query.query,
      toolName: "web_search",
      ...(query.results ? { webResults: query.results } : {}),
    };
    events.push(webToolEvent(provider, `${marker.id}:search:${index}`, "web_search", detail));
  }
  const pages = marker.fetch ? marker.fetch.pages : [];
  for (const [index, page] of pages.entries()) {
    const result = page.title ?? page.error;
    const detail: ToolCallDetail = {
      type: "fetch",
      url: page.url,
      ...(result ? { result } : {}),
    };
    events.push(webToolEvent(provider, `${marker.id}:fetch:${index}`, "fetch_content", detail));
  }
  return events;
}

function webToolEvent(
  provider: string,
  callId: string,
  name: string,
  detail: ToolCallDetail,
): AgentStreamEvent {
  return {
    type: "timeline",
    provider,
    item: {
      type: "tool_call",
      callId,
      name,
      status: "completed",
      detail,
      error: null,
    },
  };
}

function toToolResultTimelineItem(input: {
  callId: string;
  name: string;
  isError: boolean;
  detail: ToolCallDetail;
  errorText: string;
  metadata: Record<string, unknown>;
}): AgentTimelineItem {
  if (input.isError) {
    return {
      type: "tool_call",
      callId: input.callId,
      name: input.name,
      status: "failed",
      detail: input.detail,
      error: input.errorText,
      metadata: input.metadata,
    };
  }
  return {
    type: "tool_call",
    callId: input.callId,
    name: input.name,
    status: "completed",
    detail: input.detail,
    error: null,
    metadata: input.metadata,
  };
}
