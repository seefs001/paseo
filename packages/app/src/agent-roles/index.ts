/**
 * Agent roles: named ways of working (instructions plus an optional default
 * Agent profile) stored host-wide in daemon config. The daemon writes a role's
 * instructions into a new agent's system prompt, so a role applies only when an
 * agent is created.
 *
 * The public surface manages roles, picks one for a draft, and shows a running
 * agent's role. Import from `@/agent-roles`, never a path inside it.
 */
export type { AgentRole, AgentRoleSnapshot } from "@getpaseo/protocol/messages";
export { useAgentRoles } from "./internal/use-agent-roles";
export { AgentRolesSection } from "./settings/agent-roles-section";
export {
  DraftAgentRoleControl,
  type DraftAgentRoleControlProps,
} from "./controls/draft-role-control";
export { AgentRoleBadge, type AgentRoleBadgeProps } from "./controls/agent-role-badge";
