import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { ArtifactError, type ArtifactStore } from "../../artifacts/store.js";
import type { SessionDelivery } from "../owned-subscriptions/index.js";

type ArtifactRequest = Extract<
  SessionInboundMessage,
  { type: "artifact.list.request" | "artifact.read.request" | "artifact.remove.request" }
>;
type Request<T extends ArtifactRequest["type"]> = Extract<ArtifactRequest, { type: T }>;

export interface ArtifactSessionOptions {
  emit(message: SessionOutboundMessage): void;
  delivery: Pick<SessionDelivery, "begin">;
  // Absent when the daemon runs without Desk storage.
  artifacts: ArtifactStore | null;
}

/** The artifact.* requests: the host-wide collection, one entry's content, and removal. */
export class ArtifactSession {
  constructor(private readonly options: ArtifactSessionOptions) {}

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "artifact.list.request":
        return this.handleList(msg);
      case "artifact.read.request":
        return this.handleRead(msg);
      case "artifact.remove.request":
        return this.handleRemove(msg);
      default:
        return undefined;
    }
  }

  private async handleList(msg: Request<"artifact.list.request">): Promise<void> {
    const store = this.options.artifacts;
    if (!store) {
      this.emitError(msg, new ArtifactsUnavailableError());
      return;
    }
    if (!msg.subscribe) {
      this.options.emit({
        type: "artifact.list.response",
        payload: { requestId: msg.requestId, artifacts: store.list() },
      });
      return;
    }
    let unsubscribe = () => {};
    const owner = this.options.delivery.begin("artifacts", msg.subscribe.subscriptionId, () => {
      unsubscribe();
    });
    // Registering and reading the snapshot in one tick leaves no gap for a missed change.
    unsubscribe = store.subscribe((change) => {
      if (owner.signal.aborted) return;
      owner.emit({ type: "artifact.update", payload: change });
    });
    this.options.emit({
      type: "artifact.list.response",
      payload: {
        requestId: msg.requestId,
        subscriptionId: owner.responseId,
        artifacts: store.list(),
      },
    });
  }

  private async handleRead(msg: Request<"artifact.read.request">): Promise<void> {
    try {
      const { artifact, content } = await this.requireStore().read(msg.artifactId);
      const encoding = artifact.media === "image" ? "base64" : "utf8";
      this.options.emit({
        type: "artifact.read.response",
        payload: {
          requestId: msg.requestId,
          artifact,
          encoding,
          content: content.toString(encoding),
        },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private async handleRemove(msg: Request<"artifact.remove.request">): Promise<void> {
    try {
      await this.requireStore().remove(msg.artifactId);
      this.options.emit({
        type: "artifact.remove.response",
        payload: { requestId: msg.requestId, artifactId: msg.artifactId },
      });
    } catch (error) {
      this.emitError(msg, error);
    }
  }

  private requireStore(): ArtifactStore {
    if (!this.options.artifacts) throw new ArtifactsUnavailableError();
    return this.options.artifacts;
  }

  private emitError(request: ArtifactRequest, error: unknown): void {
    let code = "artifact_request_failed";
    if (error instanceof ArtifactError || error instanceof ArtifactsUnavailableError) {
      code = error.code;
    }
    this.options.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        code,
        error: error instanceof Error ? error.message : "Artifact request failed",
      },
    });
  }
}

class ArtifactsUnavailableError extends Error {
  readonly code = "artifacts_unavailable";

  constructor() {
    super("Artifacts are unavailable on this host");
    this.name = "ArtifactsUnavailableError";
  }
}
