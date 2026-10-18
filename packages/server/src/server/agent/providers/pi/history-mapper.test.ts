import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import {
  streamPiHistory,
  type PiCapturedUserMessageEntry,
  type PiHistoryMarker,
} from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

async function collectHistory(
  messages: PiAgentMessage[],
  userEntries: PiCapturedUserMessageEntry[] = [],
  markers: PiHistoryMarker[] = [],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamPiHistory("pi", messages, userEntries, {}, undefined, markers)) {
    events.push(event);
  }
  return events;
}

describe("Pi history mapper", () => {
  test("replays compaction and branch summaries and skips unknown roles", async () => {
    const events = await collectHistory([
      { role: "user", content: "before" },
      { role: "compactionSummary", summary: "compacted", tokensBefore: 1200 },
      { role: "branchSummary", summary: "tried another approach", fromId: null },
      { role: "assistant", content: [{ type: "text", text: "after" }] },
      { role: "hookMessage" } as PiAgentMessage,
    ]);

    expect(events.map((event) => event.item)).toEqual([
      { type: "user_message", text: "before" },
      { type: "compaction", status: "completed", preTokens: 1200 },
      { type: "notification", level: "info", message: "tried another approach" },
      {
        type: "assistant_message",
        text: "after",
        messageId: "pi-history-assistant-1",
      },
    ]);
  });

  test("inserts web search and fetch cards where the branch recorded them", async () => {
    const events = await collectHistory(
      [
        { role: "user", content: "look this up" },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ],
      [],
      [
        { kind: "message" },
        {
          kind: "web",
          id: "search-1",
          search: {
            queries: [
              { query: "paseo share", results: [{ title: "Docs", url: "https://paseo.sh" }] },
            ],
          },
        },
        { kind: "message" },
        {
          kind: "web",
          id: "fetch-1",
          fetch: { pages: [{ url: "https://paseo.sh/docs", title: "Paseo" }] },
        },
      ],
    );

    expect(events.map((event) => event.item)).toEqual([
      { type: "user_message", text: "look this up" },
      {
        type: "tool_call",
        callId: "search-1:search:0",
        name: "web_search",
        status: "completed",
        detail: {
          type: "search",
          query: "paseo share",
          toolName: "web_search",
          webResults: [{ title: "Docs", url: "https://paseo.sh" }],
        },
        error: null,
      },
      {
        type: "assistant_message",
        text: "done",
        messageId: "pi-history-assistant-1",
      },
      {
        type: "tool_call",
        callId: "fetch-1:fetch:0",
        name: "fetch_content",
        status: "completed",
        detail: { type: "fetch", url: "https://paseo.sh/docs", result: "Paseo" },
        error: null,
      },
    ]);
  });

  test("keeps replaying messages when branch markers do not line up", async () => {
    const events = await collectHistory(
      [{ role: "user", content: "still here" }],
      [],
      [{ kind: "message" }, { kind: "message" }],
    );
    expect(events.map((event) => event.item)).toEqual([
      { type: "user_message", text: "still here" },
    ]);
  });

  test("renders visible custom messages as completed tools and hides private context", async () => {
    const events = await collectHistory([
      {
        role: "custom",
        customType: "project-context",
        content: "Project instructions",
        display: true,
      },
      {
        role: "custom",
        customType: "private-context",
        content: "Hidden instructions",
        display: false,
      },
      { role: "custom", customType: "project-context", content: "Project instructions" },
    ]);
    expect(events.map((event) => event.item)).toEqual(
      [1, 2].map((index) => ({
        type: "tool_call",
        callId: `pi-custom-${index}`,
        name: "project-context",
        status: "completed",
        detail: { type: "plain_text", text: "Project instructions" },
        metadata: { synthetic: true, customType: "project-context" },
        error: null,
      })),
    );
  });

  test("replays user, assistant, reasoning, and completed tool calls", async () => {
    await expect(
      collectHistory([
        {
          role: "user",
          content: [
            { type: "text", text: "read this" },
            { type: "image", data: "base64", mimeType: "image/png" },
            { type: "text", text: "then answer" },
          ],
        },
        {
          role: "assistant",
          responseId: "response-1",
          content: [
            { type: "thinking", thinking: "checking file" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "note.txt" } },
            { type: "text", text: "done" },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "read this\n\nthen answer",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "reasoning", text: "checking file" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "running",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "done", messageId: "response-1" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: "file contents",
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
    ]);
  });

  test("replays bash execution records as completed shell calls", async () => {
    await expect(
      collectHistory([
        {
          role: "bashExecution",
          command: "echo hi",
          output: "hi\n",
          exitCode: 0,
          timestamp: 123,
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-bash-123",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
          error: null,
        },
      },
    ]);
  });

  test("replays custom messages as completed tools, matching the live path", async () => {
    await expect(
      collectHistory([{ role: "custom", content: "Extension command output" }]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-custom-1",
          name: "custom-message",
          status: "completed",
          detail: { type: "plain_text", text: "Extension command output" },
          metadata: { synthetic: true, customType: "custom-message" },
          error: null,
        },
      },
    ]);
  });

  test("uses Pi tree entry ids for replayed user messages", async () => {
    await expect(
      collectHistory(
        [
          { role: "user", content: "first prompt" },
          { role: "assistant", content: [{ type: "text", text: "first answer" }] },
          { role: "user", content: "second prompt" },
        ],
        [
          { id: "entry-user-1", text: "first prompt" },
          { id: "entry-user-2", text: "second prompt" },
        ],
      ),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "first prompt",
          messageId: "entry-user-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "pi-history-assistant-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "second prompt",
          messageId: "entry-user-2",
        },
      },
    ]);
  });
});
