import type { AgentSessionShareResult } from "@getpaseo/protocol/messages";

export interface AgentSharePorts {
  share(): Promise<AgentSessionShareResult>;
  copy(text: string): Promise<void>;
}

type ShareFeedback =
  | { status: "idle" }
  | { status: "copying" }
  | { status: "copied" }
  | { status: "error"; message: string };

export type AgentShareState =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "success"; result: AgentSessionShareResult; feedback: ShareFeedback };

export interface AgentShareModel {
  getState(): AgentShareState;
  subscribe(listener: () => void): () => void;
  retry(): void;
  copyLink(): Promise<void>;
  reportActionError(error: unknown): void;
  close(): boolean;
}

export function openAgentShare(ports: AgentSharePorts): AgentShareModel {
  let state: AgentShareState = { status: "pending" };
  let closed = false;
  const listeners = new Set<() => void>();

  function publish(next: AgentShareState): void {
    if (closed) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function upload(): Promise<void> {
    publish({ status: "pending" });
    try {
      const result = await ports.share();
      publish({ status: "success", result, feedback: { status: "idle" } });
    } catch (error) {
      publish({ status: "error", message: errorMessage(error) });
    }
  }

  const model: AgentShareModel = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retry() {
      if (!closed && state.status === "error") void upload();
    },
    async copyLink() {
      if (closed || state.status !== "success" || state.feedback.status === "copying") return;
      const { result } = state;
      publish({ status: "success", result, feedback: { status: "copying" } });
      try {
        await ports.copy(result.viewerUrl);
        publish({ status: "success", result, feedback: { status: "copied" } });
      } catch (error) {
        publish({
          status: "success",
          result,
          feedback: { status: "error", message: errorMessage(error) },
        });
      }
    },
    reportActionError(error) {
      if (state.status !== "success") return;
      publish({
        ...state,
        feedback: { status: "error", message: errorMessage(error) },
      });
    },
    close() {
      const copying = state.status === "success" && state.feedback.status === "copying";
      if (state.status === "pending" || copying) return false;
      closed = true;
      listeners.clear();
      return true;
    },
  };
  void upload();
  return model;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
