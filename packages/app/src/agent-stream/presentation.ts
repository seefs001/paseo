import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import { createCodemodeProjection } from "@/tool-calls/codemode";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, UserMessageItem } from "@/types/stream";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  level: ToolCallDetailLevel;
  isTurnActive: boolean;
}

/** Find and scrolling address a plugin row by the source it replaces. */
export function getStreamItemMessageId(item: StreamItem): string {
  if (item.kind === "plugin") return item.sourceId ?? item.id;
  return item.id;
}

const SHORT_REASONING_CHARS = 120;

function isShortReasoningBeforeTool(item: StreamItem, after: StreamItem | undefined): boolean {
  return (
    item.kind === "thought" &&
    item.status === "ready" &&
    item.text.trim().length < SHORT_REASONING_CHARS &&
    after?.kind === "tool_call"
  );
}

/** Short reasoning is the model's scratch note for the next tool, not its own row. */
function hideShortReasoningBeforeTools(items: StreamItem[]): StreamItem[] {
  let changed = false;
  const next: StreamItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (isShortReasoningBeforeTool(item, items[index + 1])) {
      changed = true;
      continue;
    }
    next.push(item);
  }
  return changed ? next : items;
}

function dropBoundaryShortReasoning(
  items: StreamItem[],
  following: StreamItem | undefined,
): StreamItem[] {
  const last = items.at(-1);
  if (!last || !isShortReasoningBeforeTool(last, following)) return items;
  return items.slice(0, -1);
}

/** Source messages reach plugins before display projection. */
export function createStreamPresentation() {
  const projectCodemode = createCodemodeProjection();
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let reasoningTailSource: StreamItem[] | undefined;
  let reasoningTail: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;

  function presentRows(item: StreamItem): StreamItem[] {
    return [item.kind === "user_message" ? presentUserMessage(item) : item];
  }

  return (input: PresentationInput) => {
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        (item) => presentRows(item),
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = presentRows(item);
      head.push(...blocks);
    }
    if (reasoningTailSource !== historyRows) {
      reasoningTail = hideShortReasoningBeforeTools(historyRows);
      reasoningTailSource = historyRows;
    }
    const visibleHead = hideShortReasoningBeforeTools(head);
    const nested = projectCodemode(
      dropBoundaryShortReasoning(reasoningTail, visibleHead[0]),
      visibleHead,
    );
    if (preparedTail !== nested.tail || preparedLevel !== input.level) {
      preparedHistory = prepareToolCallHistory(input.level, nested.tail);
      preparedTail = nested.tail;
      preparedLevel = input.level;
    }
    return projectToolCallDetailLevel({
      level: input.level,
      tail: nested.tail,
      head: nested.head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
  };
}
