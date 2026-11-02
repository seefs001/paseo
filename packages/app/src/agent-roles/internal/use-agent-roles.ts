import { useCallback, useMemo } from "react";
import { DEFAULT_AGENT_ROLES, resolveAgentRoles } from "@getpaseo/protocol/agent-role";
import type { AgentRole } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";
import { supportsAgentRoles } from "./capabilities";

export interface UseAgentRolesResult {
  /** The host's roles, built-in defaults included. `null` until the daemon config has arrived. */
  roles: readonly AgentRole[] | null;
  /** False on daemons that predate agent roles, or while disconnected. */
  isSupported: boolean;
  /** The list equals the built-in roles, so "Restore default roles" has nothing to do. */
  isDefault: boolean;
  /** Writes the whole list; there is no per-role RPC. */
  saveRoles: (next: AgentRole[]) => Promise<void>;
  /**
   * Writes a copy of the built-in roles. Config patches cannot remove a key, so
   * the restored list stays put when a later version changes the defaults.
   */
  restoreDefaultRoles: () => Promise<void>;
}

const DEFAULT_ROLES_JSON = JSON.stringify(DEFAULT_AGENT_ROLES);

export function useAgentRoles(serverId: string | null): UseAgentRolesResult {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore((state) =>
    supportsAgentRoles(state.sessions[serverId ?? ""]?.serverInfo?.features),
  );

  const saveRoles = useCallback(
    async (next: AgentRole[]) => {
      await patchConfig({ agentRoles: next });
    },
    [patchConfig],
  );
  const restoreDefaultRoles = useCallback(() => saveRoles([...DEFAULT_AGENT_ROLES]), [saveRoles]);

  const roles = useMemo(() => (config ? resolveAgentRoles(config.agentRoles) : null), [config]);
  const isDefault = roles === null || JSON.stringify(roles) === DEFAULT_ROLES_JSON;

  return { roles, isSupported, isDefault, saveRoles, restoreDefaultRoles };
}
