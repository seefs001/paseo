import type {
  SessionTitlePreview,
  SessionTitleProposal,
  SessionTitleApplyResult,
} from "@getpaseo/protocol/session-titles";

export interface RenameRow extends SessionTitleProposal {
  selected: boolean;
  outcome: SessionTitleApplyResult["status"] | null;
}

export function canEditRenameRow(row: RenameRow): boolean {
  return row.outcome === null || row.outcome === "failed";
}

interface RenameDraft {
  prompt: string;
  error: string | null;
}

export type RenameState =
  | (RenameDraft & { phase: "editing" | "generating" })
  | (RenameDraft & {
      phase: "preview" | "applying";
      rows: RenameRow[];
      skipped: SessionTitlePreview["skipped"];
    })
  | { phase: "closed" };

interface RenameFormInput {
  prompt: string;
  preview: (prompt: string) => Promise<SessionTitlePreview>;
  apply: (proposals: SessionTitleProposal[]) => Promise<SessionTitleApplyResult[]>;
  savePrompt: (prompt: string) => Promise<void>;
  invalidPrompt: string;
  invalidTitle: string;
  failed: string;
}

export function openRenameForm(input: RenameFormInput) {
  let state: RenameState = { phase: "editing", prompt: input.prompt, error: null };
  let generation = 0;
  const listeners = new Set<() => void>();
  function publish(next: RenameState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : input.failed;
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (state.phase === "applying") return false;
      generation += 1;
      publish({ phase: "closed" });
      return true;
    },
    setPrompt(prompt: string) {
      if (state.phase !== "editing" && state.phase !== "preview") return;
      publish({ phase: "editing", prompt, error: null });
    },
    editTitle(agentId: string, title: string) {
      if (state.phase !== "preview") return;
      publish({
        ...state,
        error: null,
        rows: state.rows.map((row) =>
          row.agentId === agentId && canEditRenameRow(row) ? { ...row, title } : row,
        ),
      });
    },
    toggle(agentId: string) {
      if (state.phase !== "preview") return;
      publish({
        ...state,
        rows: state.rows.map((row) =>
          row.agentId === agentId && canEditRenameRow(row)
            ? { ...row, selected: !row.selected }
            : row,
        ),
      });
    },
    async generate() {
      if (state.phase !== "editing" && state.phase !== "preview") return;
      const prompt = state.prompt.trim();
      if (!prompt || prompt.length > 4000) {
        publish({ ...state, error: input.invalidPrompt });
        return;
      }
      const operation = ++generation;
      publish({ phase: "generating", prompt, error: null });
      try {
        await input.savePrompt(prompt);
        if (operation !== generation) return;
        const preview = await input.preview(prompt);
        if (operation !== generation) return;
        publish({
          phase: "preview",
          prompt,
          error: null,
          skipped: preview.skipped,
          rows: preview.proposals.map((proposal) => ({
            agentId: proposal.agentId,
            previousTitle: proposal.previousTitle,
            title: proposal.title,
            selected: true,
            outcome: null,
          })),
        });
      } catch (error) {
        if (operation === generation)
          publish({ phase: "editing", prompt, error: errorText(error) });
      }
    },
    async apply() {
      if (state.phase !== "preview") return;
      const snapshot = state;
      const selected = snapshot.rows.filter((row) => row.selected && canEditRenameRow(row));
      if (selected.length === 0) return;
      if (selected.some((row) => !row.title.trim() || row.title.trim().length > 200)) {
        publish({ ...snapshot, error: input.invalidTitle });
        return;
      }
      publish({ ...snapshot, phase: "applying", error: null });
      try {
        const proposals = selected.map(({ agentId, previousTitle, title }) => ({
          agentId,
          previousTitle,
          title: title.trim(),
        }));
        const results = await input.apply(proposals);
        const outcomes = new Map(results.map((result) => [result.agentId, result.status]));
        const rows = snapshot.rows.map((row) => {
          const outcome = outcomes.get(row.agentId);
          if (!outcome) return row;
          return { ...row, outcome, selected: outcome === "failed" };
        });
        publish({ ...snapshot, phase: "preview", rows, error: null });
      } catch (error) {
        publish({ ...snapshot, phase: "preview", error: errorText(error) });
      }
    },
  };
}

export type RenameForm = ReturnType<typeof openRenameForm>;
