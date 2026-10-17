import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import type { PiRuntimeSession } from "./runtime.js";

const execFileAsync = promisify(execFile);
const exportResultSchema = z.object({ path: z.string().min(1) });

export interface PiShareGhInput {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
}

export type PiShareGh = (input: PiShareGhInput) => Promise<string>;

class PiShareError extends Error {
  constructor(
    readonly stage: "export" | "upload" | "response",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PiShareError";
  }
}

async function runGh(input: PiShareGhInput): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", input.args, {
      cwd: input.cwd,
      env: input.env,
      signal: input.signal,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new PiShareError("upload", "GitHub CLI (gh) is not installed on the host.", {
        cause: error,
      });
    }
    throw error;
  }
}

export async function sharePiSession(input: {
  runtimeSession: Pick<PiRuntimeSession, "request" | "environment">;
  cwd: string;
  signal: AbortSignal;
  runGh?: PiShareGh;
}): Promise<{ viewerUrl: string; gistUrl: string }> {
  input.signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "paseo-pi-share-"));
  try {
    const outputPath = join(directory, "session.html");
    try {
      const result = await input.runtimeSession.request({ type: "export_html", outputPath });
      const exported = exportResultSchema.parse(result);
      if (exported.path !== outputPath) {
        throw new PiShareError("export", "Pi returned an unexpected HTML export path.");
      }
    } catch (error) {
      throw new PiShareError("export", `HTML export failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    input.signal.throwIfAborted();
    const env: Record<string, string> = {
      ...input.runtimeSession.environment,
      GH_PROMPT_DISABLED: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    let stdout: string;
    try {
      stdout = await (input.runGh ?? runGh)({
        args: ["gist", "create", "--public=false", outputPath],
        cwd: input.cwd,
        env,
        signal: input.signal,
      });
    } catch (error) {
      throw new PiShareError(
        "upload",
        `Gist upload failed: ${errorMessage(error)}. Check 'gh auth status' on the host; if the upload timed out, check 'gh gist list' before retrying.`,
        { cause: error },
      );
    }
    const gistUrl = stdout.trim();
    const match = /^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?([a-f\d]+)\/?$/i.exec(gistUrl);
    if (!match) {
      throw new PiShareError("response", "GitHub CLI did not return a valid gist URL.");
    }
    const viewerBase = env.PI_SHARE_VIEWER_URL || "https://pi.dev/session/";
    return { viewerUrl: `${viewerBase}#${match[1]}`, gistUrl };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
