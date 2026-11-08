import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import {
  isHeartbeatTarget,
  type ScheduleCadence,
  type ScheduleSummary,
  type ScheduleTarget,
} from "@getpaseo/protocol/schedule/types";
import type { ScheduleWorkspaceTarget } from "./schedule-workspace-targets";
import {
  toAgentRoleSnapshot,
  type AgentRole,
  type AgentRoleSnapshot,
} from "@getpaseo/protocol/agent-role";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { filterSelectableModels, findModelByReference } from "@/provider-selection/model-catalog";
import {
  buildProviderDefinitionMapForStatuses,
  INITIAL_USER_MODIFIED,
  RESOLVABLE_PROVIDER_STATUSES,
  resolveDefaultModelId,
  resolveFormStateFromProviderModels,
  resolveThinkingOptionId,
  type FormInitialValues,
  type FormState,
  type ProviderModelsByProvider,
  type UserModifiedFields,
} from "@/provider-selection/resolve-agent-form";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { shortenPath } from "@/utils/shorten-path";
import { normalizeScheduleFormCadence } from "./schedule-cadence-options";
import {
  NO_PROJECT_OPTION_ID,
  PROJECT_OPTION_PREFIX,
  type ScheduleProjectTarget,
} from "./schedule-project-targets";

export interface ScheduleFormDisplay {
  label: string;
  description?: string;
}

export interface ScheduleFormHost {
  serverId: string;
  label: string;
  supportsWorkspaceMultiplicity?: boolean;
  supportsScheduleWorkspaceTargets?: boolean;
  supportsScheduleProjectlessTargets?: boolean;
}

export interface ScheduleFormSnapshot {
  mode: "create" | "edit";
  schedule?: ScheduleSummary & { serverId?: string; serverName?: string };
  hosts: readonly ScheduleFormHost[];
  defaults: {
    serverId?: string | null;
    projectTargets: readonly ScheduleProjectTarget[];
    workspaceTargets?: readonly ScheduleWorkspaceTarget[];
    targetsLoading?: boolean;
    preferences?: FormPreferences;
    timezone?: string;
  };
}

export interface ScheduleFormProviderSnapshot {
  entries: ProviderSnapshotEntry[];
}

export interface ScheduleDisclosureState {
  showProjectField: boolean;
  showModelField: boolean;
  showThinkingField: boolean;
  showModeField: boolean;
  showIsolationField: boolean;
  showArchiveOnFinishField: boolean;
}

export interface ScheduleProviderSnapshotRequest {
  serverId: string;
  cwd: string;
}

export interface ScheduleFormProjectOption {
  id: string;
  value: string;
  label: string;
  testID: string;
}

export type ScheduleFormTargetKind = "agent" | "new-agent";
type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;
type ProviderResolutionStatus = "idle" | "pending" | "complete";

export interface ScheduleFormState {
  mode: "create" | "edit";
  targetKind: ScheduleFormTargetKind;
  isHeartbeat: boolean;
  supportsWorkspaceTargets: boolean;
  supportsProjectlessTargets: boolean;
  selectedWorkspaceId: string | null;
  selectedAgentId: string | null;
  workspaceDisplay: ScheduleFormDisplay | null;
  conversationDisplay: ScheduleFormDisplay | null;
  workspaceOptions: ScheduleFormProjectOption[];
  conversationOptions: ScheduleFormProjectOption[];
  targetAvailability:
    | "ready"
    | "loading"
    | "workspace-unavailable"
    | "agent-unavailable"
    | "unsupported";
  name: string;
  prompt: string;
  maxRuns: string;
  cadence: ScheduleCadence;
  submitCadence: CronCadence | undefined;
  hosts: ScheduleFormHost[];
  projectOptions: ScheduleFormProjectOption[];
  selectedServerId: string | null;
  selectedProvider: AgentProvider | null;
  selectedModel: string;
  selectedMode: string;
  selectedThinkingOptionId: string;
  selectedRole: AgentRoleSnapshot | null;
  systemPrompt: string | undefined;
  featureValues: Record<string, unknown> | undefined;
  roleProviderSupport: "loading" | "supported" | "unsupported";
  workingDir: string;
  projectDisplay: ScheduleFormDisplay | null;
  selectedProjectOptionId: string;
  selectedModelDisplay: ScheduleFormDisplay | null;
  selectedModeDisplay: ScheduleFormDisplay;
  selectedThinkingDisplay: ScheduleFormDisplay | null;
  modelSelectorProviders: ProviderSelectorProvider[];
  modeOptions: AgentMode[];
  availableThinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  archiveOnFinish: boolean;
  isolation: "local" | "worktree";
  effectiveIsolation: "local" | "worktree";
  submitArchiveOnFinish: boolean | undefined;
  submitIsolation: "local" | "worktree" | undefined;
  canUseWorktreeIsolation: boolean;
  providerResolutionByServerId: Record<string, ProviderResolutionStatus>;
  providerSnapshotRequest: ScheduleProviderSnapshotRequest | null;
  disclosure: ScheduleDisclosureState;
  canSubmit: boolean;
  submitError: string | null;
}

export interface ScheduleFormModel {
  getState: () => ScheduleFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  applyHosts: (hosts: readonly ScheduleFormHost[]) => void;
  applyProjectTargets: (targets: readonly ScheduleProjectTarget[]) => void;
  applyWorkspaceTargets: (targets: readonly ScheduleWorkspaceTarget[], loading: boolean) => void;
  setWorkspace: (workspaceId: string | null) => void;
  setConversation: (agentId: string | null) => void;
  applyPreferences: (preferences: FormPreferences | undefined) => void;
  applyProviderSnapshot: (serverId: string, snapshot: ScheduleFormProviderSnapshot) => void;
  setHost: (serverId: string | null) => void;
  setProject: (optionId: string, display: ScheduleFormDisplay) => void;
  setModel: (provider: AgentProvider, modelId: string) => void;
  setRole: (role: AgentRole | null) => void;
  applyProfile: (profile: MaterializedAgentProfile) => void;
  setThinking: (thinkingOptionId: string) => void;
  setSessionMode: (modeId: string) => void;
  setName: (value: string) => void;
  setPrompt: (value: string) => void;
  setMaxRuns: (value: string) => void;
  setCadence: (value: ScheduleCadence) => void;
  setIsolation: (value: "local" | "worktree") => void;
  setArchiveOnFinish: (value: boolean) => void;
  setSubmitError: (value: string | null) => void;
}

export function buildFormTarget(
  state: ScheduleFormState,
  schedule?: ScheduleSummary,
): ScheduleTarget {
  if (state.selectedWorkspaceId && state.selectedAgentId) {
    return {
      type: "agent",
      workspaceId: state.selectedWorkspaceId,
      agentId: state.selectedAgentId,
    };
  }
  if (!state.selectedProvider || !state.workingDir.trim()) {
    throw new Error("Choose a target and an agent model");
  }
  const existingConfig = schedule?.target.type === "new-agent" ? schedule.target.config : undefined;
  const title = existingConfig ? existingConfig.title : state.name.trim() || undefined;
  return {
    type: "new-agent",
    ...(state.selectedWorkspaceId ? { workspaceId: state.selectedWorkspaceId } : {}),
    config: {
      ...existingConfig,
      provider: state.selectedProvider,
      cwd: state.workingDir.trim(),
      projectAssigned: state.selectedProjectOptionId === NO_PROJECT_OPTION_ID ? false : undefined,
      role: state.selectedRole ?? undefined,
      systemPrompt: state.systemPrompt,
      featureValues: state.featureValues,
      model: state.selectedModel || undefined,
      modeId: state.selectedMode || undefined,
      thinkingOptionId: state.selectedThinkingOptionId || undefined,
      ...(state.submitArchiveOnFinish !== undefined
        ? { archiveOnFinish: state.submitArchiveOnFinish }
        : {}),
      ...(state.submitIsolation !== undefined ? { isolation: state.submitIsolation } : {}),
      title,
    },
  };
}

const DEFAULT_CADENCE: ScheduleCadence = { type: "every", everyMs: 60 * 60 * 1000 };
const DEFAULT_TIMEZONE = "UTC";

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function newAgentConfig(schedule: ScheduleFormSnapshot["schedule"]) {
  if (schedule?.target.type === "new-agent") {
    return schedule.target.config;
  }
  return null;
}

function buildProjectOptionTestId(optionId: string): string {
  const targetKey = optionId.slice(PROJECT_OPTION_PREFIX.length).replace(/^[^:]+:/, "");
  return `schedule-project-option-${targetKey}`;
}

function buildProjectDisplay(target: ScheduleProjectTarget): ScheduleFormDisplay {
  return { label: target.projectName };
}

function buildStoredProjectDisplay(cwd: string): ScheduleFormDisplay | null {
  const storedPath = cwd.trim();
  if (!storedPath) {
    return null;
  }
  return { label: shortenPath(storedPath) };
}

function buildProjectOptions(
  targets: readonly ScheduleProjectTarget[],
  serverId: string | null,
): ScheduleFormProjectOption[] {
  if (!serverId) {
    return [];
  }
  return targets
    .filter((target) => target.serverId === serverId)
    .map((target) => ({
      id: target.optionId,
      value: target.optionId,
      label: target.projectName,
      testID: buildProjectOptionTestId(target.optionId),
    }));
}

function resolveProjectTarget(input: {
  targets: readonly ScheduleProjectTarget[];
  serverId: string | null;
  cwd: string;
}): ScheduleProjectTarget | null {
  const cwd = input.cwd.trim();
  if (!input.serverId || !cwd) {
    return null;
  }
  return (
    input.targets.find((target) => target.serverId === input.serverId && target.cwd === cwd) ?? null
  );
}

function findProjectTargetByOptionId(
  targets: readonly ScheduleProjectTarget[],
  optionId: string,
): ScheduleProjectTarget | null {
  return targets.find((target) => target.optionId === optionId) ?? null;
}

function resolveProjectDisplay(input: {
  targets: readonly ScheduleProjectTarget[];
  serverId: string | null;
  cwd: string;
}): ScheduleFormDisplay | null {
  const target = resolveProjectTarget(input);
  if (target) {
    return buildProjectDisplay(target);
  }
  return buildStoredProjectDisplay(input.cwd);
}

function buildProviderModelsByProvider(entries: ProviderSnapshotEntry[]): ProviderModelsByProvider {
  const map: ProviderModelsByProvider = new Map();
  for (const entry of entries) {
    map.set(entry.provider, filterSelectableModels(entry.models ?? null));
  }
  return map;
}

function resolveSelectedEntry(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
): ProviderSnapshotEntry | null {
  if (!provider) {
    return null;
  }
  return entries.find((entry) => entry.provider === provider) ?? null;
}

function resolveModeOptions(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
): AgentMode[] {
  return resolveSelectedEntry(entries, provider)?.modes ?? [];
}

function resolveAvailableModels(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
): AgentModelDefinition[] | null {
  return filterSelectableModels(resolveSelectedEntry(entries, provider)?.models ?? null);
}

function resolveEffectiveModel(
  models: AgentModelDefinition[] | null,
  modelId: string,
): AgentModelDefinition | null {
  const selectedModelId = modelId.trim();
  if (!models || !selectedModelId) {
    return null;
  }
  return (
    models.find((model) => model.id === selectedModelId) ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    null
  );
}

function resolveThinkingOptions(
  entries: readonly ProviderSnapshotEntry[],
  provider: AgentProvider | null,
  modelId: string,
): NonNullable<AgentModelDefinition["thinkingOptions"]> {
  const model = resolveEffectiveModel(resolveAvailableModels(entries, provider), modelId);
  return model?.thinkingOptions ?? [];
}

function resolveModelDisplay(input: {
  entries: readonly ProviderSnapshotEntry[];
  provider: AgentProvider | null;
  modelId: string;
}): ScheduleFormDisplay | null {
  const modelId = input.modelId.trim();
  if (!modelId) {
    return null;
  }
  const model = resolveEffectiveModel(
    resolveAvailableModels(input.entries, input.provider),
    modelId,
  );
  return { label: model?.label ?? modelId };
}

function resolveModeDisplay(input: {
  modeOptions: readonly AgentMode[];
  modeId: string;
}): ScheduleFormDisplay {
  const modeId = input.modeId.trim();
  if (!modeId) {
    return { label: "Default mode" };
  }
  return { label: input.modeOptions.find((mode) => mode.id === modeId)?.label ?? modeId };
}

function resolveThinkingDisplay(input: {
  options: readonly ThinkingOption[];
  thinkingOptionId: string;
}): ScheduleFormDisplay | null {
  const thinkingOptionId = input.thinkingOptionId.trim();
  if (!thinkingOptionId) {
    return null;
  }
  const option = input.options.find((entry) => entry.id === thinkingOptionId) ?? {
    id: thinkingOptionId,
  };
  return { label: formatThinkingOptionLabel(option) };
}

function isSelectedModelValidForProviders(input: {
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: AgentProvider | null;
  selectedModel: string;
}): boolean {
  if (!input.selectedProvider) {
    return false;
  }
  const provider = input.providers.find((entry) => entry.id === input.selectedProvider);
  if (!provider || provider.modelSelection.kind !== "models") {
    return false;
  }
  const selectedModel = input.selectedModel.trim();
  if (!selectedModel) {
    return true;
  }
  return provider.modelSelection.rows.some((row) => row.modelId === selectedModel);
}

function resolveRoleProviderSupport(
  entry: ProviderSnapshotEntry | null,
): ScheduleFormState["roleProviderSupport"] {
  if (!entry || entry.status !== "ready") return "loading";
  return entry.supportsSystemPrompt === true ? "supported" : "unsupported";
}

function normalizeInitialValues(input: {
  snapshot: ScheduleFormSnapshot;
}): FormInitialValues | undefined {
  const config = newAgentConfig(input.snapshot.schedule);
  if (!config) {
    return undefined;
  }
  return {
    provider: config.provider,
    model: config.model ?? null,
    modeId: config.modeId ?? null,
    thinkingOptionId: config.thinkingOptionId ?? null,
  };
}

function resolveInitialServerId(snapshot: ScheduleFormSnapshot): string | null {
  if (snapshot.mode === "edit") {
    return snapshot.schedule?.serverId ?? snapshot.defaults.serverId ?? null;
  }
  if (snapshot.defaults.serverId !== undefined) {
    return snapshot.defaults.serverId;
  }
  if (snapshot.hosts.length === 1) {
    return snapshot.hosts[0]?.serverId ?? null;
  }
  return null;
}

function makeProviderResolutionRecord(
  serverId: string | null,
): Record<string, ProviderResolutionStatus> {
  if (!serverId) {
    return {};
  }
  return { [serverId]: "pending" };
}

function resolveTargetKind(snapshot: ScheduleFormSnapshot): ScheduleFormTargetKind {
  if (snapshot.mode === "edit" && snapshot.schedule?.target.type === "agent") {
    return "agent";
  }
  return "new-agent";
}

function buildProviderSnapshotRequest(input: {
  targetKind: ScheduleFormTargetKind;
  selectedServerId: string | null;
  workingDir: string;
}): ScheduleProviderSnapshotRequest | null {
  if (input.targetKind !== "new-agent" || !input.selectedServerId || !input.workingDir.trim()) {
    return null;
  }
  return { serverId: input.selectedServerId, cwd: input.workingDir };
}

function buildInitialProjectDisplay(input: {
  config: ReturnType<typeof newAgentConfig>;
  targets: readonly ScheduleProjectTarget[];
  selectedServerId: string | null;
}): ScheduleFormDisplay | null {
  if (!input.config) {
    return null;
  }
  return resolveProjectDisplay({
    targets: input.targets,
    serverId: input.selectedServerId,
    cwd: input.config.cwd,
  });
}

function buildInitialModelDisplay(modelId: string): ScheduleFormDisplay | null {
  if (!modelId) {
    return null;
  }
  return { label: modelId };
}

function buildInitialModeDisplay(modeId: string): ScheduleFormDisplay {
  if (!modeId) {
    return { label: "Default mode" };
  }
  return { label: modeId };
}

function buildInitialThinkingDisplay(thinkingOptionId: string): ScheduleFormDisplay | null {
  if (!thinkingOptionId) {
    return null;
  }
  return { label: formatThinkingOptionLabel({ id: thinkingOptionId }) };
}

function formatInitialMaxRuns(schedule: ScheduleFormSnapshot["schedule"]): string {
  if (schedule?.maxRuns == null) {
    return "";
  }
  return String(schedule.maxRuns);
}

function resolveInitialSubmitCadence(
  schedule: ScheduleFormSnapshot["schedule"],
  initialCadence: CronCadence,
): CronCadence | undefined {
  return schedule ? undefined : initialCadence;
}

function resolveInitialIsolation(input: {
  config: ReturnType<typeof newAgentConfig>;
  preferences: FormPreferences | undefined;
}): "local" | "worktree" {
  if (input.config) {
    return input.config.isolation ?? "local";
  }
  return input.preferences?.isolation ?? "local";
}

function resolveSelectedProjectOptionId(input: {
  target: ScheduleProjectTarget | null;
  config: ReturnType<typeof newAgentConfig>;
  workspaceId: string | null;
}): string {
  if (input.config?.projectAssigned === false && !input.workspaceId) return NO_PROJECT_OPTION_ID;
  return input.target?.optionId ?? "";
}

function buildInitialProviderResolution(
  request: ScheduleProviderSnapshotRequest | null,
): Record<string, ProviderResolutionStatus> {
  if (!request) {
    return {};
  }
  return makeProviderResolutionRecord(request.serverId);
}

function resolveCanUseWorktreeIsolation(input: {
  state: Pick<ScheduleFormState, "selectedServerId" | "workingDir">;
  hosts: readonly ScheduleFormHost[];
  targets: readonly ScheduleProjectTarget[];
}): boolean {
  const target = resolveProjectTarget({
    targets: input.targets,
    serverId: input.state.selectedServerId,
    cwd: input.state.workingDir,
  });
  const host = input.hosts.find((entry) => entry.serverId === input.state.selectedServerId);
  return Boolean(target?.isGit && host?.supportsWorkspaceMultiplicity);
}

function selectedHostSupportsWorkspaceMultiplicity(input: {
  hosts: readonly ScheduleFormHost[];
  selectedServerId: string | null;
}): boolean {
  return (
    input.hosts.find((entry) => entry.serverId === input.selectedServerId)
      ?.supportsWorkspaceMultiplicity === true
  );
}

function resolveEffectiveIsolation(input: {
  isolation: "local" | "worktree";
  canUseWorktreeIsolation: boolean;
  selectedServerId: string | null;
  providerResolutionByServerId: Record<string, ProviderResolutionStatus>;
}): "local" | "worktree" {
  if (input.isolation !== "worktree") {
    return "local";
  }
  if (input.canUseWorktreeIsolation) {
    return "worktree";
  }
  if (
    !input.selectedServerId ||
    input.providerResolutionByServerId[input.selectedServerId] !== "complete"
  ) {
    return "worktree";
  }
  return "local";
}

function resolveDisclosure(state: ScheduleFormState): ScheduleDisclosureState {
  if (state.targetKind === "agent") {
    return {
      showProjectField: false,
      showModelField: false,
      showThinkingField: false,
      showModeField: false,
      showIsolationField: false,
      showArchiveOnFinishField: false,
    };
  }

  const hasProject = state.workingDir.trim().length > 0;
  const hasSelectedProvider = Boolean(state.selectedProvider);
  const hasSelectedModel = Boolean(state.selectedProvider && state.selectedModel.trim());
  const showProjectField =
    !state.selectedWorkspaceId && (state.mode === "edit" || Boolean(state.selectedServerId));
  const showModelField = hasProject;
  return {
    showProjectField,
    showModelField,
    showThinkingField:
      showModelField && hasSelectedModel && state.availableThinkingOptions.length > 0,
    showModeField: showModelField && hasSelectedProvider && state.modeOptions.length > 0,
    showIsolationField: !state.selectedWorkspaceId && hasProject && state.canUseWorktreeIsolation,
    showArchiveOnFinishField:
      !state.selectedWorkspaceId &&
      hasProject &&
      selectedHostSupportsWorkspaceMultiplicity({
        hosts: state.hosts,
        selectedServerId: state.selectedServerId,
      }),
  };
}

function resolveCanSubmit(state: ScheduleFormState): boolean {
  if (state.isHeartbeat) {
    return state.submitCadence !== undefined;
  }
  if (state.selectedWorkspaceId && state.targetAvailability !== "ready") return false;
  if (state.targetKind === "agent") {
    return Boolean(state.selectedAgentId && state.prompt.trim());
  }
  if (state.prompt.trim().length === 0) {
    return false;
  }
  if (state.selectedRole && state.roleProviderSupport !== "supported") return false;
  const hasWorkingDir = state.workingDir.trim().length > 0;
  const hasMatchedProject = state.selectedProjectOptionId.trim().length > 0;
  if (state.mode === "create" && !state.selectedWorkspaceId && !hasMatchedProject) {
    return false;
  }
  if (state.selectedProjectOptionId === NO_PROJECT_OPTION_ID && !state.supportsProjectlessTargets) {
    return false;
  }
  if (!hasWorkingDir) {
    return false;
  }
  return isSelectedModelValidForProviders({
    providers: state.modelSelectorProviders,
    selectedProvider: state.selectedProvider,
    selectedModel: state.selectedModel,
  });
}

function updateDerivedState(input: {
  state: ScheduleFormState;
  hosts: readonly ScheduleFormHost[];
  targets: readonly ScheduleProjectTarget[];
  providerEntries: readonly ProviderSnapshotEntry[];
  workspaceTargets: readonly ScheduleWorkspaceTarget[];
  targetsLoading: boolean;
}): ScheduleFormState {
  const modeOptions = resolveModeOptions(input.providerEntries, input.state.selectedProvider);
  const providerEntry = resolveSelectedEntry(input.providerEntries, input.state.selectedProvider);
  const roleProviderSupport = resolveRoleProviderSupport(providerEntry);
  const availableThinkingOptions = resolveThinkingOptions(
    input.providerEntries,
    input.state.selectedProvider,
    input.state.selectedModel,
  );
  const canUseWorktreeIsolation = resolveCanUseWorktreeIsolation({
    state: input.state,
    hosts: input.hosts,
    targets: input.targets,
  });
  const canSubmitWorkspaceLifecycleOptions =
    !input.state.selectedWorkspaceId &&
    selectedHostSupportsWorkspaceMultiplicity({
      hosts: input.hosts,
      selectedServerId: input.state.selectedServerId,
    });
  const effectiveIsolation = resolveEffectiveIsolation({
    isolation: input.state.isolation,
    canUseWorktreeIsolation,
    selectedServerId: input.state.selectedServerId,
    providerResolutionByServerId: input.state.providerResolutionByServerId,
  });
  const projectTarget = resolveProjectTarget({
    targets: input.targets,
    serverId: input.state.selectedServerId,
    cwd: input.state.workingDir,
  });
  const host = input.hosts.find((entry) => entry.serverId === input.state.selectedServerId);
  const supportsWorkspaceTargets = host?.supportsScheduleWorkspaceTargets === true;
  const supportsProjectlessTargets = host?.supportsScheduleProjectlessTargets === true;
  const workspaces = input.workspaceTargets.filter(
    (target) => target.serverId === input.state.selectedServerId,
  );
  const workspace = workspaces.find(
    (target) => target.workspaceId === input.state.selectedWorkspaceId,
  );
  const conversation = workspace?.conversations.find(
    (target) => target.agentId === input.state.selectedAgentId,
  );
  let targetAvailability: ScheduleFormState["targetAvailability"] = "ready";
  if (input.state.selectedWorkspaceId) {
    if (!supportsWorkspaceTargets) targetAvailability = "unsupported";
    else if (input.targetsLoading) targetAvailability = "loading";
    else if (!workspace) targetAvailability = "workspace-unavailable";
    else if (input.state.selectedAgentId && !conversation) targetAvailability = "agent-unavailable";
  }
  const nextState: ScheduleFormState = {
    ...input.state,
    supportsWorkspaceTargets,
    supportsProjectlessTargets,
    roleProviderSupport,
    targetAvailability,
    workspaceOptions: workspaces.map((target) => ({
      id: target.workspaceId,
      value: target.workspaceId,
      label: target.label,
      testID: `schedule-workspace-option-${target.workspaceId}`,
    })),
    conversationOptions: (workspace?.conversations ?? []).map((target) => ({
      id: target.agentId,
      value: target.agentId,
      label: target.title || target.agentId,
      testID: `schedule-conversation-option-${target.agentId}`,
    })),
    hosts: [...input.hosts],
    projectOptions: buildProjectOptions(input.targets, input.state.selectedServerId),
    projectDisplay:
      input.state.selectedProjectOptionId === NO_PROJECT_OPTION_ID
        ? input.state.projectDisplay
        : resolveProjectDisplay({
            targets: input.targets,
            serverId: input.state.selectedServerId,
            cwd: input.state.workingDir,
          }),
    selectedProjectOptionId:
      input.state.selectedProjectOptionId === NO_PROJECT_OPTION_ID
        ? NO_PROJECT_OPTION_ID
        : (projectTarget?.optionId ?? input.state.selectedProjectOptionId),
    selectedModelDisplay: resolveModelDisplay({
      entries: input.providerEntries,
      provider: input.state.selectedProvider,
      modelId: input.state.selectedModel,
    }),
    selectedModeDisplay: resolveModeDisplay({ modeOptions, modeId: input.state.selectedMode }),
    selectedThinkingDisplay: resolveThinkingDisplay({
      options: availableThinkingOptions,
      thinkingOptionId: input.state.selectedThinkingOptionId,
    }),
    modeOptions,
    availableThinkingOptions,
    canUseWorktreeIsolation,
    effectiveIsolation,
    submitArchiveOnFinish: canSubmitWorkspaceLifecycleOptions
      ? input.state.archiveOnFinish
      : undefined,
    submitIsolation: canSubmitWorkspaceLifecycleOptions ? effectiveIsolation : undefined,
  };
  const disclosure = resolveDisclosure(nextState);
  return { ...nextState, disclosure, canSubmit: resolveCanSubmit({ ...nextState, disclosure }) };
}

function buildStoredTargetDisplay(
  id: string | null,
  label: string | null | undefined,
): ScheduleFormDisplay | null {
  return id ? { label: label || id } : null;
}

function buildInitialRoleState(config: ReturnType<typeof newAgentConfig>) {
  return {
    selectedRole: config?.role ?? null,
    systemPrompt: config?.systemPrompt,
    featureValues: config?.featureValues,
  };
}

function buildInitialTargetSelection(
  snapshot: ScheduleFormSnapshot,
  selectedServerId: string | null,
) {
  const config = newAgentConfig(snapshot.schedule);
  const target = snapshot.schedule?.target;
  const selectedWorkspaceId =
    target && target.type !== "board-task" ? (target.workspaceId ?? null) : null;
  const selectedAgentId = target?.type === "agent" && selectedWorkspaceId ? target.agentId : null;
  const workspace = snapshot.defaults.workspaceTargets?.find(
    (entry) => entry.serverId === selectedServerId && entry.workspaceId === selectedWorkspaceId,
  );
  const conversation = workspace?.conversations.find((entry) => entry.agentId === selectedAgentId);
  return {
    selectedWorkspaceId,
    selectedAgentId,
    workingDir: workspace?.cwd ?? config?.cwd ?? "",
    isHeartbeat: target ? isHeartbeatTarget(target) : false,
    workspaceDisplay: buildStoredTargetDisplay(selectedWorkspaceId, workspace?.label),
    conversationDisplay: buildStoredTargetDisplay(selectedAgentId, conversation?.title),
  };
}

function buildInitialState(snapshot: ScheduleFormSnapshot): ScheduleFormState {
  const selectedServerId = resolveInitialServerId(snapshot);
  const config = newAgentConfig(snapshot.schedule);
  const targetKind = resolveTargetKind(snapshot);
  const targetSelection = buildInitialTargetSelection(snapshot, selectedServerId);
  const workingDir = targetSelection.workingDir;
  const selectedProjectTarget = resolveProjectTarget({
    targets: snapshot.defaults.projectTargets,
    serverId: selectedServerId,
    cwd: workingDir,
  });
  const providerSnapshotRequest = buildProviderSnapshotRequest({
    targetKind,
    selectedServerId,
    workingDir,
  });
  const initialCadence = normalizeScheduleFormCadence(
    snapshot.schedule?.cadence ?? DEFAULT_CADENCE,
    snapshot.defaults.timezone ?? DEFAULT_TIMEZONE,
  );
  const initialModel = config?.model ?? "";
  const initialMode = config?.modeId ?? "";
  const initialThinking = config?.thinkingOptionId ?? "";
  const state: ScheduleFormState = {
    mode: snapshot.mode,
    targetKind,
    ...targetSelection,
    ...buildInitialRoleState(config),
    supportsWorkspaceTargets: false,
    supportsProjectlessTargets: false,
    roleProviderSupport: "loading",
    workspaceOptions: [],
    conversationOptions: [],
    targetAvailability: "ready",
    name: snapshot.schedule?.name ?? "",
    prompt: snapshot.schedule?.prompt ?? "",
    maxRuns: formatInitialMaxRuns(snapshot.schedule),
    cadence: initialCadence,
    submitCadence: resolveInitialSubmitCadence(snapshot.schedule, initialCadence),
    hosts: [...snapshot.hosts],
    projectOptions: buildProjectOptions(snapshot.defaults.projectTargets, selectedServerId),
    selectedServerId,
    selectedProvider: config?.provider ?? null,
    selectedModel: initialModel,
    selectedMode: initialMode,
    selectedThinkingOptionId: initialThinking,
    workingDir,
    projectDisplay: buildInitialProjectDisplay({
      config,
      targets: snapshot.defaults.projectTargets,
      selectedServerId,
    }),
    selectedProjectOptionId: resolveSelectedProjectOptionId({
      target: selectedProjectTarget,
      config,
      workspaceId: targetSelection.selectedWorkspaceId,
    }),
    selectedModelDisplay: buildInitialModelDisplay(initialModel),
    selectedModeDisplay: buildInitialModeDisplay(initialMode),
    selectedThinkingDisplay: buildInitialThinkingDisplay(initialThinking),
    modelSelectorProviders: [],
    modeOptions: [],
    availableThinkingOptions: [],
    archiveOnFinish: config?.archiveOnFinish ?? true,
    isolation: resolveInitialIsolation({ config, preferences: snapshot.defaults.preferences }),
    effectiveIsolation: "local",
    submitArchiveOnFinish: undefined,
    submitIsolation: undefined,
    canUseWorktreeIsolation: false,
    providerResolutionByServerId: buildInitialProviderResolution(providerSnapshotRequest),
    providerSnapshotRequest,
    disclosure: {
      showProjectField: false,
      showModelField: false,
      showThinkingField: false,
      showModeField: false,
      showIsolationField: false,
      showArchiveOnFinishField: false,
    },
    canSubmit: false,
    submitError: null,
  };
  return updateDerivedState({
    state,
    hosts: snapshot.hosts,
    targets: snapshot.defaults.projectTargets,
    providerEntries: [],
    workspaceTargets: snapshot.defaults.workspaceTargets ?? [],
    targetsLoading: snapshot.defaults.targetsLoading ?? false,
  });
}

function toFormState(state: ScheduleFormState): FormState {
  return {
    provider: state.selectedProvider,
    modeId: state.selectedMode,
    model: state.selectedModel,
    thinkingOptionId: state.selectedThinkingOptionId,
  };
}

function applyResolvedFormState(state: ScheduleFormState, form: FormState): ScheduleFormState {
  return {
    ...state,
    selectedProvider: form.provider,
    selectedMode: form.modeId,
    selectedModel: form.model,
    selectedThinkingOptionId: form.thinkingOptionId,
  };
}

function resolveSnapshotSelection(input: {
  state: ScheduleFormState;
  snapshot: ScheduleFormSnapshot;
  initialValues: FormInitialValues | undefined;
  preferences: FormPreferences | null;
  providerEntries: ProviderSnapshotEntry[];
  userModified: UserModifiedFields;
}): ScheduleFormState {
  const providerDefinitions = buildProviderDefinitions(input.providerEntries);
  const allowedProviderMap = buildProviderDefinitionMapForStatuses({
    snapshotEntries: input.providerEntries,
    providerDefinitions,
    statuses: RESOLVABLE_PROVIDER_STATUSES,
  });
  const resolved = resolveFormStateFromProviderModels(
    input.initialValues,
    input.preferences,
    buildProviderModelsByProvider(input.providerEntries),
    input.userModified,
    toFormState(input.state),
    allowedProviderMap,
  );
  return applyResolvedFormState(input.state, resolved);
}

function preferencesForSnapshotResolution(
  snapshot: ScheduleFormSnapshot,
  preferences: FormPreferences | null,
): FormPreferences | null {
  return snapshot.mode === "edit" ? null : preferences;
}

function pickModeForProvider(input: {
  entries: readonly ProviderSnapshotEntry[];
  provider: AgentProvider;
  currentProvider: AgentProvider | null;
  currentMode: string;
}): string {
  const currentMode = input.currentMode.trim();
  if (input.currentProvider === input.provider && currentMode) {
    return currentMode;
  }
  const entry = resolveSelectedEntry(input.entries, input.provider);
  return entry?.defaultModeId ?? entry?.modes?.[0]?.id ?? "";
}

function pickModelForProvider(input: {
  entries: readonly ProviderSnapshotEntry[];
  provider: AgentProvider;
  modelId: string;
}): string {
  const normalizedModelId = input.modelId.trim();
  if (normalizedModelId) {
    return normalizedModelId;
  }
  return resolveDefaultModelId(resolveAvailableModels(input.entries, input.provider));
}

function thinkingDraftKey(provider: AgentProvider, modelId: string): string {
  return `${provider}:${modelId}`;
}

function seedThinkingDrafts(
  drafts: Map<string, string>,
  preferences: FormPreferences | null,
): void {
  for (const [provider, providerPreferences] of Object.entries(
    preferences?.providerPreferences ?? {},
  )) {
    for (const [modelId, thinkingOptionId] of Object.entries(
      providerPreferences?.thinkingByModel ?? {},
    )) {
      const key = thinkingDraftKey(provider as AgentProvider, modelId);
      if (!drafts.has(key)) {
        drafts.set(key, thinkingOptionId);
      }
    }
  }
}

function canonicalizeThinkingDrafts(
  drafts: Map<string, string>,
  entries: readonly ProviderSnapshotEntry[],
): void {
  for (const entry of entries) {
    const models = filterSelectableModels(entry.models ?? null);
    if (!models) {
      continue;
    }
    for (const model of models) {
      const canonicalKey = thinkingDraftKey(entry.provider, model.id);
      if (drafts.has(canonicalKey)) {
        continue;
      }
      const resolvedAlias = model.aliases?.find(
        (alias) =>
          findModelByReference(models, alias)?.id === model.id &&
          drafts.has(thinkingDraftKey(entry.provider, alias)),
      );
      if (!resolvedAlias) {
        continue;
      }
      const aliasedThinking = drafts.get(thinkingDraftKey(entry.provider, resolvedAlias));
      if (aliasedThinking !== undefined) {
        drafts.set(canonicalKey, aliasedThinking);
      }
    }
  }
}

export function openScheduleForm(snapshot: ScheduleFormSnapshot): ScheduleFormModel {
  const listeners = new Set<() => void>();
  const initialValues = normalizeInitialValues({
    snapshot,
  });
  let closed = false;
  let hosts = snapshot.hosts;
  let projectTargets = snapshot.defaults.projectTargets;
  let workspaceTargets = snapshot.defaults.workspaceTargets ?? [];
  let targetsLoading = snapshot.defaults.targetsLoading ?? false;
  let preferences = snapshot.defaults.preferences ?? null;
  const thinkingDrafts = new Map<string, string>();
  seedThinkingDrafts(thinkingDrafts, preferences);
  const initialAgentConfig = newAgentConfig(snapshot.schedule);
  if (
    initialAgentConfig?.provider &&
    initialAgentConfig.model &&
    initialAgentConfig.thinkingOptionId
  ) {
    thinkingDrafts.set(
      thinkingDraftKey(initialAgentConfig.provider, initialAgentConfig.model),
      initialAgentConfig.thinkingOptionId,
    );
  }
  let providerEntries: ProviderSnapshotEntry[] = [];
  let userModified = { ...INITIAL_USER_MODIFIED, isolation: false };
  const timezone = snapshot.defaults.timezone ?? DEFAULT_TIMEZONE;
  let state = buildInitialState(snapshot);

  function publish(nextState: ScheduleFormState): void {
    if (closed) {
      return;
    }
    state = updateDerivedState({
      state: nextState,
      hosts,
      targets: projectTargets,
      providerEntries,
      workspaceTargets,
      targetsLoading,
    });
    for (const listener of listeners) {
      listener();
    }
  }

  function requestProviderSnapshot(serverId: string | null, cwd: string): void {
    const trimmedCwd = cwd.trim();
    if (!serverId || !trimmedCwd) {
      publish({
        ...state,
        providerSnapshotRequest: null,
      });
      return;
    }
    publish({
      ...state,
      providerResolutionByServerId: {
        ...state.providerResolutionByServerId,
        [serverId]: "pending",
      },
      providerSnapshotRequest: { serverId, cwd: trimmedCwd },
    });
  }

  function clearProviderSelection(nextState: ScheduleFormState): ScheduleFormState {
    providerEntries = [];
    return {
      ...nextState,
      selectedProvider: null,
      selectedModel: "",
      selectedMode: "",
      selectedThinkingOptionId: "",
      modelSelectorProviders: [],
      modeOptions: [],
      availableThinkingOptions: [],
      selectedModelDisplay: null,
      selectedModeDisplay: { label: "Default mode" },
      selectedThinkingDisplay: null,
      providerSnapshotRequest: null,
    };
  }

  function resolvePreferences(nextState: ScheduleFormState): ScheduleFormState {
    let resolved = nextState;
    if (
      snapshot.mode === "create" &&
      !userModified.isolation &&
      preferences?.isolation !== undefined
    ) {
      resolved = { ...resolved, isolation: preferences.isolation };
    }
    if (providerEntries.length === 0 || resolved.targetKind !== "new-agent") {
      return resolved;
    }
    return resolveSnapshotSelection({
      state: resolved,
      snapshot,
      initialValues,
      preferences: preferencesForSnapshotResolution(snapshot, preferences),
      providerEntries,
      userModified,
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    applyHosts(nextHosts) {
      if (closed || hosts === nextHosts) {
        return;
      }
      hosts = nextHosts;
      publish(state);
    },
    applyProjectTargets(nextTargets) {
      if (closed || projectTargets === nextTargets) {
        return;
      }
      projectTargets = nextTargets;
      publish(state);
    },
    applyWorkspaceTargets(targets, loading) {
      if (closed) return;
      workspaceTargets = targets;
      targetsLoading = loading;
      const workspace = targets.find(
        (entry) =>
          entry.serverId === state.selectedServerId &&
          entry.workspaceId === state.selectedWorkspaceId,
      );
      const conversation = workspace?.conversations.find(
        (entry) => entry.agentId === state.selectedAgentId,
      );
      const needsProviderSnapshot =
        workspace && state.targetKind === "new-agent" && state.workingDir !== workspace.cwd;
      publish({
        ...state,
        workingDir: workspace?.cwd ?? state.workingDir,
        workspaceDisplay: workspace ? { label: workspace.label } : state.workspaceDisplay,
        conversationDisplay: conversation
          ? { label: conversation.title || conversation.agentId }
          : state.conversationDisplay,
      });
      if (needsProviderSnapshot) requestProviderSnapshot(state.selectedServerId, state.workingDir);
    },
    setWorkspace(workspaceId) {
      if (closed || state.isHeartbeat || !state.supportsWorkspaceTargets) return;
      if (state.selectedWorkspaceId === workspaceId) return;
      const workspace = workspaceTargets.find(
        (entry) => entry.serverId === state.selectedServerId && entry.workspaceId === workspaceId,
      );
      if (workspaceId && !workspace) return;
      publish(
        clearProviderSelection({
          ...state,
          targetKind: "new-agent",
          selectedWorkspaceId: workspaceId,
          selectedAgentId: null,
          workspaceDisplay: workspace ? { label: workspace.label } : null,
          conversationDisplay: null,
          workingDir: workspace?.cwd ?? "",
          projectDisplay: null,
          selectedProjectOptionId: "",
        }),
      );
      requestProviderSnapshot(state.selectedServerId, state.workingDir);
    },
    setConversation(agentId) {
      if (closed || state.isHeartbeat || !state.selectedWorkspaceId) return;
      const conversation = state.conversationOptions.find((entry) => entry.id === agentId);
      if (agentId && !conversation) return;
      publish({
        ...state,
        targetKind: agentId ? "agent" : "new-agent",
        selectedAgentId: agentId,
        conversationDisplay: conversation ? { label: conversation.label } : null,
        providerSnapshotRequest: null,
      });
      if (!agentId) requestProviderSnapshot(state.selectedServerId, state.workingDir);
    },
    applyPreferences(nextPreferences) {
      const normalizedPreferences = nextPreferences ?? null;
      if (closed || preferences === normalizedPreferences) {
        return;
      }
      preferences = normalizedPreferences;
      seedThinkingDrafts(thinkingDrafts, preferences);
      publish(resolvePreferences(state));
    },
    applyProviderSnapshot(serverId, providerSnapshot) {
      if (closed || state.selectedServerId !== serverId) {
        return;
      }
      providerEntries = providerSnapshot.entries;
      canonicalizeThinkingDrafts(thinkingDrafts, providerEntries);
      const isPendingResolution = state.providerSnapshotRequest?.serverId === serverId;
      const resolved =
        state.targetKind === "new-agent"
          ? resolveSnapshotSelection({
              state,
              snapshot,
              initialValues,
              preferences: preferencesForSnapshotResolution(snapshot, preferences),
              providerEntries,
              userModified,
            })
          : state;
      const providerResolutionByServerId: Record<string, ProviderResolutionStatus> = {
        ...state.providerResolutionByServerId,
      };
      if (isPendingResolution) {
        providerResolutionByServerId[serverId] = "complete";
      }
      publish({
        ...resolved,
        modelSelectorProviders: buildSelectableProviderSelectorProviders(providerEntries),
        providerResolutionByServerId,
        providerSnapshotRequest: isPendingResolution ? null : state.providerSnapshotRequest,
      });
    },
    setHost(serverId) {
      if (closed || state.selectedServerId === serverId) {
        return;
      }
      publish(
        clearProviderSelection({
          ...state,
          selectedServerId: serverId,
          targetKind: "new-agent",
          selectedWorkspaceId: null,
          selectedAgentId: null,
          workspaceDisplay: null,
          conversationDisplay: null,
          selectedRole: null,
          systemPrompt: undefined,
          featureValues: undefined,
          workingDir: "",
          projectDisplay: null,
          selectedProjectOptionId: "",
          providerResolutionByServerId: {},
        }),
      );
    },
    setProject(optionId, display) {
      if (closed) {
        return;
      }
      const withoutProject = optionId === NO_PROJECT_OPTION_ID;
      if (withoutProject && !state.supportsProjectlessTargets) return;
      const target = withoutProject
        ? { serverId: state.selectedServerId, cwd: "~", optionId: NO_PROJECT_OPTION_ID }
        : findProjectTargetByOptionId(projectTargets, optionId);
      if (!target?.serverId) {
        return;
      }
      const providerScopeChanged =
        state.selectedServerId !== target.serverId || state.workingDir !== target.cwd;
      if (!providerScopeChanged && state.selectedProjectOptionId === target.optionId) {
        return;
      }
      const nextState = {
        ...state,
        selectedServerId: target.serverId,
        workingDir: target.cwd,
        projectDisplay: display,
        selectedProjectOptionId: target.optionId,
        ...(state.selectedServerId !== target.serverId
          ? { selectedRole: null, systemPrompt: undefined, featureValues: undefined }
          : {}),
      };
      publish(providerScopeChanged ? clearProviderSelection(nextState) : nextState);
      if (!providerScopeChanged) {
        return;
      }
      requestProviderSnapshot(target.serverId, target.cwd);
    },
    setModel(provider, modelId) {
      if (closed) {
        return;
      }
      const selectedModel = pickModelForProvider({ entries: providerEntries, provider, modelId });
      const availableModels = resolveAvailableModels(providerEntries, provider);
      const selectedThinkingOptionId = resolveThinkingOptionId({
        availableModels,
        modelId: selectedModel,
        requestedThinkingOptionId:
          thinkingDrafts.get(thinkingDraftKey(provider, selectedModel)) ?? "",
      });
      if (selectedModel && selectedThinkingOptionId) {
        thinkingDrafts.set(thinkingDraftKey(provider, selectedModel), selectedThinkingOptionId);
      }
      userModified = {
        ...userModified,
        provider: true,
        model: true,
        modeId: true,
        thinkingOptionId: true,
      };
      publish({
        ...state,
        selectedProvider: provider,
        selectedModel,
        selectedMode: pickModeForProvider({
          entries: providerEntries,
          provider,
          currentProvider: state.selectedProvider,
          currentMode: state.selectedMode,
        }),
        selectedThinkingOptionId,
        featureValues: state.selectedProvider === provider ? state.featureValues : undefined,
      });
    },
    setRole(role) {
      if (closed || state.targetKind !== "new-agent") return;
      if (!role && !state.selectedRole) return;
      publish({
        ...state,
        selectedRole: role ? toAgentRoleSnapshot(role) : null,
        systemPrompt: role?.instructions,
      });
    },
    applyProfile(profile) {
      if (closed || state.targetKind !== "new-agent") return;
      const modelId = profile.modelId || state.selectedModel;
      userModified = {
        ...userModified,
        provider: true,
        model: true,
        modeId: true,
        thinkingOptionId: true,
      };
      publish({
        ...state,
        selectedProvider: profile.provider,
        selectedModel: pickModelForProvider({
          entries: providerEntries,
          provider: profile.provider,
          modelId,
        }),
        selectedMode: profile.modeId,
        selectedThinkingOptionId: profile.thinkingOptionId,
        featureValues: profile.featureValues,
      });
    },
    setThinking(thinkingOptionId) {
      if (closed) {
        return;
      }
      if (state.selectedProvider && state.selectedModel) {
        thinkingDrafts.set(
          thinkingDraftKey(state.selectedProvider, state.selectedModel),
          thinkingOptionId,
        );
      }
      userModified = { ...userModified, thinkingOptionId: true };
      publish({ ...state, selectedThinkingOptionId: thinkingOptionId });
    },
    setSessionMode(modeId) {
      if (closed) {
        return;
      }
      userModified = { ...userModified, modeId: true };
      publish({ ...state, selectedMode: modeId });
    },
    setName(value) {
      publish({ ...state, name: value });
    },
    setPrompt(value) {
      publish({ ...state, prompt: value });
    },
    setMaxRuns(value) {
      publish({ ...state, maxRuns: value });
    },
    setCadence(value) {
      const cadence = normalizeScheduleFormCadence(value, timezone);
      publish({ ...state, cadence, submitCadence: cadence });
    },
    setIsolation(value) {
      userModified = { ...userModified, isolation: true };
      publish({ ...state, isolation: value });
    },
    setArchiveOnFinish(value) {
      publish({ ...state, archiveOnFinish: value });
    },
    setSubmitError(value) {
      publish({ ...state, submitError: value });
    },
  };
}
