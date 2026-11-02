interface AgentRoleCapabilities {
  agentRoles?: boolean;
}

export function supportsAgentRoles(features: AgentRoleCapabilities | undefined): boolean {
  return features?.agentRoles === true;
}
