import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import type { DeskGoalFocus } from "@/board/desk";
import { EMPTY_BOARD_FILTERS, type BoardFilters } from "@/board/items";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";

/**
 * Everything that shapes what the Desk shows lives in the URL, so a reload or a shared link
 * opens the same view. Defaults stay out of the URL to keep plain `/board` links plain.
 */
export interface BoardRouteState {
  filters: BoardFilters;
  /** One goal, or Loose work on one host; `null` shows every group. */
  focus: DeskGoalFocus | null;
  showSubagents: boolean;
  host: string;
}

export type BoardRoutePatch = Partial<BoardRouteState>;

/** The `goal` param value that focuses work without a goal. */
const LOOSE_FOCUS = "loose";

type RawParam = string | string[] | undefined;

type BoardSearchParams = Partial<
  Record<
    | "q"
    | "project"
    | "workspace"
    | "provider"
    | "label"
    | "subagents"
    | "host"
    | "goal"
    | "goalHost",
    string | string[]
  >
>;

function readString(value: RawParam): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

// Lists are comma-joined; ids and label names on the Desk do not carry commas in practice.
function readList(value: RawParam): string[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return raw.split(",").filter((entry) => entry.length > 0);
}

function writeList(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

function serializePatch(patch: BoardRoutePatch): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  if (patch.filters !== undefined) {
    params.q = patch.filters.query.length > 0 ? patch.filters.query : undefined;
    params.project = writeList(patch.filters.projects);
    params.workspace = writeList(patch.filters.workspaces);
    params.provider = writeList(patch.filters.providers);
    params.label = writeList(patch.filters.labels);
  }
  if (patch.focus !== undefined) {
    params.goal = patch.focus ? (patch.focus.goalId ?? LOOSE_FOCUS) : undefined;
    params.goalHost = patch.focus?.serverId;
  }
  if (patch.showSubagents !== undefined) {
    params.subagents = patch.showSubagents ? undefined : "0";
  }
  if (patch.host !== undefined) {
    params.host = patch.host === ALL_HOSTS_OPTION_ID ? undefined : patch.host;
  }
  return params;
}

export function useBoardRouteState(): [BoardRouteState, (patch: BoardRoutePatch) => void] {
  const params = useLocalSearchParams<BoardSearchParams>();
  const query = readString(params.q);
  const projects = readString(params.project);
  const workspaces = readString(params.workspace);
  const providers = readString(params.provider);
  const labels = readString(params.label);
  const subagents = readString(params.subagents);
  const host = readString(params.host);
  const goal = readString(params.goal);
  const goalHost = readString(params.goalHost);

  const state = useMemo<BoardRouteState>(() => {
    const hasFilters = query || projects || workspaces || providers || labels;
    return {
      filters: hasFilters
        ? {
            query,
            projects: readList(projects),
            workspaces: readList(workspaces),
            providers: readList(providers),
            labels: readList(labels),
          }
        : EMPTY_BOARD_FILTERS,
      focus:
        goal && goalHost
          ? { serverId: goalHost, goalId: goal === LOOSE_FOCUS ? null : goal }
          : null,
      showSubagents: subagents !== "0",
      host: host || ALL_HOSTS_OPTION_ID,
    };
  }, [goal, goalHost, host, labels, projects, providers, query, subagents, workspaces]);

  const update = useCallback((patch: BoardRoutePatch) => {
    router.setParams(serializePatch(patch));
  }, []);

  return [state, update];
}
