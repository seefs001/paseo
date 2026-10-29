import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";

interface ProviderPaseoToolSettings {
  paseoTools?: ProviderPaseoToolsPolicy;
}

export function resolvePaseoToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderPaseoToolSettings>> | undefined,
): ProviderPaseoToolsPolicy | undefined {
  return providerSettings?.[providerId]?.paseoTools;
}

export function isPaseoToolEnabled(
  policy: ProviderPaseoToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isPaseoToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isPaseoToolPolicyEnabled(policy: ProviderPaseoToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}

/** Host settings add to the provider denylist. An empty host list leaves the provider policy unchanged. */
export function mergeHostDisabledTools(
  policy: ProviderPaseoToolsPolicy | undefined,
  hostDisabled: readonly string[] | undefined,
): ProviderPaseoToolsPolicy | undefined {
  if (!hostDisabled || hostDisabled.length === 0) return policy;
  const disabledTools = [...new Set([...(policy?.disabledTools ?? []), ...hostDisabled])];
  return { ...policy, disabledTools };
}
