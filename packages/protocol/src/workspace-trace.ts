import { z } from "zod";

export const WorkspaceTraceAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    serverId: z.string(),
    agentId: z.string(),
    callId: z.string().optional(),
    messageId: z.string().optional(),
  }),
  z.object({ kind: z.literal("artifact"), artifactId: z.string() }),
]);
export type WorkspaceTraceAnchor = z.infer<typeof WorkspaceTraceAnchorSchema>;

export const WorkspaceTraceLaneSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string().nullable(),
  availability: z.enum(["local", "archived", "missing", "external"]),
  parentLaneId: z.string().nullable(),
});
export type WorkspaceTraceLane = z.infer<typeof WorkspaceTraceLaneSchema>;

export const WorkspaceTraceNodeSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "delegation",
    "agent_created",
    "message",
    "notification",
    "dispatch",
    "artifact",
    "schedule",
  ]),
  laneId: z.string(),
  at: z.string(),
  evidence: z.enum(["recorded", "existing"]),
  status: z.enum(["recorded", "queued", "dispatched", "failed", "unknown"]),
  messageIds: z.array(z.string()),
  anchor: WorkspaceTraceAnchorSchema.nullable(),
  title: z.string().optional(),
  sourceTurnId: z.string().optional(),
  requestedBehavior: z.enum(["steer", "interrupt"]).optional(),
  behavior: z.enum(["started", "steered", "interrupted", "out_of_band"]).optional(),
  notificationEvent: z.enum(["finished", "errored", "permission-required", "closed"]).optional(),
  subscriptionIds: z.array(z.string()).optional(),
});
export type WorkspaceTraceNode = z.infer<typeof WorkspaceTraceNodeSchema>;

export const WorkspaceTraceEdgeSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  kind: z.enum(["delegation", "message", "notification"]),
  evidence: z.literal("recorded"),
});
export type WorkspaceTraceEdge = z.infer<typeof WorkspaceTraceEdgeSchema>;

export const WorkspaceTraceGapSchema = z.object({
  kind: z.enum(["history", "retention", "pending", "recording", "focus_unavailable", "window"]),
  agentId: z.string().optional(),
});
export type WorkspaceTraceGap = z.infer<typeof WorkspaceTraceGapSchema>;

export const WorkspaceTracePageSchema = z.object({
  workspaceId: z.string(),
  serverId: z.string(),
  capturedAt: z.string(),
  nodes: z.array(WorkspaceTraceNodeSchema),
  edges: z.array(WorkspaceTraceEdgeSchema),
  lanes: z.array(WorkspaceTraceLaneSchema),
  gaps: z.array(WorkspaceTraceGapSchema),
  nextCursor: z.string().nullable(),
  focusNodeId: z.string().nullable(),
});
export type WorkspaceTracePage = z.infer<typeof WorkspaceTracePageSchema>;

export const WorkspaceTraceGetRequestSchema = z.object({
  type: z.literal("workspace.trace.get.request"),
  requestId: z.string(),
  workspaceId: z.string().min(1),
  cursor: z.string().optional(),
  focusNodeId: z.string().optional(),
  depth: z.number().int().min(1).max(4).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type WorkspaceTraceQuery = Omit<
  z.infer<typeof WorkspaceTraceGetRequestSchema>,
  "type" | "requestId"
>;

export const WorkspaceTraceGetResponseSchema = z.object({
  type: z.literal("workspace.trace.get.response"),
  payload: z.object({ requestId: z.string(), trace: WorkspaceTracePageSchema }),
});
