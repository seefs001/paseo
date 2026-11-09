import { createServer, type Server } from "node:http";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";

// Private channel between the daemon and the Pi processes it starts for SSH workspaces.
// It listens on an owner-only Unix socket; every request carries the workspace token from
// its binding file. It never accepts a host, command target or credentials from the caller.

export interface SshBridgeRequestContext {
  signal: AbortSignal;
  // Streams one NDJSON line before the final result.
  send(line: Record<string, unknown>): void;
}

export type SshBridgeHandler = (
  route: string,
  body: Record<string, unknown>,
  context: SshBridgeRequestContext,
) => Promise<Record<string, unknown>>;

const MAX_BODY_BYTES = 64 * 1024 * 1024;

export class SshBridgeServer {
  private server: Server | null = null;

  constructor(
    readonly socketPath: string,
    private readonly handler: SshBridgeHandler,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await rm(this.socketPath, { force: true });
    const server = createServer((req, res) => {
      const controller = new AbortController();
      // The client closing early is the Pi tool being aborted.
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const send = (line: Record<string, unknown>) => {
          if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
        };
        this.handler(req.url ?? "/", body, { signal: controller.signal, send })
          .then((result) => {
            if (!res.writableEnded) res.end(`${JSON.stringify({ type: "result", ...result })}\n`);
            return undefined;
          })
          .catch((error: unknown) => {
            this.logger.warn({ err: error, route: req.url }, "ssh bridge request failed");
            if (!res.writableEnded) {
              res.end(
                `${JSON.stringify({
                  type: "result",
                  error: error instanceof Error ? error.message : String(error),
                })}\n`,
              );
            }
          });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.socketPath, () => resolve());
    });
    await chmod(this.socketPath, 0o600);
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(this.socketPath, { force: true });
  }
}
