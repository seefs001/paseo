import { useCallback, useMemo, useState } from "react";
import type { PaseoSubagentRow, SubagentRow } from "./select";
import { useBulkSubagentActions, type BulkSubagentAction } from "./use-bulk-subagent-actions";

export function rowSelectionKey(row: SubagentRow, serverId: string): string {
  return row.kind === "paseo"
    ? `${row.address.serverId}:${row.id}`
    : `${serverId}:provider:${row.id}`;
}

export interface SubagentSelection {
  selecting: boolean;
  selectedKeys: ReadonlySet<string>;
  selectableCount: number;
  selectedCount: number;
  selectedRunningCount: number;
  pending: BulkSubagentAction | null;
  start: () => void;
  cancel: () => void;
  toggle: (key: string) => void;
  run: (action: BulkSubagentAction) => void;
}

/**
 * Selection mode for the subagents panel. Only managed Paseo subagents are selectable: provider
 * rows have no Paseo lifecycle. Rows that leave the track drop out of the selection on their own.
 */
export function useSubagentSelection(
  rows: readonly SubagentRow[],
  serverId: string,
): SubagentSelection {
  const bulk = useBulkSubagentActions();
  const [selecting, setSelecting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const selectableRows = useMemo(
    () => rows.filter((row): row is PaseoSubagentRow => row.kind === "paseo"),
    [rows],
  );
  const selectedRows = useMemo(
    () => selectableRows.filter((row) => selectedKeys.has(rowSelectionKey(row, serverId))),
    [selectableRows, selectedKeys, serverId],
  );
  const toggle = useCallback((key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const start = useCallback(() => {
    setSelectedKeys(new Set());
    setSelecting(true);
  }, []);
  const cancel = useCallback(() => {
    setSelecting(false);
    setSelectedKeys(new Set());
  }, []);
  const runBulk = bulk.run;
  const run = useCallback(
    (action: BulkSubagentAction) => {
      const addresses = selectedRows
        .filter((row) => action !== "stop" || row.turn.phase === "open")
        .map((row) => row.address);
      const execute = async () => {
        if (await runBulk(action, addresses)) cancel();
      };
      void execute();
    },
    [cancel, runBulk, selectedRows],
  );

  return {
    selecting,
    selectedKeys,
    selectableCount: selectableRows.length,
    selectedCount: selectedRows.length,
    selectedRunningCount: selectedRows.filter((row) => row.turn.phase === "open").length,
    pending: bulk.pending,
    start,
    cancel,
    toggle,
    run,
  };
}
