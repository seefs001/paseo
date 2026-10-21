import type { AgentAddress } from "@getpaseo/protocol/addresses";
import type { TurnLiveness } from "@/timeline/turn-liveness";
import type { SubagentRow } from "./select";

export type StopAllStatus =
  | { kind: "idle" }
  | { kind: "stopping"; completedCount: number; totalCount: number }
  | { kind: "failed"; failedCount: number; totalCount: number };

export interface StopAllState {
  eligibleCount: number;
  status: StopAllStatus;
}

export interface StopAllOutcome {
  stoppedIds: string[];
  skippedIds: string[];
  failures: Array<{ id: string; error: unknown }>;
}

export interface StopAllSubagentsDeps {
  stopSubagent: (address: AgentAddress) => Promise<void>;
  isStillStoppable: (address: AgentAddress) => boolean;
}

export interface StopAllSubagents {
  getState(): StopAllState;
  setRows(rows: readonly SubagentRow[]): void;
  subscribe(listener: () => void): () => void;
  stopAll(): Promise<StopAllOutcome>;
}

export function isStoppableTurn(turn: TurnLiveness): boolean {
  return turn.phase === "open" && turn.cancellationRequestId === null;
}

export function isStoppableSubagent(
  row: SubagentRow,
): row is Extract<SubagentRow, { kind: "paseo" }> {
  return row.kind === "paseo" && isStoppableTurn(row.turn);
}

export function countStoppableSubagents(rows: readonly SubagentRow[]): number {
  return rows.filter(isStoppableSubagent).length;
}

function managedRowIdentity(address: AgentAddress): string {
  return `paseo:${address.serverId}:${address.agentId}`;
}

function eligibleSignature(rows: readonly Extract<SubagentRow, { kind: "paseo" }>[]): string {
  return rows
    .map((row) => managedRowIdentity(row.address))
    .sort()
    .join("\0");
}

function emptyOutcome(): StopAllOutcome {
  return { stoppedIds: [], skippedIds: [], failures: [] };
}

export function createStopAllSubagents(
  initialRows: readonly SubagentRow[],
  deps: StopAllSubagentsDeps,
): StopAllSubagents {
  let eligibleRows = initialRows.filter(isStoppableSubagent);
  let signature = eligibleSignature(eligibleRows);
  let failedSignature: string | null = null;
  let state: StopAllState = {
    eligibleCount: eligibleRows.length,
    status: { kind: "idle" },
  };
  const listeners = new Set<() => void>();

  const publish = () => {
    for (const listener of listeners) listener();
  };
  const setState = (next: StopAllState) => {
    state = next;
    publish();
  };

  const setRows = (rows: readonly SubagentRow[]) => {
    const nextEligibleRows = rows.filter(isStoppableSubagent);
    const nextSignature = eligibleSignature(nextEligibleRows);
    const eligibilityChanged = signature !== nextSignature;
    eligibleRows = nextEligibleRows;
    signature = nextSignature;

    if (state.status.kind === "failed" && failedSignature !== signature) {
      failedSignature = null;
      setState({ eligibleCount: eligibleRows.length, status: { kind: "idle" } });
      return;
    }
    if (state.eligibleCount !== eligibleRows.length || eligibilityChanged) {
      setState({ ...state, eligibleCount: eligibleRows.length });
    }
  };

  const stopAll = () => {
    if (state.status.kind === "stopping" || eligibleRows.length === 0) {
      return Promise.resolve(emptyOutcome());
    }

    const snapshot = eligibleRows;
    const totalCount = snapshot.length;
    setState({
      eligibleCount: eligibleRows.length,
      status: { kind: "stopping", completedCount: 0, totalCount },
    });
    return runStopAll(snapshot, deps, (completedCount) => {
      setState({
        eligibleCount: eligibleRows.length,
        status: { kind: "stopping", completedCount, totalCount },
      });
    }).then(({ outcome, retryableFailureIds }) => {
      failedSignature =
        retryableFailureIds.size > 0 ? [...retryableFailureIds].sort().join("\0") : null;
      setState({
        eligibleCount: eligibleRows.length,
        status:
          retryableFailureIds.size > 0
            ? {
                kind: "failed",
                failedCount: retryableFailureIds.size,
                totalCount: retryableFailureIds.size,
              }
            : { kind: "idle" },
      });
      return outcome;
    });
  };

  return {
    getState: () => state,
    setRows,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopAll,
  };
}

async function runStopAll(
  rows: readonly Extract<SubagentRow, { kind: "paseo" }>[],
  deps: StopAllSubagentsDeps,
  reportProgress: (completedCount: number) => void,
): Promise<{ outcome: StopAllOutcome; retryableFailureIds: Set<string> }> {
  let completedCount = 0;
  const outcome = emptyOutcome();
  const retryableFailureIds = new Set<string>();

  await Promise.all(
    rows.map(async (row) => {
      const id = row.address.agentId;
      if (!deps.isStillStoppable(row.address)) {
        outcome.skippedIds.push(id);
      } else {
        try {
          await deps.stopSubagent(row.address);
          outcome.stoppedIds.push(id);
        } catch (error) {
          if (deps.isStillStoppable(row.address)) {
            outcome.failures.push({ id, error });
            retryableFailureIds.add(managedRowIdentity(row.address));
          } else {
            outcome.skippedIds.push(id);
          }
        }
      }
      completedCount += 1;
      reportProgress(completedCount);
    }),
  );

  return { outcome, retryableFailureIds };
}
