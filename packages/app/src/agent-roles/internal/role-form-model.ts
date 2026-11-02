import type { AgentProfile, AgentRole } from "@getpaseo/protocol/messages";

/**
 * The persisted role minus the id; the list owns identity. Mapped rather than
 * `Omit`ed for the same reason as `AgentProfileValue`: the schema passes
 * unknown keys through, so `Omit` would keep an index signature and lose the
 * required keys.
 */
export type AgentRoleValue = {
  [K in keyof AgentRole as string extends K ? never : K extends "id" ? never : K]: AgentRole[K];
};

export interface AgentRoleFormDisplay {
  label: string;
  description?: string;
}

export interface AgentRoleFormSnapshot {
  mode: "create" | "edit";
  role?: AgentRole;
  /** The host's Agent profiles when the form opened, used to label the default profile. */
  profiles: readonly AgentProfile[];
}

export interface AgentRoleFormState {
  mode: "create" | "edit";
  name: string;
  icon: string;
  color: string;
  description: string;
  instructions: string;
  /** Empty means no default profile. */
  defaultProfileId: string;
  defaultProfileDisplay: AgentRoleFormDisplay | null;
  isSubmitting: boolean;
  submitError: string | null;
  canSubmit: boolean;
  submitValue: AgentRoleValue | null;
}

export interface AgentRoleFormModel {
  getState: () => AgentRoleFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setInstructions: (instructions: string) => void;
  setAppearance: (value: { icon: string; color: string }) => void;
  setDefaultProfile: (profileId: string, display: AgentRoleFormDisplay | null) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setSubmitError: (message: string | null) => void;
}

type EditableState = Omit<AgentRoleFormState, "canSubmit" | "submitValue">;

function seedDefaultProfile(snapshot: AgentRoleFormSnapshot): {
  defaultProfileId: string;
  defaultProfileDisplay: AgentRoleFormDisplay | null;
} {
  const profileId = snapshot.role?.defaultProfileId;
  const profile = profileId ? snapshot.profiles.find((entry) => entry.id === profileId) : null;
  // A removed profile is dropped rather than shown by id: the role can no longer apply it.
  return profile
    ? { defaultProfileId: profile.id, defaultProfileDisplay: { label: profile.name } }
    : { defaultProfileId: "", defaultProfileDisplay: null };
}

function toSubmitValue(state: EditableState): AgentRoleValue | null {
  const name = state.name.trim();
  const instructions = state.instructions.trim();
  if (!name || !instructions) return null;
  const description = state.description.trim();
  return {
    name,
    instructions,
    ...(description ? { description } : {}),
    ...(state.icon ? { icon: state.icon } : {}),
    ...(state.color && state.color !== "none" ? { color: state.color } : {}),
    ...(state.defaultProfileId ? { defaultProfileId: state.defaultProfileId } : {}),
  };
}

function derive(state: EditableState): AgentRoleFormState {
  const submitValue = toSubmitValue(state);
  return { ...state, submitValue, canSubmit: submitValue !== null && !state.isSubmitting };
}

export function openAgentRoleForm(snapshot: AgentRoleFormSnapshot): AgentRoleFormModel {
  const role = snapshot.role;
  let state = derive({
    mode: snapshot.mode,
    name: role?.name ?? "",
    icon: role?.icon ?? "",
    color: role?.color ?? "",
    description: role?.description ?? "",
    instructions: role?.instructions ?? "",
    ...seedDefaultProfile(snapshot),
    isSubmitting: false,
    submitError: null,
  });
  const listeners = new Set<() => void>();
  let closed = false;

  const update = (patch: Partial<EditableState>) => {
    if (closed) return;
    state = derive({ ...state, ...patch });
    for (const listener of listeners) listener();
  };

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
    setName: (name) => update({ name }),
    setDescription: (description) => update({ description }),
    setInstructions: (instructions) => update({ instructions }),
    setAppearance: ({ icon, color }) => update({ icon, color }),
    setDefaultProfile: (defaultProfileId, defaultProfileDisplay) =>
      update({
        defaultProfileId,
        defaultProfileDisplay: defaultProfileId ? defaultProfileDisplay : null,
      }),
    setSubmitting: (isSubmitting) => update({ isSubmitting }),
    setSubmitError: (submitError) => update({ submitError }),
  };
}
