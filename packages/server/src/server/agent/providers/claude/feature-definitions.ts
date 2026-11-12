import type { AgentOptionControl, AgentOptionToggleControl } from "../../agent-sdk-types.js";
import { claudeManifestModelSupportsFastMode } from "./model-manifest.js";

export const CLAUDE_MCP_AUTO_ACCEPT_CONTROL: AgentOptionToggleControl = {
  type: "toggle",
  key: "auto_accept_mcp",
  label: "MCP",
  description: "Automatically approves MCP tool calls.",
  tooltip: "Automatically approve MCP tools",
  icon: "shield-check",
};

export const CLAUDE_FAST_MODE_CONTROL: AgentOptionToggleControl = {
  type: "toggle",
  key: "fast_mode",
  label: "Fast",
  description: "Lower latency responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export function claudeModelSupportsFastMode(modelId: string | null | undefined): boolean {
  return claudeManifestModelSupportsFastMode(modelId);
}

export function buildClaudeControls(modelId: string | null | undefined): AgentOptionControl[] {
  const controls: AgentOptionControl[] = [{ ...CLAUDE_MCP_AUTO_ACCEPT_CONTROL }];
  if (claudeModelSupportsFastMode(modelId)) controls.push({ ...CLAUDE_FAST_MODE_CONTROL });
  return controls;
}
