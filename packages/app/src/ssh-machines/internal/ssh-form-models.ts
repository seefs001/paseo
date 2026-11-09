import type {
  SshEffectiveRouting,
  SshMachine,
  SshWorkspaceRoutingOverride,
} from "@getpaseo/protocol/ssh-workspaces";

// Non-React form models for SSH machines (see docs/forms.md). Each form owns its draft,
// validation, busy state and submit error; components subscribe and render. Submits go
// through an injected function so the daemon stays the only authority.

type Listener = () => void;

interface Store<S> {
  getState: () => S;
  subscribe: (listener: Listener) => () => void;
  close: () => void;
  update: (patch: Partial<S>) => void;
  isClosed: () => boolean;
}

function createStore<S>(initial: S): Store<S> {
  let state = initial;
  let closed = false;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
    update: (patch) => {
      if (closed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    isClosed: () => closed,
  };
}

export type SshFormStatus = "idle" | "submitting";

export interface SshFormError {
  field: string | null;
  // i18n key for validation errors, or a daemon message for submit errors.
  messageKey?: string;
  message?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------
// Machine connection form (add, or edit before any workspace uses the machine)

export interface SshMachineFormValues {
  host: string;
  displayName: string;
  user: string;
  port: string;
}

export interface SshMachineFormState {
  values: SshMachineFormValues;
  status: SshFormStatus;
  errors: SshFormError[];
  canSubmit: boolean;
}

export interface SshMachineSaveInput {
  machineId?: string;
  displayName: string;
  target: { host: string; user: string | null; port: number | null };
}

export interface SshMachineFormModel {
  getState: () => SshMachineFormState;
  subscribe: (listener: Listener) => () => void;
  close: () => void;
  isClosed: () => boolean;
  setField: (field: keyof SshMachineFormValues, value: string) => void;
  submit: () => Promise<SshMachine | null>;
}

const HOST_PATTERN = /^[A-Za-z0-9._:@%[\]-]+$/;

function validateMachine(values: SshMachineFormValues): SshFormError[] {
  const errors: SshFormError[] = [];
  const host = values.host.trim();
  if (!host) errors.push({ field: "host", messageKey: "sshMachines.errors.hostRequired" });
  else if (!HOST_PATTERN.test(host) || host.startsWith("-")) {
    errors.push({ field: "host", messageKey: "sshMachines.errors.hostInvalid" });
  }
  if (values.user.trim().startsWith("-") || /\s/.test(values.user.trim())) {
    errors.push({ field: "user", messageKey: "sshMachines.errors.userInvalid" });
  }
  const port = values.port.trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
    errors.push({ field: "port", messageKey: "sshMachines.invalidPort" });
  }
  return errors;
}

export function openSshMachineForm(input: {
  machine?: SshMachine;
  save: (input: SshMachineSaveInput) => Promise<SshMachine>;
}): SshMachineFormModel {
  const target = input.machine?.target;
  const values: SshMachineFormValues = {
    host: target?.host ?? "",
    displayName: input.machine?.displayName ?? "",
    user: target?.user ?? "",
    port: target?.port ? String(target.port) : "",
  };
  const store = createStore<SshMachineFormState>({
    values,
    status: "idle",
    errors: [],
    canSubmit: validateMachine(values).length === 0,
  });
  // Errors show for fields the user changed, so an invalid value explains why saving is off.
  let touched = false;
  const touchedFields = new Set<string>();
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    close: store.close,
    isClosed: store.isClosed,
    setField: (field, value) => {
      touchedFields.add(field);
      const next = { ...store.getState().values, [field]: value };
      const errors = validateMachine(next);
      store.update({
        values: next,
        errors: touched
          ? errors
          : errors.filter((error) => error.field !== null && touchedFields.has(error.field)),
        canSubmit: errors.length === 0,
      });
    },
    submit: async () => {
      const state = store.getState();
      if (state.status === "submitting") return null;
      touched = true;
      const errors = validateMachine(state.values);
      if (errors.length > 0) {
        store.update({ errors, canSubmit: false });
        return null;
      }
      store.update({ status: "submitting", errors: [] });
      const port = state.values.port.trim();
      try {
        const machine = await input.save({
          ...(input.machine ? { machineId: input.machine.machineId } : {}),
          displayName: state.values.displayName.trim(),
          target: {
            host: state.values.host.trim(),
            user: state.values.user.trim() || null,
            port: port ? Number(port) : null,
          },
        });
        store.update({ status: "idle" });
        return machine;
      } catch (error) {
        store.update({ status: "idle", errors: [{ field: null, message: errorMessage(error) }] });
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// Tool routing form, for a machine default or a workspace override

export type SshRoutingField = "localTools" | "disabledTools" | "localMcpServers";

export interface SshRoutingFormState {
  scope: "machine" | "workspace";
  // Text drafts of tool lists. For a workspace, `inherit[field]` true means the machine
  // default applies and the draft is ignored.
  drafts: Record<SshRoutingField, string>;
  localSkills: boolean;
  inherit: Record<SshRoutingField | "localSkills", boolean>;
  expectedRevision: number;
  status: SshFormStatus;
  errors: SshFormError[];
  dirty: boolean;
  // The daemon moved on; the draft was not saved and must be reloaded.
  stale: boolean;
  // Changes whenever the form replaces its values, so inputs remount with them.
  resetKey: number;
}

export interface SshRoutingValues {
  localTools: string[] | null;
  disabledTools: string[] | null;
  localSkills: boolean | null;
  localMcpServers: string[] | null;
}

export interface SshRoutingFormModel {
  getState: () => SshRoutingFormState;
  subscribe: (listener: Listener) => () => void;
  close: () => void;
  setDraft: (field: SshRoutingField, value: string) => void;
  setLocalSkills: (value: boolean) => void;
  setInherit: (field: SshRoutingField | "localSkills", value: boolean) => void;
  // Replace the baseline with the daemon's current values; drops unsaved edits.
  reload: (baseline: SshRoutingBaseline) => void;
  submit: () => Promise<boolean>;
}

export type SshRoutingBaseline =
  | {
      scope: "machine";
      revision: number;
      localTools: string[];
      disabledTools: string[];
      localSkills: boolean;
      localMcpServers: string[];
    }
  | {
      scope: "workspace";
      override: SshWorkspaceRoutingOverride | null;
      effective: SshEffectiveRouting;
    };

// Bash, grep, find and file tools always run on the machine.
const REMOTE_BUILTINS = new Set(["read", "write", "edit", "bash", "ls", "find", "grep"]);
const TOOL_NAME = /^[A-Za-z0-9_.:-]+$/;

export function splitToolNames(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function routingInitial(
  baseline: SshRoutingBaseline,
): Omit<SshRoutingFormState, "status" | "resetKey"> {
  if (baseline.scope === "machine") {
    return {
      scope: "machine",
      drafts: {
        localTools: baseline.localTools.join(", "),
        disabledTools: baseline.disabledTools.join(", "),
        localMcpServers: baseline.localMcpServers.join(", "),
      },
      localSkills: baseline.localSkills,
      inherit: {
        localTools: false,
        disabledTools: false,
        localMcpServers: false,
        localSkills: false,
      },
      expectedRevision: baseline.revision,
      errors: [],
      dirty: false,
      stale: false,
    };
  }
  const { override, effective } = baseline;
  return {
    scope: "workspace",
    drafts: {
      localTools: effective.localTools.join(", "),
      disabledTools: effective.disabledTools.join(", "),
      localMcpServers: effective.localMcpServers.join(", "),
    },
    localSkills: effective.localSkills,
    inherit: {
      localTools: override?.localTools == null,
      disabledTools: override?.disabledTools == null,
      localMcpServers: override?.localMcpServers == null,
      localSkills: override?.localSkills == null,
    },
    expectedRevision: override?.revision ?? 0,
    errors: [],
    dirty: false,
    stale: false,
  };
}

function validateRouting(state: SshRoutingFormState): SshFormError[] {
  const errors: SshFormError[] = [];
  const active = (field: SshRoutingField) => state.scope === "machine" || !state.inherit[field];
  for (const field of ["localTools", "disabledTools", "localMcpServers"] as const) {
    if (!active(field)) continue;
    const names = splitToolNames(state.drafts[field]);
    if (names.some((name) => !TOOL_NAME.test(name))) {
      errors.push({ field, messageKey: "sshMachines.errors.toolNameInvalid" });
    }
  }
  if (active("localTools")) {
    const builtins = splitToolNames(state.drafts.localTools).filter((name) =>
      REMOTE_BUILTINS.has(name),
    );
    if (builtins.length > 0) {
      errors.push({ field: "localTools", messageKey: "sshMachines.errors.remoteBuiltinLocal" });
    }
  }
  return errors;
}

export function openSshRoutingForm(input: {
  baseline: SshRoutingBaseline;
  save: (values: SshRoutingValues & { expectedRevision: number }) => Promise<SshRoutingBaseline>;
  isConflict?: (error: unknown) => boolean;
}): SshRoutingFormModel {
  const store = createStore<SshRoutingFormState>({
    ...routingInitial(input.baseline),
    status: "idle",
    resetKey: 0,
  });
  const replace = (baseline: SshRoutingBaseline) =>
    store.update({
      ...routingInitial(baseline),
      status: "idle",
      resetKey: store.getState().resetKey + 1,
    });
  const edit = (patch: Partial<SshRoutingFormState>) => {
    const next = { ...store.getState(), ...patch, dirty: true };
    store.update({ ...patch, dirty: true, errors: validateRouting(next) });
  };
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    close: store.close,
    setDraft: (field, value) => edit({ drafts: { ...store.getState().drafts, [field]: value } }),
    setLocalSkills: (value) => edit({ localSkills: value }),
    setInherit: (field, value) =>
      edit({ inherit: { ...store.getState().inherit, [field]: value } }),
    reload: replace,
    submit: async () => {
      const state = store.getState();
      if (state.status === "submitting") return false;
      const errors = validateRouting(state);
      if (errors.length > 0) {
        store.update({ errors });
        return false;
      }
      const pick = (field: SshRoutingField) =>
        state.scope === "workspace" && state.inherit[field]
          ? null
          : splitToolNames(state.drafts[field]);
      store.update({ status: "submitting", errors: [] });
      try {
        const saved = await input.save({
          expectedRevision: state.expectedRevision,
          localTools: pick("localTools"),
          disabledTools: pick("disabledTools"),
          localMcpServers: pick("localMcpServers"),
          localSkills:
            state.scope === "workspace" && state.inherit.localSkills ? null : state.localSkills,
        });
        if (store.isClosed()) return true;
        replace(saved);
        return true;
      } catch (error) {
        store.update({
          status: "idle",
          stale: input.isConflict?.(error) ?? false,
          errors: [{ field: null, message: errorMessage(error) }],
        });
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// New SSH workspace

export interface SshWorkspaceFormState {
  directory: string;
  status: SshFormStatus;
  errors: SshFormError[];
  canSubmit: boolean;
}

export interface SshWorkspaceFormModel {
  getState: () => SshWorkspaceFormState;
  subscribe: (listener: Listener) => () => void;
  close: () => void;
  isClosed: () => boolean;
  setDirectory: (value: string) => void;
  submit: () => Promise<{ workspaceId: string } | null>;
}

export function openSshWorkspaceForm(input: {
  create: (directory: string) => Promise<{ workspaceId: string }>;
}): SshWorkspaceFormModel {
  const store = createStore<SshWorkspaceFormState>({
    directory: "",
    status: "idle",
    errors: [],
    canSubmit: false,
  });
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    close: store.close,
    isClosed: store.isClosed,
    setDirectory: (value) =>
      store.update({ directory: value, errors: [], canSubmit: value.trim().length > 0 }),
    submit: async () => {
      const state = store.getState();
      if (state.status === "submitting") return null;
      if (!state.directory.trim()) {
        store.update({
          errors: [{ field: "directory", messageKey: "sshMachines.errors.directoryRequired" }],
        });
        return null;
      }
      store.update({ status: "submitting", errors: [] });
      try {
        const result = await input.create(state.directory.trim());
        store.update({ status: "idle" });
        return result;
      } catch (error) {
        store.update({ status: "idle", errors: [{ field: null, message: errorMessage(error) }] });
        return null;
      }
    },
  };
}
