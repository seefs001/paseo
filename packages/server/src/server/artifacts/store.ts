import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import {
  ArtifactSchema,
  type Artifact,
  type ArtifactKind,
  type ArtifactMedia,
} from "@getpaseo/protocol/messages";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";

const TITLE_MAX_LENGTH = 200;
/** One copy per artifact; larger results belong in the workspace, not the collection. */
export const ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;

const ArtifactFileSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(ArtifactSchema),
});

export type ArtifactChange =
  | { kind: "upsert"; artifact: Artifact }
  | { kind: "remove"; artifactId: string };

export class ArtifactError extends Error {
  constructor(
    readonly code: "artifact_not_found" | "artifact_invalid" | "artifact_too_large",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

export interface ArtifactRegisterInput {
  /** Update this entry; it must belong to `workspaceId`. */
  artifactId?: string;
  workspaceId: string;
  kind: ArtifactKind;
  title: string;
  fileName: string;
  content: Buffer;
  sourcePath: string | null;
  sourceAgentId: string | null;
  sourceMessageId: string | null;
  goalId: string | null;
  taskIds: string[];
}

const MEDIA_BY_EXTENSION: Record<string, ArtifactMedia> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
};

export function artifactMediaFor(fileName: string): ArtifactMedia {
  return MEDIA_BY_EXTENSION[extname(fileName).toLowerCase()] ?? "text";
}

/**
 * The host's Artifacts collection. Entries live in `$PASEO_HOME/artifacts/index.json`; each
 * entry's content is a daemon-owned copy under `files/<id>/`, so archiving the workspace or
 * removing its worktree leaves the collection readable. Mutations are serialized and written
 * atomically, then announced to subscribers.
 */
export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private readonly listeners = new Set<(change: ArtifactChange) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  private readonly now: () => Date;

  constructor(deps: { paseoHome: string; now?: () => Date }) {
    this.root = join(deps.paseoHome, "artifacts");
    this.now = deps.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.indexPath(), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const file = ArtifactFileSchema.parse(JSON.parse(raw));
    for (const artifact of file.artifacts) this.artifacts.set(artifact.id, artifact);
  }

  list(): Artifact[] {
    return [...this.artifacts.values()];
  }

  get(artifactId: string): Artifact | null {
    return this.artifacts.get(artifactId) ?? null;
  }

  subscribe(listener: (change: ArtifactChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async read(artifactId: string): Promise<{ artifact: Artifact; content: Buffer }> {
    const artifact = this.requireArtifact(artifactId);
    const content = await readFile(this.contentPath(artifact));
    return { artifact, content };
  }

  /**
   * Adds an entry, or replaces the content of one this workspace already has: the one named by
   * `artifactId`, else the one copied from the same `sourcePath`. Either way the id stays and the
   * revision goes up, so the collection never shows the same product twice.
   */
  register(input: ArtifactRegisterInput): Promise<Artifact> {
    return this.enqueue(async () => {
      if (!input.title.trim())
        throw new ArtifactError("artifact_invalid", "Artifact title is required");
      const fileName = safeFileName(input.fileName);
      if (input.content.byteLength > ARTIFACT_MAX_BYTES) {
        throw new ArtifactError(
          "artifact_too_large",
          `Artifact content is larger than ${ARTIFACT_MAX_BYTES} bytes`,
        );
      }
      const previous = this.findExisting(input);
      const artifact = nextArtifact(input, previous, fileName, this.now().toISOString());
      await writeFileAtomic(this.contentPath(artifact), input.content);
      if (previous && previous.fileName !== artifact.fileName) {
        await rm(this.contentPath(previous), { force: true });
      }
      await this.commit((artifacts) => artifacts.set(artifact.id, artifact));
      this.announce({ kind: "upsert", artifact });
      return artifact;
    });
  }

  /**
   * Takes the entry out of the collection. The daemon's stored copy stays on disk, and so does
   * the workspace file it came from: after an archive that copy may be the only one left.
   */
  remove(artifactId: string): Promise<void> {
    return this.enqueue(async () => {
      this.requireArtifact(artifactId);
      await this.commit((artifacts) => artifacts.delete(artifactId));
      this.announce({ kind: "remove", artifactId });
    });
  }

  private findExisting(input: ArtifactRegisterInput): Artifact | null {
    if (input.artifactId) {
      const artifact = this.artifacts.get(input.artifactId);
      if (!artifact || artifact.workspaceId !== input.workspaceId) {
        throw new ArtifactError(
          "artifact_not_found",
          `Artifact ${input.artifactId} is not in this workspace's collection`,
        );
      }
      return artifact;
    }
    if (!input.sourcePath) return null;
    for (const artifact of this.artifacts.values()) {
      if (artifact.workspaceId === input.workspaceId && artifact.sourcePath === input.sourcePath) {
        return artifact;
      }
    }
    return null;
  }

  private requireArtifact(artifactId: string): Artifact {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new ArtifactError("artifact_not_found", "Artifact not found");
    return artifact;
  }

  private async commit(edit: (artifacts: Map<string, Artifact>) => void): Promise<void> {
    const artifacts = new Map(this.artifacts);
    edit(artifacts);
    await writeJsonFileAtomic(this.indexPath(), { version: 1, artifacts: [...artifacts.values()] });
    this.artifacts = artifacts;
  }

  private announce(change: ArtifactChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operations.then(operation);
    this.operations = run.catch(() => undefined);
    return run;
  }

  private indexPath(): string {
    return join(this.root, "index.json");
  }

  private contentPath(artifact: Pick<Artifact, "id" | "fileName">): string {
    return join(this.root, "files", artifact.id, artifact.fileName);
  }
}

/** The entry after this registration: same id and first sighting, next revision. */
function nextArtifact(
  input: ArtifactRegisterInput,
  previous: Artifact | null,
  fileName: string,
  timestamp: string,
): Artifact {
  return {
    id: previous?.id ?? `art_${randomBytes(8).toString("hex")}`,
    workspaceId: input.workspaceId,
    kind: input.kind,
    title: input.title.trim().slice(0, TITLE_MAX_LENGTH),
    fileName,
    media: artifactMediaFor(fileName),
    ...artifactSource(input, previous),
    goalId: input.goalId ?? previous?.goalId ?? null,
    taskIds: input.taskIds.length > 0 ? input.taskIds : (previous?.taskIds ?? []),
    revision: (previous?.revision ?? 0) + 1,
    size: input.content.byteLength,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function artifactSource(
  input: ArtifactRegisterInput,
  previous: Artifact | null,
): Pick<Artifact, "sourcePath" | "sourceAgentId" | "sourceMessageId"> {
  return {
    // Inline updates keep the path so registering the file still matches this entry.
    sourcePath: input.sourcePath ?? previous?.sourcePath ?? null,
    sourceAgentId: input.sourceAgentId ?? previous?.sourceAgentId ?? null,
    sourceMessageId: input.sourceMessageId ?? previous?.sourceMessageId ?? null,
  };
}

function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base || base === "." || base === "..") {
    throw new ArtifactError("artifact_invalid", "Artifact file name is required");
  }
  return base.slice(0, 200);
}
