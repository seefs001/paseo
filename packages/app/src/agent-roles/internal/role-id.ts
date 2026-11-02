export function generateAgentRoleId(): string {
  return `agent_role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
