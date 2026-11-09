import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient, type QueryFunctionContext } from "@tanstack/react-query";
import type { WorkspaceTracePage } from "@getpaseo/protocol/workspace-trace";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { fetchInfiniteQueryOptions, useFetchInfiniteQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

interface WorkspaceTraceInput {
  serverId: string;
  workspaceId: string;
  enabled?: boolean;
  focusNodeId?: string;
}
interface TraceActions {
  refreshing: boolean;
  loadingMore: boolean;
  refresh(): Promise<unknown>;
  loadMore(): Promise<unknown>;
}
export type WorkspaceTraceState = TraceActions &
  (
    | { status: "loading"; trace: null; error: null }
    | { status: "error"; trace: WorkspaceTracePage | null; error: Error }
    | { status: "ready"; trace: WorkspaceTracePage; error: null }
  );
function mergePage(
  current: WorkspaceTracePage | undefined,
  next: WorkspaceTracePage,
): WorkspaceTracePage {
  if (!current) return next;
  const nodes = new Map([...next.nodes, ...current.nodes].map((node) => [node.id, node]));
  const edges = new Map([...next.edges, ...current.edges].map((edge) => [edge.id, edge]));
  const lanes = new Map([...next.lanes, ...current.lanes].map((lane) => [lane.id, lane]));
  const gaps = new Map(
    [...next.gaps, ...current.gaps].map((gap) => [`${gap.kind}:${gap.agentId ?? ""}`, gap]),
  );
  return {
    ...current,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    lanes: [...lanes.values()],
    gaps: [...gaps.values()],
    nextCursor: next.nextCursor,
  };
}

export function useWorkspaceTrace({
  serverId,
  workspaceId,
  enabled = true,
  focusNodeId,
}: WorkspaceTraceInput): WorkspaceTraceState {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const active = useRetainedPanelActive();
  const cache = useQueryClient();
  const scope = JSON.stringify([serverId, workspaceId, focusNodeId ?? null]);
  const canRead = enabled && active && connected && Boolean(client);
  const options = useMemo(
    () => ({
      queryKey: ["workspace-trace", scope],
      queryFn: async ({ pageParam }: QueryFunctionContext<readonly string[], string | null>) => {
        if (!client) throw new Error("Host disconnected");
        return client.getWorkspaceTrace({
          workspaceId,
          focusNodeId,
          cursor: pageParam ?? undefined,
        });
      },
      initialPageParam: null,
      getNextPageParam: (page: WorkspaceTracePage) => page.nextCursor,
      retry: false,
      staleTimeMs: 5_000,
      dataShape: "value" as const,
    }),
    [client, focusNodeId, scope, workspaceId],
  );
  // Automatic reads also use the first-page refresh, not an all-page refetch.
  const query = useFetchInfiniteQuery({ ...options, enabled: false });
  const refreshRequest = useRef<{ scope: string } | null>(null);
  const firstActivation = useRef(true);
  const refresh = useCallback(async () => {
    if (!canRead || refreshRequest.current?.scope === scope) return;
    const request = { scope };
    refreshRequest.current = request;
    try {
      await cache.cancelQueries({ queryKey: options.queryKey, exact: true });
      // Query cancellation ignores late results; it does not cancel the daemon RPC.
      await cache.fetchInfiniteQuery({
        ...fetchInfiniteQueryOptions(options),
        pages: 1,
        staleTime: 0,
      });
    } catch {
      // The query exposes the failure without discarding its previously loaded pages.
    } finally {
      if (refreshRequest.current === request) refreshRequest.current = null;
    }
  }, [cache, canRead, options, scope]);
  useEffect(() => {
    if (!canRead) return;
    const cachedQuery = cache.getQueryCache().find({ queryKey: options.queryKey, exact: true });
    const shouldRefresh =
      firstActivation.current || cachedQuery?.isStaleByTime(options.staleTimeMs);
    firstActivation.current = false;
    if (shouldRefresh) void refresh();
  }, [cache, canRead, options, refresh]);

  const trace = useMemo(
    () => query.data?.pages.reduce<WorkspaceTracePage | undefined>(mergePage, undefined) ?? null,
    [query.data?.pages],
  );
  const error = query.error;
  const actions: TraceActions = {
    refreshing: query.isRefetching,
    loadingMore: query.isFetchingNextPage,
    refresh,
    loadMore: async () => {
      if (!canRead || refreshRequest.current?.scope === scope || !query.hasNextPage) return;
      await query.fetchNextPage({ cancelRefetch: false });
    },
  };
  if (error) return { ...actions, status: "error", trace, error };
  if (trace) return { ...actions, status: "ready", trace, error: null };
  if (!connected)
    return { ...actions, status: "error", trace: null, error: new Error("Host disconnected") };
  return { ...actions, status: "loading", trace: null, error: null };
}
