import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export function resolveParentAgentTarget({
  target,
  parentAgentId,
  parentSubagentId,
}: {
  target: WorkspaceTabTarget;
  parentAgentId: string | null;
  // Undefined until the provider descriptor loads; null means a direct child of the root agent.
  parentSubagentId: string | null | undefined;
}): Extract<WorkspaceTabTarget, { kind: "agent" | "provider_subagent" }> | null {
  if (target.kind === "agent" && parentAgentId) {
    return { kind: "agent", agentId: parentAgentId };
  }
  if (target.kind === "provider_subagent" && parentSubagentId !== undefined) {
    if (parentSubagentId) {
      return { ...target, subagentId: parentSubagentId };
    }
    return { kind: "agent", agentId: target.parentAgentId };
  }
  return null;
}
