import type { CustomCommand } from "./model";
import type { SlashCommandRange } from "@/utils/agent-command-autocomplete";

export interface ExpandedCustomCommand {
  command: CustomCommand;
  text: string;
}

/** Explicit send/queue expands only the leading command, leaving extra text intact. */
export function expandCustomCommand(input: {
  text: string;
  commands: readonly CustomCommand[];
}): ExpandedCustomCommand | null {
  const match = /^(\s*)\/([^\s]+)/.exec(input.text);
  if (!match) return null;
  const command = input.commands.find((candidate) => candidate.name === match[2]);
  if (!command) return null;
  return {
    command,
    text: `${match[1]}${command.prompt}${input.text.slice(match[0].length)}`,
  };
}

export function expandSelectedCustomCommand(input: {
  text: string;
  range: SlashCommandRange;
  command: CustomCommand;
}): string {
  // The caret can be inside a command token, not only at its end.
  const remainingToken = /^\S*/.exec(input.text.slice(input.range.end))?.[0] ?? "";
  const end = input.range.end + remainingToken.length;
  return `${input.text.slice(0, input.range.start)}${input.command.prompt}${input.text.slice(end)}`;
}
