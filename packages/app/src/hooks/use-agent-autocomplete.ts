import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import {
  useAgentCommandsQuery,
  type AgentSlashCommand,
  type DraftCommandConfig,
} from "./use-agent-commands-query";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { buildAgentProfileComposerAttachment } from "@/attachments/agent-profile";
import { buildAgentSessionComposerAttachment } from "@/attachments/agent-session";
import type {
  AgentProfileContextAttachment,
  AgentSessionContextAttachment,
} from "@/attachments/types";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  applySessionMentionReplacement,
  rankAgentProfileMentions,
  rankSessionMentionCandidates,
  resolveComposerMentionMode,
  type AgentProfileMention,
  type SessionMentionCandidate,
} from "@/utils/session-mention-autocomplete";
import { CLIENT_SLASH_COMMANDS, type ClientSlashCommand } from "@/client-slash-commands";
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

interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  setUserInput: (nextValue: string) => void;
  serverId: string;
  agentId: string;
  workspaceId?: string | null;
  draftConfig?: DraftCommandConfig;
  onAutocompleteApplied?: () => void;
  onClientSlashCommand?: (command: ClientSlashCommand) => void;
  onSessionMentionSelected?: (
    attachment: AgentSessionContextAttachment | AgentProfileContextAttachment,
  ) => void;
  canExecuteClientSlashCommand?: boolean;
}

interface AgentAutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: AgentAutocompleteInputSnapshot;
}

interface AgentAutocompleteInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "client_command"; command: ClientSlashCommand })
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
    })
  | (AutocompleteOption & {
      type: "agent_profile";
      mention: FileMentionRange;
      profile: AgentProfileMention;
    });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  isLoading: boolean;
  errorMessage?: string;
  loadingText: string;
  emptyText: string;
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
  onSessionMentionSelected?: UseAgentAutocompleteInput["onSessionMentionSelected"];
  serverId: string;
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
    selected.type === "client_command" || selected.type === "provider_command";
  if (input.snapshot && selectedIsCommand && !current.slashCommand) return;
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

  const mentionAttachment = mentionAttachmentForSelection(selected, input.serverId);
  if (mentionAttachment) {
    applySelectedMention({
      text: current.text,
      mention: current.fileMention,
      attachment: mentionAttachment,
      setUserInput: input.setUserInput,
      onSessionMentionSelected: input.onSessionMentionSelected,
      onAutocompleteApplied: input.onAutocompleteApplied,
    });
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

function mentionAttachmentForSelection(
  selected: AgentAutocompleteOption,
  serverId: string,
): AgentSessionContextAttachment | AgentProfileContextAttachment | null {
  if (selected.type === "agent_session") {
    return buildAgentSessionComposerAttachment({
      serverId: selected.candidate.serverId,
      agentId: selected.candidate.id,
      title: selected.candidate.title,
      provider: selected.candidate.provider,
      model: selected.candidate.model,
      cwd: selected.candidate.cwd,
      workspaceId: selected.candidate.workspaceId,
    });
  }
  if (selected.type === "agent_profile") {
    return buildAgentProfileComposerAttachment({
      serverId,
      profile: selected.profile,
    });
  }
  return null;
}

function applySelectedMention(input: {
  text: string;
  mention: FileMentionRange | null;
  attachment: AgentSessionContextAttachment | AgentProfileContextAttachment;
  setUserInput: (nextValue: string) => void;
  onSessionMentionSelected?: UseAgentAutocompleteInput["onSessionMentionSelected"];
  onAutocompleteApplied?: () => void;
}): void {
  if (!input.mention) return;
  input.setUserInput(
    applySessionMentionReplacement({
      text: input.text,
      mention: input.mention,
    }),
  );
  input.onSessionMentionSelected?.(input.attachment);
  input.onAutocompleteApplied?.();
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
  | { source: "provider"; command: AgentSlashCommand };

function resolveFileSuggestionsEnabled(input: {
  mode: AutocompleteMode;
  serverId: string;
  cwd: string;
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
}): boolean {
  return (
    input.mode === "file" &&
    Boolean(input.serverId) &&
    input.cwd.length > 0 &&
    Boolean(input.client) &&
    input.isConnected
  );
}

function resolveAutocompleteQuery(
  mode: AutocompleteMode,
  commandFilterQuery: string,
  fileFilterQuery: string,
): string {
  if (mode === "command") {
    return commandFilterQuery;
  }
  return fileFilterQuery;
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

function normalizeDraftCommandConfig(
  draftConfig?: DraftCommandConfig,
): DraftCommandConfig | undefined {
  if (!draftConfig) {
    return undefined;
  }

  const cwd = draftConfig.cwd.trim();
  if (!cwd) {
    return undefined;
  }

  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const featureValues = draftConfig.featureValues;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(featureValues && Object.keys(featureValues).length > 0 ? { featureValues } : {}),
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

function mapCommandToOption(entry: AvailableCommand, t: TFunction): AgentAutocompleteOption {
  const command = entry.command;
  const base = {
    id: command.name,
    label: `/${command.name}`,
    detail: command.argumentHint || undefined,
    description:
      entry.source === "client" ? t(entry.command.descriptionKey) : entry.command.description,
    kind: "command" as const,
  };
  if (entry.source === "client") {
    return {
      ...base,
      type: "client_command",
      command: entry.command,
    };
  }
  return {
    ...base,
    type: "provider_command",
  };
}

type AutocompleteMode = "command" | "file" | "session" | null;

interface BuildAutocompleteOptionsInput {
  isVisible: boolean;
  mode: AutocompleteMode;
  commands: AgentSlashCommand[];
  isDraftContext: boolean;
  commandFilterQuery: string;
  activeSlashCommand: SlashCommandRange | null;
  activeFileMention: FileMentionRange | null;
  fileSuggestions: DirectorySuggestionEntry[];
  sessionCandidates: SessionMentionCandidate[];
  profileMentions: AgentProfileMention[];
  serverId: string;
  t: TFunction;
}

function buildCommandAutocompleteOptions(input: BuildAutocompleteOptionsInput) {
  if (!input.isVisible) {
    return [];
  }

  if (input.mode === "command") {
    const providerCommands = input.commands.map(
      (command): AvailableCommand => ({ source: "provider", command }),
    );
    const clientCommandNames = new Set(CLIENT_SLASH_COMMANDS.map((command) => command.name));
    const rootCommands: AvailableCommand[] = input.isDraftContext
      ? providerCommands
      : [
          ...CLIENT_SLASH_COMMANDS.map(
            (command): AvailableCommand => ({ source: "client", command }),
          ),
          ...providerCommands.filter((entry) => !clientCommandNames.has(entry.command.name)),
        ];
    const availableCommands =
      input.activeSlashCommand?.position === "inline"
        ? filterInlineSkillCommandEntries(providerCommands)
        : rootCommands;
    const matches = filterAndRankCommandAutocompleteEntries(
      availableCommands,
      input.commandFilterQuery,
    );
    const orderedMatches = orderAutocompleteOptions(matches);
    return orderedMatches.map((entry) => mapCommandToOption(entry, input.t));
  }

  const activeFileMention = input.activeFileMention;
  if (input.mode === "file" && activeFileMention) {
    const orderedEntries = orderAutocompleteOptions(input.fileSuggestions);
    return orderedEntries.map((entry) => ({
      type: "workspace_entry" as const,
      id: `${entry.kind}:${entry.path}`,
      label: entry.path,
      kind: entry.kind,
      entryPath: entry.path,
      mention: activeFileMention,
    }));
  }

  if (input.mode === "session" && activeFileMention) {
    const sessionOptions = input.sessionCandidates.map((entry) =>
      mapSessionCandidateToOption(entry, activeFileMention),
    );
    const profileOptions = input.profileMentions.map((entry) =>
      mapProfileMentionToOption(entry, activeFileMention, input.serverId),
    );
    return orderAutocompleteOptions([...sessionOptions, ...profileOptions]);
  }

  return [];
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
    label: candidate.title?.trim() || shortId,
    detail: mentionProviderModelDetail(candidate.provider, candidate.model),
    description: shortId,
    kind: "agent",
    mention,
    candidate,
  };
}

function mapProfileMentionToOption(
  profile: AgentProfileMention,
  mention: FileMentionRange,
  serverId: string,
): AgentAutocompleteOption {
  return {
    type: "agent_profile",
    id: `${serverId}:${profile.id}`,
    label: profile.name,
    detail: mentionProviderModelDetail(profile.provider, profile.model),
    description: profile.model?.trim() || profile.provider,
    kind: "agent",
    mention,
    profile,
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

function collectRankedProfileMentions(input: {
  mode: AutocompleteMode;
  profiles: readonly AgentProfileMention[];
  query: string;
}): AgentProfileMention[] {
  if (input.mode !== "session") {
    return [];
  }
  return rankAgentProfileMentions({
    profiles: input.profiles,
    query: input.query,
  });
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
  if (input.mode !== "session" || !input.agentsById) {
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
  showFileAutocomplete: boolean;
  showSessionAutocomplete: boolean;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.showFileAutocomplete) {
    return "file";
  }
  if (args.showSessionAutocomplete) {
    return "session";
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  serverId: string;
  autocompleteCwd: string;
}): boolean {
  if (args.mode === "command") {
    return args.canLoadCommands;
  }
  if (args.mode === "file") {
    return Boolean(args.serverId) && args.autocompleteCwd.length > 0;
  }
  if (args.mode === "session") {
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

function resolveAutocompleteIsLoading(args: {
  mode: AutocompleteMode;
  isCommandsLoading: boolean;
  fileSuggestionsIsPending: boolean;
  fileSuggestionsIsLoading: boolean;
  optionsLength: number;
}): boolean {
  if (args.mode === "command") {
    return args.isCommandsLoading && args.optionsLength === 0;
  }
  if (args.mode === "file") {
    return (
      args.fileSuggestionsIsPending || (args.fileSuggestionsIsLoading && args.optionsLength === 0)
    );
  }
  return false;
}

function resolveAutocompleteErrorMessage(args: {
  mode: AutocompleteMode;
  isCommandError: boolean;
  commandError: Error | null;
  fileSuggestionsError: unknown;
  t: TFunction;
}): string | undefined {
  if (args.mode === "command") {
    return args.isCommandError
      ? (args.commandError?.message ?? args.t("agentAutocomplete.failedToLoad"))
      : undefined;
  }
  if (args.mode === "file") {
    return args.fileSuggestionsError instanceof Error
      ? args.fileSuggestionsError.message
      : undefined;
  }
  return undefined;
}

function resolveAutocompleteLoadingText(mode: AutocompleteMode, t: TFunction): string {
  if (mode === "file") {
    return t("agentAutocomplete.searchingWorkspace");
  }
  return t("agentAutocomplete.loadingCommands");
}

function resolveAutocompleteEmptyText(mode: AutocompleteMode, t: TFunction): string {
  if (mode === "file") {
    return t("agentAutocomplete.noFiles");
  }
  if (mode === "session") {
    return t("agentAutocomplete.noSessions");
  }
  return t("agentAutocomplete.noCommands");
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const { t } = useTranslation();
  const {
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    workspaceId,
    draftConfig,
    onAutocompleteApplied,
    onClientSlashCommand,
    onSessionMentionSelected,
    canExecuteClientSlashCommand,
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

  const activeFileMention = useMemo(
    () =>
      findActiveFileMention({
        text: userInput,
        cursorIndex,
      }),
    [cursorIndex, userInput],
  );
  const fileFilterQuery = activeFileMention?.query ?? "";
  const mentionMode = resolveComposerMentionMode({
    mentionQuery: activeFileMention === null ? null : activeFileMention.query,
    canAttachSessionMention: Boolean(onSessionMentionSelected),
  });
  const showFileAutocomplete = mentionMode === "file";
  const showSessionAutocomplete = mentionMode === "session";
  const [debouncedFileFilterQuery, setDebouncedFileFilterQuery] = useState(fileFilterQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileFilterQuery(fileFilterQuery), 180);
    return () => clearTimeout(timer);
  }, [fileFilterQuery]);

  const normalizedDraftConfig = useMemo(
    () => normalizeDraftCommandConfig(draftConfig),
    [draftConfig],
  );

  const isDraftContext = normalizedDraftConfig !== undefined;
  const queryDraftConfig = normalizedDraftConfig;
  const canLoadCommands = resolveCanLoadCommands({ serverId, agentId, isDraftContext });

  const agentsById = useSessionStore((state) => state.sessions[serverId]?.agents);
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);
  const agentCwd = agentsById?.get(agentId)?.cwd ?? "";
  const autocompleteCwd = useMemo(
    () => resolveAutocompleteCwd(isDraftContext, queryDraftConfig?.cwd, agentCwd),
    [agentCwd, isDraftContext, queryDraftConfig],
  );

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config: daemonConfig } = useDaemonConfig(serverId);

  const mode = resolveAutocompleteMode({
    showFileAutocomplete,
    showSessionAutocomplete,
    showCommandAutocomplete,
  });
  const canShowAutocomplete = resolveAutocompleteIsVisible({
    mode,
    canLoadCommands,
    serverId,
    autocompleteCwd,
  });

  const {
    commands,
    isLoading: isCommandsLoading,
    isError,
    error,
  } = useAgentCommandsQuery({
    serverId,
    agentId,
    enabled: mode === "command" && canLoadCommands,
    draftConfig: queryDraftConfig,
  });

  const isVisible = canShowAutocomplete && !(mode === "command" && isCommandsLoading);

  const sessionCandidates = useMemo(
    () =>
      collectRankedSessionMentions({
        mode,
        agentsById,
        layoutByWorkspace,
        serverId,
        agentId,
        workspaceId: workspaceId ?? null,
        query: fileFilterQuery,
      }),
    [agentId, agentsById, fileFilterQuery, layoutByWorkspace, mode, serverId, workspaceId],
  );

  const profileMentions = useMemo(
    () =>
      collectRankedProfileMentions({
        mode,
        profiles: daemonConfig?.agentProfiles ?? [],
        query: fileFilterQuery,
      }),
    [daemonConfig?.agentProfiles, fileFilterQuery, mode],
  );

  const fileSuggestionsQuery = useQuery({
    queryKey: [
      "directorySuggestions",
      serverId,
      autocompleteCwd,
      debouncedFileFilterQuery,
      true,
      true,
    ],
    queryFn: () =>
      fetchDirectorySuggestionEntries({
        client,
        cwd: autocompleteCwd,
        query: debouncedFileFilterQuery,
        unavailableMessage: t("common.errors.daemonClientUnavailable"),
      }),
    enabled: resolveFileSuggestionsEnabled({
      mode,
      serverId,
      cwd: autocompleteCwd,
      client,
      isConnected,
    }),
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const options = useMemo<AgentAutocompleteOption[]>(
    () =>
      buildCommandAutocompleteOptions({
        activeFileMention,
        commandFilterQuery,
        commands,
        activeSlashCommand,
        fileSuggestions: fileSuggestionsQuery.data ?? [],
        sessionCandidates,
        profileMentions,
        serverId,
        isDraftContext,
        isVisible,
        mode,
        t,
      }),
    [
      activeFileMention,
      activeSlashCommand,
      commandFilterQuery,
      commands,
      fileSuggestionsQuery.data,
      isDraftContext,
      isVisible,
      mode,
      profileMentions,
      serverId,
      sessionCandidates,
      t,
    ],
  );

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
        setUserInput,
        onAutocompleteApplied,
        onSessionMentionSelected,
        serverId,
      });
    },
    [
      canExecuteClientSlashCommand,
      onAutocompleteApplied,
      onClientSlashCommand,
      onSessionMentionSelected,
      serverId,
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
    query: resolveAutocompleteQuery(mode, commandFilterQuery, fileFilterQuery),
    onSelectOption: selectOptionFromKeyPress,
    onEscape: resolveCommandStartEscape(mode, activeSlashCommand, setUserInput),
  });

  const isLoading = resolveAutocompleteIsLoading({
    mode,
    isCommandsLoading,
    fileSuggestionsIsPending: fileSuggestionsQuery.isPending,
    fileSuggestionsIsLoading: fileSuggestionsQuery.isLoading,
    optionsLength: options.length,
  });
  const errorMessage = resolveAutocompleteErrorMessage({
    mode,
    isCommandError: isError,
    commandError: error,
    fileSuggestionsError: fileSuggestionsQuery.error,
    t,
  });

  const loadingText = resolveAutocompleteLoadingText(mode, t);
  const emptyText = resolveAutocompleteEmptyText(mode, t);

  return {
    isVisible,
    options,
    selectedIndex,
    isLoading,
    errorMessage,
    loadingText,
    emptyText,
    onSelectOption,
    onKeyPress,
  };
}
