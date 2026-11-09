import { useSkillAutocomplete } from "@/skills/use-skill-autocomplete";
import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption, AutocompleteStatus } from "@/components/ui/autocomplete";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import {
  useAutocompleteCommands,
  type AgentSlashCommand,
  type DraftCommandConfig,
  type DraftCommandTarget,
} from "@/agent-commands";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import {
  useProfileReferenceAutocomplete,
  type ProfileReferenceSelection,
} from "@/composer/profile-reference/use-autocomplete";
import {
  useRoleReferenceAutocomplete,
  type RoleReferenceSelection,
} from "@/composer/profile-reference/use-role-autocomplete";
import {
  sessionReferenceLabel,
  type ProfileReferenceRange,
  type SessionReferenceSource,
} from "@/composer/profile-reference/model";
import {
  rankSessionMentionCandidates,
  mentionOptionGroups,
  resolveComposerMention,
  type ComposerMentionKind,
  type SessionMentionCandidate,
} from "@/utils/session-mention-autocomplete";
import { listClientSlashCommands, type ClientSlashCommand } from "@/client-slash-commands";
import type { CustomCommand } from "@/custom-commands/model";
import { expandSelectedCustomCommand, type ExpandedCustomCommand } from "@/custom-commands/expand";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { pluginDisplayName, usePluginList } from "@/plugins/plugin-list";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import type { PluginClientSlashCommand } from "@/plugins/client-slash-commands";
import { mergeSlashCommandSources } from "@/plugins/client-slash-commands/model";
import {
  applySlashCommandReplacement,
  filterAndRankCommandAutocompleteEntries,
  filterInlineSkillCommandEntries,
  findActiveSlashCommand,
  type SlashCommandRange,
} from "@/utils/agent-command-autocomplete";
import {
  applyFileMentionReplacement,
  findActiveFileMention,
  type FileMentionRange,
} from "@/utils/file-mention-autocomplete";

export interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  setUserInput: (nextValue: string) => void;
  serverId: string;
  agentId: string;
  workspaceId?: string | null;
  draft?: DraftCommandTarget;
  onAutocompleteApplied?: () => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  /** Enables `@` agent session references; the composer owns the draft update. */
  onSessionReferenceSelected?: (selection: SessionReferenceSelection) => void;
  /** Enables `#` agent profile references; the composer owns the draft update. */
  onProfileReferenceSelected?: (selection: ProfileReferenceSelection) => void;
  /** Enables `%` agent role references; the composer owns the draft update. */
  onRoleReferenceSelected?: (selection: RoleReferenceSelection) => void;
  /** Bound reference intervals; `#`, `%` or `@` inside one does not reopen the picker. */
  boundReferenceRanges?: readonly ProfileReferenceRange[];
  canExecuteClientSlashCommand?: boolean;
  pluginClientSlashCommands?: readonly PluginClientSlashCommand[];
  customCommands: readonly CustomCommand[];
  onCustomCommandSelected: (selection: ExpandedCustomCommand) => void;
}

export interface AgentAutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: AgentAutocompleteInputSnapshot;
}

export interface SessionReferenceSelection {
  /** The live text the mention range indexes into. */
  text: string;
  mention: FileMentionRange;
  session: SessionReferenceSource;
}

export interface AgentAutocompleteInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "client_command"; command: ClientSlashCommand })
  | (AutocompleteOption & { type: "custom_command"; command: CustomCommand })
  | (AutocompleteOption & {
      type: "plugin_command";
      command: PluginClientSlashCommand;
    })
  | (AutocompleteOption & { type: "provider_command" })
  | (AutocompleteOption & {
      type: "workspace_entry";
      entryPath: string;
      mention: FileMentionRange;
    })
  | (AutocompleteOption & {
      type: "agent_session";
      mention: FileMentionRange;
      candidate: SessionMentionCandidate;
    });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  /** Shown in place of options; set exactly when `options` is empty. */
  status: AutocompleteStatus | null;
  onSelectOption: (option: AutocompleteOption, input?: AgentAutocompleteInputSnapshot) => void;
  onKeyPress: (event: AgentAutocompleteKeyPressEvent) => boolean;
}

interface AgentAutocompleteSnapshot {
  text: string;
  slashCommand: SlashCommandRange | null;
  fileMention: FileMentionRange | null;
}

interface ApplyAgentAutocompleteSelectionInput {
  option: AutocompleteOption;
  snapshot?: AgentAutocompleteInputSnapshot;
  userInput: string;
  cursorIndex: number;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  canExecuteClientSlashCommand?: boolean;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  setUserInput: (nextValue: string) => void;
  onAutocompleteApplied?: () => void;
  onSessionReferenceSelected?: UseAgentAutocompleteInput["onSessionReferenceSelected"];
  onCustomCommandSelected: UseAgentAutocompleteInput["onCustomCommandSelected"];
}

function applyAgentAutocompleteSelection(input: ApplyAgentAutocompleteSelectionInput): void {
  const selected = input.option as AgentAutocompleteOption;
  const current = resolveAgentAutocompleteSnapshot({
    input: input.snapshot,
    userInput: input.userInput,
    cursorIndex: input.cursorIndex,
    activeSlashCommand: input.activeSlashCommand,
    activeFileMention: input.activeFileMention,
  });
  const selectedIsCommand =
    selected.type === "client_command" ||
    selected.type === "custom_command" ||
    selected.type === "plugin_command" ||
    selected.type === "provider_command";
  if (input.snapshot && selectedIsCommand && !current.slashCommand) return;
  if (selected.type === "custom_command" && current.slashCommand) {
    const text = expandSelectedCustomCommand({
      text: current.text,
      range: current.slashCommand,
      command: selected.command,
    });
    input.onCustomCommandSelected({ command: selected.command, text });
    return;
  }
  if (
    selected.type === "client_command" &&
    selected.command.execution === "immediate" &&
    input.canExecuteClientSlashCommand &&
    input.onClientSlashCommand
  ) {
    input.onClientSlashCommand(selected.command);
    return;
  }

  if (selectedIsCommand) {
    applySelectedCommand({
      selectedId: selected.id,
      slashCommand: current.slashCommand,
      text: current.text,
      setUserInput: input.setUserInput,
      onAutocompleteApplied: input.onAutocompleteApplied,
    });
    return;
  }

  if (
    applySelectedSessionReference({
      selected,
      text: current.text,
      mention: current.fileMention,
      onSessionReferenceSelected: input.onSessionReferenceSelected,
      onAutocompleteApplied: input.onAutocompleteApplied,
    })
  ) {
    return;
  }

  if (selected.type !== "workspace_entry" || !current.fileMention) return;
  const nextInput = applyFileMentionReplacement({
    text: current.text,
    mention: current.fileMention,
    relativePath: selected.entryPath,
  });
  input.setUserInput(nextInput);
  input.onAutocompleteApplied?.();
}

function applySelectedCommand(input: {
  selectedId: string;
  slashCommand: SlashCommandRange | null;
  text: string;
  setUserInput: (nextValue: string) => void;
  onAutocompleteApplied?: () => void;
}): void {
  if (!input.slashCommand) {
    input.setUserInput(`/${input.selectedId} `);
    input.onAutocompleteApplied?.();
    return;
  }
  input.setUserInput(
    applySlashCommandReplacement({
      text: input.text,
      command: input.slashCommand,
      commandName: input.selectedId,
    }),
  );
  input.onAutocompleteApplied?.();
}

function applySelectedSessionReference(input: {
  selected: AgentAutocompleteOption;
  text: string;
  mention: FileMentionRange | null;
  onSessionReferenceSelected?: UseAgentAutocompleteInput["onSessionReferenceSelected"];
  onAutocompleteApplied?: () => void;
}): boolean {
  if (
    input.selected.type !== "agent_session" ||
    !input.mention ||
    !input.onSessionReferenceSelected
  ) {
    return false;
  }
  const candidate = input.selected.candidate;
  input.onSessionReferenceSelected({
    text: input.text,
    mention: input.mention,
    session: {
      serverId: candidate.serverId,
      agentId: candidate.id,
      title: candidate.title,
      provider: candidate.provider,
      model: candidate.model,
      cwd: candidate.cwd,
      workspaceId: candidate.workspaceId,
    },
  });
  input.onAutocompleteApplied?.();
  return true;
}

function resolveAgentAutocompleteSnapshot(input: {
  input?: AgentAutocompleteInputSnapshot;
  userInput: string;
  cursorIndex: number;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
}): AgentAutocompleteSnapshot {
  if (!input.input) {
    return {
      text: input.userInput,
      slashCommand: input.activeSlashCommand,
      fileMention: input.activeFileMention,
    };
  }

  const text = input.input.text;
  const cursorIndex = input.input.selection.start;
  return {
    text,
    slashCommand: findActiveSlashCommand({ text, cursorIndex }),
    fileMention: findActiveFileMention({ text, cursorIndex }),
  };
}

interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

type AvailableCommand =
  | { source: "client"; command: ClientSlashCommand }
  | { source: "custom"; command: CustomCommand }
  | { source: "plugin"; command: PluginClientSlashCommand }
  | { source: "provider"; command: AgentSlashCommand };

function mentionKindFromMode(mode: AutocompleteMode): ComposerMentionKind | null {
  if (mode === "command" || mode === null) {
    return null;
  }
  return mode;
}

function wantsSessionMentions(mode: AutocompleteMode): boolean {
  const kind = mentionKindFromMode(mode);
  return kind !== null && mentionOptionGroups(kind).sessions;
}

function wantsFileSuggestions(mode: AutocompleteMode): boolean {
  const kind = mentionKindFromMode(mode);
  return kind !== null && mentionOptionGroups(kind).files;
}

function isMentionAutocompleteMode(mode: AutocompleteMode): boolean {
  return mode === "file" || mode === "chat" || mode === "all";
}

// Owner-side file suggestions would list the wrong computer in an SSH workspace, so they
// get no cwd there.
function useLocalFileSuggestionCwd(serverId: string, agentId: string, cwd: string): string {
  const isSshAgent = useSessionStore((state) => {
    const agentWorkspaceId = state.sessions[serverId]?.agents?.get(agentId)?.workspaceId;
    if (!agentWorkspaceId) return false;
    return Boolean(state.sessions[serverId]?.workspaces.get(agentWorkspaceId)?.executionLocation);
  });
  return isSshAgent || cwd.startsWith("ssh://") ? "" : cwd;
}

function resolveFileSuggestionsEnabled(input: {
  mode: AutocompleteMode;
  serverId: string;
  cwd: string;
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
}): boolean {
  return (
    wantsFileSuggestions(input.mode) &&
    Boolean(input.serverId) &&
    input.cwd.length > 0 &&
    Boolean(input.client) &&
    input.isConnected
  );
}

function resolveAutocompleteQuery(
  mode: AutocompleteMode,
  commandFilterQuery: string,
  mentionFilter: string,
): string {
  if (mode === "command") {
    return commandFilterQuery;
  }
  return `${mode ?? ""}:${mentionFilter}`;
}

function resolveCommandStartEscape(
  mode: AutocompleteMode,
  activeSlashCommand: SlashCommandRange | null,
  setUserInput: (nextValue: string) => void,
): (() => void) | undefined {
  if (mode === "command" && activeSlashCommand?.position === "start") {
    return () => setUserInput("");
  }
  return undefined;
}

function resolveAutocompleteCwd(
  isDraftContext: boolean,
  draftCwd: string | undefined,
  agentCwd: string,
): string {
  if (isDraftContext) {
    return draftCwd ?? "";
  }
  return agentCwd.trim();
}

function resolveDraftQueryConfig(draft?: DraftCommandTarget): DraftCommandConfig | undefined {
  if (draft?.status !== "ready") {
    return undefined;
  }

  const draftConfig = draft.config;
  const cwd = draftConfig.cwd.trim();
  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const providerOptions = draftConfig.providerOptions;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}

async function fetchDirectorySuggestionEntries(input: {
  client: ReturnType<typeof useHostRuntimeClient>;
  cwd: string;
  query: string;
  unavailableMessage: string;
}): Promise<DirectorySuggestionEntry[]> {
  if (!input.client) {
    throw new Error(input.unavailableMessage);
  }
  const response = await input.client.getDirectorySuggestions({
    cwd: input.cwd,
    query: input.query,
    limit: 50,
    includeFiles: true,
    includeDirectories: true,
  });
  if (response.error) {
    throw new Error(response.error);
  }
  return mapDirectorySuggestionsToEntries(response);
}

function mapDirectorySuggestionsToEntries(payload: {
  entries?: Array<{ path: string; kind: string }>;
  directories?: string[];
}): DirectorySuggestionEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.kind !== "file" && entry.kind !== "directory")
      ) {
        return [];
      }
      return [{ path: entry.path, kind: entry.kind }];
    });
  }

  return (payload.directories ?? []).map((path) => ({
    path,
    kind: "directory" as const,
  }));
}

const CLIENT_COMMAND_ICONS = {
  "archive-agent": "archive",
  "replace-agent-with-draft": "new-draft",
  "create-board-task": "command",
} as const satisfies Record<ClientSlashCommand["kind"], AutocompleteOption["icon"]>;

interface CommandOptionContext {
  query: string;
  pluginNames: ReadonlyMap<string, string>;
  t: TFunction;
}

function mapCommandToOption(
  entry: AvailableCommand,
  context: CommandOptionContext,
): AgentAutocompleteOption {
  if (entry.source === "custom") {
    return {
      id: entry.command.name,
      label: `/${entry.command.name}`,
      description: entry.command.description,
      kind: "command",
      icon: "command",
      type: "custom_command",
      command: entry.command,
    };
  }
  const command = entry.command;
  const base = {
    id: command.name,
    label: `/${command.name}`,
    // The label carries a leading slash the query does not.
    labelMatches: findHighlightRanges(context.query, command.name).map((range) => ({
      start: range.start + 1,
      length: range.length,
    })),
    argumentHint: command.argumentHint || undefined,
  };
  if (entry.source === "client") {
    return {
      ...base,
      type: "client_command",
      command: entry.command,
      icon: CLIENT_COMMAND_ICONS[entry.command.kind],
      description: context.t(entry.command.descriptionKey),
      tag: "Paseo",
    };
  }
  if (entry.source === "plugin") {
    return {
      ...base,
      type: "plugin_command",
      command: entry.command,
      icon: "plugin",
      description: entry.command.description,
      tag: context.pluginNames.get(entry.command.pluginId) ?? entry.command.pluginId,
    };
  }
  const isSkill = entry.command.kind === "skill";
  return {
    ...base,
    type: "provider_command",
    icon: isSkill ? "skill" : "command",
    description: entry.command.description,
    tag: isSkill ? context.t("agentAutocomplete.skillTag") : undefined,
  };
}

type AutocompleteMode = "command" | ComposerMentionKind | null;

interface BuildAutocompleteOptionsInput {
  mode: AutocompleteMode;
  commands: AgentSlashCommand[];
  clientCommands: readonly ClientSlashCommand[];
  pluginCommands: readonly PluginClientSlashCommand[];
  customCommands: readonly CustomCommand[];
  pluginNames: ReadonlyMap<string, string>;
  isDraftContext: boolean;
  commandFilterQuery: string;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  fileSuggestions: DirectorySuggestionEntry[];
  sessionCandidates: SessionMentionCandidate[];
  t: TFunction;
}

function buildAutocompleteOptions(input: BuildAutocompleteOptionsInput): AgentAutocompleteOption[] {
  if (input.mode === "command") {
    const providerCommands = input.commands.map((command) => ({
      source: "provider" as const,
      command,
    }));
    const rootCommands: AvailableCommand[] = mergeSlashCommandSources({
      builtIn: input.clientCommands,
      custom: input.customCommands,
      plugins: input.pluginCommands,
      provider: input.commands,
      onPluginCollision(command, winner) {
        console.warn(
          `[Plugins] Client slash command /${command.name} from ${command.pluginId} ignored; ${winner} command wins`,
        );
      },
    })
      .filter((entry) => !input.isDraftContext || entry.source !== "built-in")
      .map((entry): AvailableCommand => {
        if (entry.source === "built-in") return { source: "client", command: entry.command };
        return entry;
      });
    const availableCommands: AvailableCommand[] =
      input.activeSlashCommand?.position === "inline"
        ? filterInlineSkillCommandEntries(providerCommands)
        : rootCommands;
    const matches = filterAndRankCommandAutocompleteEntries(
      availableCommands,
      input.commandFilterQuery,
    );
    const context = {
      query: input.commandFilterQuery,
      pluginNames: input.pluginNames,
      t: input.t,
    };
    return orderAutocompleteOptions(matches).map((entry) => mapCommandToOption(entry, context));
  }

  const activeFileMention = input.activeFileMention;
  if (isMentionAutocompleteMode(input.mode) && activeFileMention) {
    return buildMentionAutocompleteOptions(input, activeFileMention);
  }

  return [];
}

function buildMentionAutocompleteOptions(
  input: BuildAutocompleteOptionsInput,
  mention: FileMentionRange,
): AgentAutocompleteOption[] {
  const sessionOptions = wantsSessionMentions(input.mode)
    ? input.sessionCandidates.map((entry) => mapSessionCandidateToOption(entry, mention))
    : [];
  const fileOptions = wantsFileSuggestions(input.mode)
    ? input.fileSuggestions.map((entry) => mapWorkspaceEntryToOption(entry, mention))
    : [];
  return orderAutocompleteOptions([...sessionOptions, ...fileOptions]);
}

function mapWorkspaceEntryToOption(
  entry: DirectorySuggestionEntry,
  mention: FileMentionRange,
): AgentAutocompleteOption {
  return {
    type: "workspace_entry",
    id: `${entry.kind}:${entry.path}`,
    label: entry.path,
    kind: entry.kind,
    icon: entry.kind,
    entryPath: entry.path,
    mention,
  };
}

function mentionProviderModelDetail(provider: string, model: string | null | undefined): string {
  const trimmedModel = model?.trim();
  if (trimmedModel) {
    return `${provider} · ${trimmedModel}`;
  }
  return provider;
}

function mapSessionCandidateToOption(
  candidate: SessionMentionCandidate,
  mention: FileMentionRange,
): AgentAutocompleteOption {
  const shortId = candidate.id.slice(0, 7);
  return {
    type: "agent_session",
    id: `${candidate.serverId}:${candidate.id}`,
    label: sessionReferenceLabel({ title: candidate.title ?? "", agentId: candidate.id }),
    detail: mentionProviderModelDetail(candidate.provider, candidate.model),
    description: shortId,
    kind: "agent",
    icon: "agent",
    mention,
    candidate,
  };
}

function collectOpenAgentTabIdsForServer(
  layoutByWorkspace: Record<string, WorkspaceLayout>,
  serverId: string,
): Set<string> {
  const prefix = `${serverId}:`;
  const ids = new Set<string>();
  for (const [workspaceKey, layout] of Object.entries(layoutByWorkspace)) {
    if (!workspaceKey.startsWith(prefix)) {
      continue;
    }
    for (const tab of collectAllTabs(layout.root)) {
      if (tab.target.kind === "agent") {
        ids.add(tab.target.agentId);
      }
    }
  }
  return ids;
}

function collectRankedSessionMentions(input: {
  mode: AutocompleteMode;
  agentsById: Map<string, Agent> | undefined;
  layoutByWorkspace: Record<string, WorkspaceLayout>;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  query: string;
}): SessionMentionCandidate[] {
  if (!wantsSessionMentions(input.mode) || !input.agentsById) {
    return [];
  }
  const openTabIds = collectOpenAgentTabIdsForServer(input.layoutByWorkspace, input.serverId);
  const candidates: SessionMentionCandidate[] = [];
  for (const agent of input.agentsById.values()) {
    const candidate = mapAgentToSessionMentionCandidate(agent, openTabIds);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return rankSessionMentionCandidates({
    agents: candidates,
    currentAgentId: input.agentId,
    currentWorkspaceId: input.workspaceId,
    query: input.query,
  });
}

function mapAgentToSessionMentionCandidate(
  agent: Agent,
  openTabIds: Set<string>,
): SessionMentionCandidate | null {
  if (agent.archivedAt) {
    return null;
  }
  return {
    id: agent.id,
    serverId: agent.serverId,
    title: agent.title,
    provider: agent.provider,
    model: agent.model,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId ?? null,
    parentAgentId: agent.parentAgentId,
    activityAt: (agent.lastUserMessageAt ?? agent.lastActivityAt ?? agent.updatedAt).getTime(),
    isOpenTab: openTabIds.has(agent.id),
  };
}

function resolveAutocompleteMode(args: {
  mentionKind: ComposerMentionKind | null;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.mentionKind) {
    return args.mentionKind;
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  customCommandCount: number;
  serverId: string;
  fileSuggestionCwd: string;
}): boolean {
  if (args.mode === "command") {
    if (args.customCommandCount > 0) return true;
    return args.canLoadCommands;
  }
  if (args.mode === "file") {
    return Boolean(args.serverId) && args.fileSuggestionCwd.length > 0;
  }
  if (isMentionAutocompleteMode(args.mode)) {
    return Boolean(args.serverId);
  }
  return false;
}

function resolveCanLoadCommands(args: {
  serverId: string;
  agentId: string;
  isDraftContext: boolean;
}): boolean {
  if (!args.serverId) {
    return false;
  }
  return Boolean(args.agentId) || args.isDraftContext;
}

type CommandsState = "ready" | "loading" | "error";

function resolveCommandsState(input: {
  canListCommands: boolean;
  isLoading: boolean;
  isError: boolean;
}): CommandsState {
  if (!input.canListCommands) return "ready";
  if (input.isError) return "error";
  if (input.isLoading) return "loading";
  return "ready";
}

interface AutocompleteMenu {
  options: AgentAutocompleteOption[];
  status: AutocompleteStatus | null;
}

/**
 * One state for the open menu, so options and a loading or error row cannot both claim it:
 * while a status row shows there are no options for Enter or Tab to pick.
 */
function resolveCommandMenu(input: {
  commandsState: CommandsState;
  options: () => AgentAutocompleteOption[];
  providerLabel: string | null;
  error: Error | null;
  onRetry: () => void;
  emptyText: string;
  t: TFunction;
}): AutocompleteMenu {
  const { t } = input;
  if (input.commandsState === "loading") {
    const message = input.providerLabel
      ? t("agentAutocomplete.loadingProviderCommands", { provider: input.providerLabel })
      : t("agentAutocomplete.loadingCommands");
    return { options: [], status: { kind: "loading", message } };
  }
  if (input.commandsState === "error") {
    const title = input.providerLabel
      ? t("agentAutocomplete.providerCommandsFailed", { provider: input.providerLabel })
      : t("agentAutocomplete.commandsFailed");
    return {
      options: [],
      status: { kind: "error", title, reason: input.error?.message, onRetry: input.onRetry },
    };
  }
  return withEmptyStatus(input.options(), input.emptyText);
}

function resolveFileMenu(input: {
  options: () => AgentAutocompleteOption[];
  isLoading: boolean;
  error: unknown;
  emptyText: string;
  t: TFunction;
}): AutocompleteMenu {
  const options = input.options();
  if (input.isLoading && options.length === 0) {
    return {
      options: [],
      status: { kind: "loading", message: input.t("agentAutocomplete.searchingWorkspace") },
    };
  }
  if (input.error instanceof Error) {
    return {
      options: [],
      status: {
        kind: "error",
        title: input.t("agentAutocomplete.filesFailed"),
        reason: input.error.message,
      },
    };
  }
  return withEmptyStatus(options, input.emptyText);
}

function withEmptyStatus(options: AgentAutocompleteOption[], emptyText: string): AutocompleteMenu {
  return options.length > 0
    ? { options, status: null }
    : { options, status: { kind: "empty", message: emptyText } };
}

/** How long a command menu waits for commands before it opens on a loading row. */
const COMMANDS_LOADING_REVEAL_MS = 300;

/**
 * Whether the open command menu has waited long enough to show a loading row. Commands that
 * arrive sooner paint the list as the first frame; once the wait is over, loading (a retry)
 * shows at once so the open menu never closes on itself.
 */
function useCommandMenuRevealed(isMenuOpen: boolean, commandsState: CommandsState): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!isMenuOpen) {
      setRevealed(false);
      return undefined;
    }
    const timer = setTimeout(() => setRevealed(true), COMMANDS_LOADING_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [isMenuOpen]);
  return !isMenuOpen || commandsState !== "loading" || revealed;
}

/** The names command rows and status rows show: the provider's label and each plugin's name. */
function useCommandSourceNames(input: {
  serverId: string;
  agentId: string;
  draftConfig: DraftCommandConfig | undefined;
  cwd: string;
  isCommandMenuOpen: boolean;
  commandsState: CommandsState;
  pluginCommandCount: number;
}): { providerLabel: string | null; pluginNames: ReadonlyMap<string, string> } {
  const agentProvider = useSessionStore(
    (state) => state.sessions[input.serverId]?.agents?.get(input.agentId)?.provider,
  );
  const provider = input.draftConfig?.provider ?? agentProvider;
  // Only a loading or error row names the provider; only plugin rows need plugin names.
  const { entries: providerEntries } = useProvidersSnapshot(input.serverId, {
    cwd: input.cwd,
    enabled: input.isCommandMenuOpen && input.commandsState !== "ready",
  });
  const pluginList = usePluginList(input.serverId, {
    enabled: input.isCommandMenuOpen && input.pluginCommandCount > 0,
  });
  const pluginNames = useMemo(
    () => new Map((pluginList.data ?? []).map((plugin) => [plugin.id, pluginDisplayName(plugin)])),
    [pluginList.data],
  );
  return {
    providerLabel: provider ? resolveProviderLabel(provider, providerEntries) : null,
    pluginNames,
  };
}

function resolveAutocompleteEmptyText(args: {
  mode: AutocompleteMode;
  draft: DraftCommandTarget | undefined;
  t: TFunction;
}): string {
  if (args.mode === "file") {
    return args.t("agentAutocomplete.noFiles");
  }
  if (args.mode === "chat") {
    return args.t("agentAutocomplete.noSessions");
  }
  if (args.mode === "all") {
    return args.t("agentAutocomplete.noMentions");
  }
  if (args.draft?.status === "needs-project") {
    return args.t("agentAutocomplete.chooseProjectForCommands");
  }
  if (args.draft?.status === "needs-provider") {
    return args.t("agentAutocomplete.chooseModelForCommands");
  }
  return args.t("agentAutocomplete.noCommands");
}

// A draft's agentId is a draft key the daemon does not know, so a draft lists
// commands by its config only, and not at all until that config is complete.
function resolveDraftCommandContext(draft: DraftCommandTarget | undefined) {
  const queryDraftConfig = resolveDraftQueryConfig(draft);
  const isDraftContext = draft !== undefined;
  return {
    isDraftContext,
    queryDraftConfig,
    canListCommands: !isDraftContext || queryDraftConfig !== undefined,
  };
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const skills = useSkillAutocomplete(input);
  const profileReferences = useProfileReferenceAutocomplete(input);
  const roleReferences = useRoleReferenceAutocomplete(input);
  const { t } = useTranslation();
  const {
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    workspaceId,
    draft,
    onAutocompleteApplied,
    onClientSlashCommand,
    onSessionReferenceSelected,
    canExecuteClientSlashCommand,
    pluginClientSlashCommands = [],
    customCommands,
    onCustomCommandSelected,
  } = input;

  const activeSlashCommand = useMemo(
    () =>
      findActiveSlashCommand({
        text: userInput,
        cursorIndex,
      }),
    [cursorIndex, userInput],
  );
  const showCommandAutocomplete = activeSlashCommand !== null;
  const commandFilterQuery = activeSlashCommand?.query ?? "";

  const boundReferenceRanges = input.boundReferenceRanges;
  const activeFileMention = useMemo(() => {
    const mention = findActiveFileMention({
      text: userInput,
      cursorIndex,
    });
    if (!mention || !boundReferenceRanges) return mention;
    const insideReference = boundReferenceRanges.some(
      (range) => mention.start >= range.start && mention.start < range.end,
    );
    return insideReference ? null : mention;
  }, [boundReferenceRanges, cursorIndex, userInput]);
  const mention = resolveComposerMention({
    mentionQuery: activeFileMention === null ? null : activeFileMention.query,
    canAttachSessionMention: Boolean(onSessionReferenceSelected),
  });
  const mentionFilter = mention?.filter ?? "";
  const [debouncedFileFilterQuery, setDebouncedFileFilterQuery] = useState(mentionFilter);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileFilterQuery(mentionFilter), 180);
    return () => clearTimeout(timer);
  }, [mentionFilter]);

  const { isDraftContext, queryDraftConfig, canListCommands } = useMemo(
    () => resolveDraftCommandContext(draft),
    [draft],
  );
  const canLoadCommands = resolveCanLoadCommands({ serverId, agentId, isDraftContext });

  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);
  const agentCwd = agentsById?.get(agentId)?.cwd ?? "";
  const autocompleteCwd = useMemo(
    () => resolveAutocompleteCwd(isDraftContext, queryDraftConfig?.cwd, agentCwd),
    [agentCwd, isDraftContext, queryDraftConfig],
  );
  const fileSuggestionCwd = useLocalFileSuggestionCwd(serverId, agentId, autocompleteCwd);

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsBoardTasks = useHostFeature(serverId, "boardTasks");
  const clientCommands = useMemo(
    () => listClientSlashCommands({ boardTasks: supportsBoardTasks }),
    [supportsBoardTasks],
  );

  const mode = resolveAutocompleteMode({
    mentionKind: mention?.kind ?? null,
    showCommandAutocomplete,
  });
  const commandsQuery = useAutocompleteCommands({
    serverId,
    agentId,
    enabled: mode === "command" && canLoadCommands && canListCommands,
    draftConfig: queryDraftConfig,
  });
  const canShowAutocomplete = resolveAutocompleteIsVisible({
    mode,
    canLoadCommands,
    customCommandCount: customCommands.length,
    serverId,
    fileSuggestionCwd,
  });
  const commandsState = resolveCommandsState({
    canListCommands,
    isLoading: commandsQuery.isLoading,
    isError: commandsQuery.isError,
  });
  const isCommandMenuOpen = mode === "command" && canShowAutocomplete;
  const isCommandMenuRevealed = useCommandMenuRevealed(isCommandMenuOpen, commandsState);
  const isVisible = canShowAutocomplete && isCommandMenuRevealed;
  const { providerLabel, pluginNames } = useCommandSourceNames({
    serverId,
    agentId,
    draftConfig: queryDraftConfig,
    cwd: autocompleteCwd,
    isCommandMenuOpen,
    commandsState,
    pluginCommandCount: pluginClientSlashCommands.length,
  });

  const sessionCandidates = useMemo(
    () =>
      collectRankedSessionMentions({
        mode,
        agentsById,
        layoutByWorkspace,
        serverId,
        agentId,
        workspaceId: workspaceId ?? null,
        query: mentionFilter,
      }),
    [agentId, agentsById, mentionFilter, layoutByWorkspace, mode, serverId, workspaceId],
  );

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "directorySuggestions",
      serverId,
      fileSuggestionCwd,
      debouncedFileFilterQuery,
      true,
      true,
    ],
    queryFn: () =>
      fetchDirectorySuggestionEntries({
        client,
        cwd: fileSuggestionCwd,
        query: debouncedFileFilterQuery,
        unavailableMessage: t("common.errors.daemonClientUnavailable"),
      }),
    enabled: resolveFileSuggestionsEnabled({
      mode,
      serverId,
      cwd: fileSuggestionCwd,
      client,
      isConnected,
    }),
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const commandsEmptyText = resolveAutocompleteEmptyText({ mode, draft, t });
  const retryCommandsQuery = commandsQuery.retry;
  const retryCommands = useCallback(() => {
    retryCommandsQuery();
    // Pressing Retry takes focus on web; hand it back so the user keeps typing the command.
    onAutocompleteApplied?.();
  }, [onAutocompleteApplied, retryCommandsQuery]);
  const { options, status } = useMemo<AutocompleteMenu>(() => {
    if (!isVisible) return { options: [], status: null };
    const buildOptions = () =>
      buildAutocompleteOptions({
        activeFileMention,
        commandFilterQuery,
        commands: commandsQuery.commands,
        clientCommands,
        pluginCommands: pluginClientSlashCommands,
        customCommands,
        pluginNames,
        activeSlashCommand,
        fileSuggestions: fileSuggestionCwd ? (fileSuggestionsQuery.data ?? []) : [],
        sessionCandidates,
        isDraftContext,
        mode,
        t,
      });
    if (mode === "chat" || (mode === "all" && !fileSuggestionCwd)) {
      return withEmptyStatus(buildOptions(), commandsEmptyText);
    }
    if (wantsFileSuggestions(mode)) {
      const mentionOptions = buildOptions();
      if (mode === "all" && mentionOptions.length > 0) {
        return { options: mentionOptions, status: null };
      }
      return resolveFileMenu({
        options: () => mentionOptions,
        emptyText: commandsEmptyText,
        isLoading: fileSuggestionsQuery.isLoading,
        error: fileSuggestionsQuery.error,
        t,
      });
    }
    return resolveCommandMenu({
      commandsState,
      options: buildOptions,
      providerLabel,
      error: commandsQuery.error,
      onRetry: retryCommands,
      emptyText: commandsEmptyText,
      t,
    });
  }, [
    activeFileMention,
    activeSlashCommand,
    commandFilterQuery,
    clientCommands,
    customCommands,
    sessionCandidates,
    commandsEmptyText,
    commandsQuery.commands,
    commandsQuery.error,
    commandsState,
    fileSuggestionCwd,
    fileSuggestionsQuery.data,
    fileSuggestionsQuery.error,
    fileSuggestionsQuery.isLoading,
    isDraftContext,
    isVisible,
    mode,
    pluginClientSlashCommands,
    pluginNames,
    providerLabel,
    retryCommands,
    t,
  ]);

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      applyAgentAutocompleteSelection({
        option,
        snapshot,
        userInput,
        cursorIndex,
        activeSlashCommand,
        activeFileMention,
        canExecuteClientSlashCommand,
        onClientSlashCommand,
        onCustomCommandSelected,
        setUserInput,
        onAutocompleteApplied,
        onSessionReferenceSelected,
      });
    },
    [
      canExecuteClientSlashCommand,
      onAutocompleteApplied,
      onClientSlashCommand,
      onCustomCommandSelected,
      onSessionReferenceSelected,
      setUserInput,
      userInput,
      cursorIndex,
      activeFileMention,
      activeSlashCommand,
    ],
  );

  const selectOptionFromKeyPress = useCallback(
    (option: AutocompleteOption, event?: AgentAutocompleteKeyPressEvent) =>
      onSelectOption(option, event?.input),
    [onSelectOption],
  );

  const { selectedIndex, onKeyPress } = useAutocomplete({
    isVisible,
    options,
    query: resolveAutocompleteQuery(mode, commandFilterQuery, mentionFilter),
    onSelectOption: selectOptionFromKeyPress,
    onEscape: resolveCommandStartEscape(mode, activeSlashCommand, setUserInput),
  });

  if (skills.isActive) return skills;
  if (profileReferences.isActive) return profileReferences;
  if (roleReferences.isActive) return roleReferences;

  return {
    isVisible,
    options,
    selectedIndex,
    status,
    onSelectOption,
    onKeyPress,
  };
}
