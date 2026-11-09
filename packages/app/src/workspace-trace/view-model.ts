import type { TFunction } from "i18next";
import type {
  WorkspaceTraceEdge,
  WorkspaceTraceLane,
  WorkspaceTraceNode,
  WorkspaceTracePage,
} from "@getpaseo/protocol/workspace-trace";

/** Presentation index over one fetched page. Ordering only; causality comes from the page edges. */
export interface TraceView {
  page: WorkspaceTracePage;
  lanes: WorkspaceTraceLane[];
  laneIndex: Map<string, number>;
  lanesById: Map<string, WorkspaceTraceLane>;
  nodes: WorkspaceTraceNode[];
  nodesById: Map<string, WorkspaceTraceNode>;
  incoming: Map<string, WorkspaceTraceEdge[]>;
  outgoing: Map<string, WorkspaceTraceEdge[]>;
  laneTitle(laneId: string, t: TFunction): string;
  nodeLabel(node: WorkspaceTraceNode, t: TFunction): string;
}

function pushTo(map: Map<string, WorkspaceTraceEdge[]>, key: string, edge: WorkspaceTraceEdge) {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

export function buildTraceView(page: WorkspaceTracePage): TraceView {
  const lanesById = new Map(page.lanes.map((lane) => [lane.id, lane]));
  // Lanes keep the daemon's order so streaming refreshes append rather than reshuffle.
  const laneIndex = new Map(page.lanes.map((lane, index) => [lane.id, index]));
  const nodes = [...page.nodes].sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, WorkspaceTraceEdge[]>();
  const outgoing = new Map<string, WorkspaceTraceEdge[]>();
  for (const edge of page.edges) {
    pushTo(incoming, edge.targetNodeId, edge);
    pushTo(outgoing, edge.sourceNodeId, edge);
  }
  function laneTitle(laneId: string, t: TFunction): string {
    const lane = lanesById.get(laneId);
    if (!lane) return t("workspaceTrace.lane.unknown");
    return lane.title ?? lane.agentId.slice(0, 8);
  }
  function nodeLabel(node: WorkspaceTraceNode, t: TFunction): string {
    return node.title ?? t(`workspaceTrace.kind.${node.kind}`);
  }
  return {
    page,
    lanes: page.lanes,
    laneIndex,
    lanesById,
    nodes,
    nodesById,
    incoming,
    outgoing,
    laneTitle,
    nodeLabel,
  };
}
