import { z } from "zod";
import type { AgentUsage } from "../agent-sdk-types.js";

const GrokTurnUsageSchema = z.object({
  sessionId: z.string(),
  update: z.object({
    sessionUpdate: z.literal("turn_completed"),
    prompt_id: z.string(),
    usage: z
      .object({
        outputTokens: z.number().int().nonnegative().optional(),
        apiDurationMs: z.number().int().nonnegative().optional(),
        usageIsIncomplete: z.boolean().optional(),
      })
      .nullish(),
  }),
});

interface GrokTurnUsageInput {
  method: string;
  params: Record<string, unknown>;
  sessionId: string | null;
  turnId: string | null;
}

export function parseGrokTurnUsage({
  method,
  params,
  sessionId,
  turnId,
}: GrokTurnUsageInput): Pick<AgentUsage, "outputTokensPerSecond"> | null {
  if (method !== "_x.ai/session_notification") return null;
  const parsed = GrokTurnUsageSchema.safeParse(params);
  if (!parsed.success) return null;
  const { update } = parsed.data;
  const matchesTurn = parsed.data.sessionId === sessionId && update.prompt_id === turnId;
  if (!matchesTurn) return null;

  const { outputTokens, apiDurationMs, usageIsIncomplete } = update.usage ?? {};
  const hasMeasurement =
    outputTokens !== undefined &&
    apiDurationMs !== undefined &&
    apiDurationMs > 0 &&
    !usageIsIncomplete;
  if (!hasMeasurement) return { outputTokensPerSecond: null };

  // Grok sums model API time, including request latency, across the prompt's calls.
  return { outputTokensPerSecond: (outputTokens / apiDurationMs) * 1000 };
}
