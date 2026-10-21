import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { supportsAgentProfiles } from "./capabilities";
import { materializeAgentProfile, type MaterializedAgentProfile } from "./materialize-profile";

export type AgentProfileInitialization =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "resolved"; profile: MaterializedAgentProfile | null };

export function useInitialAgentProfile(input: {
  serverId: string | null;
  draftKey: string;
  profileId: string | undefined;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(input.serverId ?? "");
  const serverInfo = useSessionStore((state) => state.sessions[input.serverId ?? ""]?.serverInfo);
  const isSupported = supportsAgentProfiles(serverInfo?.features);
  const query = useFetchQuery({
    dataShape: "value",
    queryKey: ["initialAgentProfile", input.serverId, input.draftKey, input.profileId],
    enabled: input.enabled && Boolean(input.profileId && client && isConnected && isSupported),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const { config } = await client.getDaemonConfig();
      const profile = config.agentProfiles?.find((entry) => entry.id === input.profileId);
      return profile ? materializeAgentProfile(profile) : null;
    },
    // Each draft reads the host again. Once applied, the form owns its snapshot;
    // background edits to the profile must not mutate an open draft.
    refetchOnWindowFocus: false,
    staleTimeMs: 0,
    gcTime: 0,
    retry: false,
  });

  let initialization: AgentProfileInitialization;
  if (!input.enabled || !input.profileId || (isConnected && serverInfo && !isSupported)) {
    initialization = { status: "resolved", profile: null };
  } else if (query.isFetching) {
    initialization = { status: "pending" };
  } else if (query.isError) {
    initialization = { status: "error", message: query.error.message };
  } else if (query.isFetchedAfterMount && query.isSuccess) {
    initialization = { status: "resolved", profile: query.data };
  } else {
    initialization = { status: "pending" };
  }
  return { initialization, retry: query.refetch };
}
