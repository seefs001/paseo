import type { Agent } from "@/stores/session-store";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

export type ClientSlashCommandKind =
  | "archive-agent"
  | "replace-agent-with-draft"
  | "create-board-task";
export type ClientSlashCommandExecution = "immediate" | "insert";

export interface ClientSlashCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  descriptionKey:
    | "composer.clientCommands.archiveAgent"
    | "composer.clientCommands.freshDraft"
    | "board.capture.slashCommand";
  argumentHint: string;
  kind: ClientSlashCommandKind;
  execution: ClientSlashCommandExecution;
  /** Whether text after the command name is its argument instead of making it a prompt. */
  takesArgument?: boolean;
}

export const CLIENT_SLASH_COMMANDS: readonly ClientSlashCommand[] = [
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Archive the current agent",
    descriptionKey: "composer.clientCommands.archiveAgent",
    argumentHint: "",
    kind: "archive-agent",
    execution: "immediate",
  },
  {
    name: "clear",
    aliases: ["new"],
    description: "Archive this agent and start a fresh draft",
    descriptionKey: "composer.clientCommands.freshDraft",
    argumentHint: "",
    kind: "replace-agent-with-draft",
    execution: "immediate",
  },
  {
    name: "task",
    aliases: [],
    description: "Add a task to the Board",
    descriptionKey: "board.capture.slashCommand",
    argumentHint: "[title]",
    kind: "create-board-task",
    // Picking it from autocomplete leaves room to type the title.
    execution: "insert",
    takesArgument: true,
  },
];

/** The built-in commands this host can run. */
export function listClientSlashCommands(input: {
  boardTasks: boolean;
}): readonly ClientSlashCommand[] {
  return input.boardTasks
    ? CLIENT_SLASH_COMMANDS
    : CLIENT_SLASH_COMMANDS.filter((command) => command.kind !== "create-board-task");
}

const COMMAND_BY_NAME = new Map<string, ClientSlashCommand>();
for (const command of CLIENT_SLASH_COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases) {
    COMMAND_BY_NAME.set(alias, command);
  }
}

export function resolveClientSlashCommand(input: {
  text: string;
  hasAttachments: boolean;
  boardTasks?: boolean;
}): ClientSlashCommand | null {
  if (input.hasAttachments) {
    return null;
  }

  const match = /^\/(\S+)(\s[\s\S]*)?$/.exec(input.text.trim());
  if (!match) {
    return null;
  }

  const command = COMMAND_BY_NAME.get(match[1]) ?? null;
  if (!command || (match[2] && !command.takesArgument)) {
    return null;
  }
  if (command.kind === "create-board-task" && !input.boardTasks) {
    return null;
  }
  return command;
}

export function readClientSlashCommandArgument(text: string): string {
  return /^\/\S+\s*([\s\S]*)$/.exec(text.trim())?.[1]?.trim() ?? "";
}

export function buildDraftAgentSetup(agent: Agent): WorkspaceDraftTabSetup {
  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    providerOptions: { ...agent.options },
  };
}
