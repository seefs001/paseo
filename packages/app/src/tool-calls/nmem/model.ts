import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

export interface NmemCall {
  command: string;
  summary: string;
}

const calls = new WeakMap<ToolCallDetail, NmemCall | null>();
// Keep quoted arguments intact: mentioning nmem in an echo or a search is not a call.
const SHELL_TOKENS = /(?:[^\s'"\\;&|()<>]|\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*')+|[;&|()<>\n]+/g;
const COMMAND_BOUNDARY = /^[;&|()\n]+$/;

function unquote(word: string): string {
  return word.replace(
    /"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'|\\([\s\S])/g,
    (_match, double, single, escaped) => {
      if (typeof single === "string") return single;
      if (typeof double === "string") return double.replace(/\\(["\\$`])/g, "$1");
      return escaped;
    },
  );
}

function nmemSummaries(command: string): string[] {
  const tokens = command.match(SHELL_TOKENS) ?? [];
  const summaries: string[] = [];
  let atCommand = true;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (COMMAND_BOUNDARY.test(token)) {
      atCommand = true;
      continue;
    }
    if (!atCommand) continue;
    const word = unquote(token);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === "env") continue;
    atCommand = false;
    if (!/(?:^|[/\\])nmem(?:\.exe)?$/.test(word)) continue;
    const args: string[] = [];
    for (let next = index + 1; next < tokens.length; next += 1) {
      if (/^[;&|()<>\n]+$/.test(tokens[next])) break;
      args.push(unquote(tokens[next]));
    }
    summaries.push(args.join(" "));
  }
  return summaries;
}

export function getNmemCall(detail: ToolCallDetail | undefined): NmemCall | null {
  if (detail?.type !== "shell") return null;
  if (calls.has(detail)) return calls.get(detail) ?? null;
  const summaries = detail.command.includes("nmem") ? nmemSummaries(detail.command) : [];
  const call =
    summaries.length > 0 ? { command: detail.command, summary: summaries.join(" · ") } : null;
  calls.set(detail, call);
  return call;
}

export function formatNmemOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    return output;
  }
}
