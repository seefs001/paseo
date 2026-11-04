import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import {
  usePullRequestConnection,
  type PullRequestConnection,
} from "@/git/pull-request-connection";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { normalizeForge } from "@/git/forge";
import { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";
import { type CheckoutPrStatusPayload, normalizeCheckoutPrStatusPayload } from "@/git/pr-status";

interface UseCheckoutPrStatusQueryOptions {
  serverId: string;
  cwd: string;
  enabled?: boolean;
  observe?: boolean;
}

export type { CheckoutPrStatusPayload } from "@/git/pr-status";
export { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";

function selectWorkspacePrHint(payload: CheckoutPrStatusPayload): PrHint | null {
  return selectPrHintFromStatus(payload.status, payload.forge);
}

interface PrStatusObservationOptions extends Required<UseCheckoutPrStatusQueryOptions> {
  connection: PullRequestConnection;
}

function usePrStatusObservation({
  connection,
  serverId,
  cwd,
  enabled,
  observe,
}: PrStatusObservationOptions) {
  const queryClient = useQueryClient();
  const retainedPanelActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const queryEnabled = enabled && retainedPanelActive && appVisible;
  const { client, isConnected } = connection;

  useEffect(() => {
    if (!observe || !queryEnabled || !isConnected || !cwd || !client?.observeCheckoutPrStatus)
      return;
    const observation = client.observeCheckoutPrStatus(cwd);
    if (!observation) return;
    const receive = (payload: Parameters<typeof normalizeCheckoutPrStatusPayload>[0]) => {
      queryClient.setQueryData(
        checkoutPrStatusQueryKey(serverId, cwd),
        normalizeCheckoutPrStatusPayload(payload),
      );
    };
    observation.subscribe({
      snapshot: receive,
      update: (message) => {
        if (message.type === "checkout_pr_status_response") receive(message.payload);
      },
    });
    return () => {
      void observation.release();
    };
  }, [client, isConnected, observe, queryEnabled, serverId, cwd, queryClient]);

  return queryEnabled;
}

export function useCheckoutPrStatusQuery({
  serverId,
  cwd,
  enabled = true,
  observe = true,
}: UseCheckoutPrStatusQueryOptions) {
  const { t } = useTranslation();
  const connection = usePullRequestConnection(serverId);
  const { client, isConnected } = connection;
  const queryEnabled = usePrStatusObservation({ connection, serverId, cwd, enabled, observe });

  const query = useQuery({
    queryKey: checkoutPrStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return normalizeCheckoutPrStatusPayload(await client.checkoutPrStatus(cwd));
    },
    enabled: !!client && isConnected && !!cwd && queryEnabled,
    staleTime: Infinity,
    // Explicit invalidation repairs missed push updates after reconnect.
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    status: query.data?.status ?? null,
    githubFeaturesEnabled: query.data?.githubFeaturesEnabled ?? true,
    authState: query.data?.authState,
    forge: normalizeForge(query.data?.forge),
    resolvedForge: query.data === undefined ? null : normalizeForge(query.data.forge),
    payloadError: query.data?.error ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}

export function useWorkspacePrHint({
  serverId,
  cwd,
  enabled = true,
  observe = true,
}: UseCheckoutPrStatusQueryOptions): PrHint | null {
  const { t } = useTranslation();
  const connection = usePullRequestConnection(serverId);
  const { client, isConnected } = connection;
  const queryEnabled = usePrStatusObservation({ connection, serverId, cwd, enabled, observe });

  const query = useQuery<CheckoutPrStatusPayload, Error, PrHint | null>({
    queryKey: checkoutPrStatusQueryKey(serverId, cwd),
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return normalizeCheckoutPrStatusPayload(await client.checkoutPrStatus(cwd));
    },
    enabled: !!client && isConnected && !!cwd && queryEnabled,
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    select: selectWorkspacePrHint,
  });

  return query.data ?? null;
}
