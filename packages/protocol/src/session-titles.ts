import { z } from "zod";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "./agent-title-limits.js";

export const SessionTitleProposalSchema = z.object({
  agentId: z.string(),
  previousTitle: z.string().nullable(),
  title: z.string().min(1).max(MAX_EXPLICIT_AGENT_TITLE_CHARS),
});
export type SessionTitleProposal = z.infer<typeof SessionTitleProposalSchema>;

export const SessionTitlePreviewSchema = z.object({
  proposals: z.array(SessionTitleProposalSchema),
  skipped: z.array(z.object({ agentId: z.string(), reason: z.enum(["missing", "empty"]) })),
});
export type SessionTitlePreview = z.infer<typeof SessionTitlePreviewSchema>;

export const SessionTitleApplyResultSchema = z.object({
  agentId: z.string(),
  status: z.enum(["applied", "conflict", "missing", "failed"]),
});
export type SessionTitleApplyResult = z.infer<typeof SessionTitleApplyResultSchema>;

export const SessionTitlesPreviewRequestSchema = z.object({
  type: z.literal("agent.titles.preview.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
  agentIds: z.array(z.string().min(1)).min(1).max(100),
  prompt: z.string().min(1).max(4000),
});
export const SessionTitlesPreviewResponseSchema = z.object({
  type: z.literal("agent.titles.preview.response"),
  payload: SessionTitlePreviewSchema.extend({ requestId: z.string() }),
});
export const SessionTitlesApplyRequestSchema = z.object({
  type: z.literal("agent.titles.apply.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
  proposals: z.array(SessionTitleProposalSchema).min(1).max(100),
});
export const SessionTitlesApplyResponseSchema = z.object({
  type: z.literal("agent.titles.apply.response"),
  payload: z.object({ requestId: z.string(), results: z.array(SessionTitleApplyResultSchema) }),
});
