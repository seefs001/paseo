import type { AgentFeature, AgentFeatureToggle } from "../../agent-sdk-types.js";
import { claudeManifestModelSupportsFastMode } from "./model-manifest.js";

export const CLAUDE_MCP_AUTO_ACCEPT_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "auto_accept_mcp",
  label: "MCP",
  description: "Automatically approves MCP tool calls.",
  tooltip: "Automatically approve MCP tools",
  icon: "shield-check",
};

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency Opus responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export function claudeModelSupportsFastMode(modelId: string | null | undefined): boolean {
  return claudeManifestModelSupportsFastMode(modelId);
}

export function buildClaudeFeatures(input: {
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
  mcpAutoAcceptEnabled: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [
    { ...CLAUDE_MCP_AUTO_ACCEPT_FEATURE, value: input.mcpAutoAcceptEnabled },
  ];
  if (!claudeModelSupportsFastMode(input.modelId)) {
    return features;
  }

  features.push({
    ...CLAUDE_FAST_MODE_FEATURE,
    value: input.fastModeEnabled,
  });
  return features;
}
