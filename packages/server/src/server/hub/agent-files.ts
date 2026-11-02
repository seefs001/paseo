import { readFile } from "node:fs/promises";
import type { HubAgentFileReadResponse } from "@getpaseo/protocol/messages";

import { getDownloadableFileInfo } from "../file-explorer/service.js";

type HubAgentFile = NonNullable<HubAgentFileReadResponse["payload"]["file"]>;

/** Reads one file inside an agent's working directory for Hub to attach to a provider reply. */
export async function readHubAgentFile(input: {
  cwd: string;
  path: string;
  maxBytes: number;
}): Promise<HubAgentFile> {
  const info = await getDownloadableFileInfo({ root: input.cwd, relativePath: input.path });
  if (info.size > input.maxBytes) throw fileTooLarge(info.path, input.maxBytes);
  const bytes = await readFile(info.absolutePath);
  // The file can grow between stat and read.
  if (bytes.byteLength > input.maxBytes) throw fileTooLarge(info.path, input.maxBytes);
  return {
    path: info.path,
    fileName: info.fileName,
    mimeType: info.mimeType,
    size: bytes.byteLength,
    contentBase64: bytes.toString("base64"),
  };
}

function fileTooLarge(path: string, maxBytes: number): Error {
  return new Error(`File ${path} is larger than ${String(maxBytes)} bytes`);
}
