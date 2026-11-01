import { useMemo } from "react";
import { buildDeskModel, type DeskHostInput } from "@/board/desk";
import { EMPTY_BOARD_FILTERS } from "@/board/items";
import { useBoardTasks } from "@/board/tasks";
import { countDeskZone } from "@/components/board/board-desk";
import { useHosts } from "@/runtime/host-runtime";
import { useHostDirectories } from "@/stores/session-store-hooks";

export interface DeskAttentionCounts {
  /** Checkpoints waiting in Decide. */
  decide: number;
  /** Work moving in Flight. */
  flight: number;
}

/**
 * Decide and Flight counts across every host whose tasks and directory are loaded. Each host
 * counts under its own Desk settings, unfiltered, with only waiting or failed subagents surfaced.
 */
export function useBoardAttentionCounts(): DeskAttentionCounts {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const hostTasks = useBoardTasks((state) => state.hosts);
  const directories = useHostDirectories(serverIds);
  return useMemo(() => {
    const counts: DeskAttentionCounts = { decide: 0, flight: 0 };
    const now = Date.now();
    for (const directory of directories) {
      const state = hostTasks[directory.serverId];
      if (state?.status !== "ready" || !directory.hydrated) continue;
      const host: DeskHostInput = {
        serverId: directory.serverId,
        serverName: "",
        tasks: state.tasks,
        goals: state.goals,
        decisions: state.decisions,
        snoozes: state.snoozes,
        directory,
      };
      const model = buildDeskModel([host], {
        settings: state.settings,
        filters: EMPTY_BOARD_FILTERS,
        focus: null,
        showSubagents: false,
        now,
      });
      counts.decide += model.decide.length;
      counts.flight += countDeskZone(model, "flight");
    }
    return counts;
  }, [directories, hostTasks]);
}
