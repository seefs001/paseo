import {
  CustomCommandValidationError,
  normalizeCustomCommandName,
  validateCustomCommand,
  type CustomCommand,
  type CustomCommandErrors,
} from "./model";

export type CustomCommandSubmission =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error" };

export interface CustomCommandFormState {
  command: CustomCommand;
  errors: CustomCommandErrors;
  canSubmit: boolean;
  submission: CustomCommandSubmission;
}

export interface CustomCommandFormSnapshot {
  command: CustomCommand | null;
  commands: readonly CustomCommand[];
  createId(): string;
  save(command: CustomCommand): Promise<void>;
}

export interface CustomCommandFormModel {
  getState(): CustomCommandFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  applyCommands(commands: readonly CustomCommand[]): void;
  setName(name: string): void;
  setDescription(description: string): void;
  setPrompt(prompt: string): void;
  setAutoSend(autoSend: boolean): void;
  submit(): Promise<boolean>;
}

export function openCustomCommandForm(snapshot: CustomCommandFormSnapshot): CustomCommandFormModel {
  const listeners = new Set<() => void>();
  const touched = new Set<"name" | "prompt">();
  let commands = snapshot.commands;
  let command: CustomCommand = snapshot.command
    ? { ...snapshot.command }
    : { id: snapshot.createId(), name: "", description: "", prompt: "", autoSend: false };
  let state: CustomCommandFormState = {
    command,
    errors: {},
    canSubmit: Object.keys(validateCustomCommand({ command, commands })).length === 0,
    submission: { status: "idle" },
  };

  function publish(submission: CustomCommandSubmission) {
    const validation = validateCustomCommand({ command, commands });
    const errors: CustomCommandErrors = {};
    if (touched.has("name") && validation.name) errors.name = validation.name;
    if (touched.has("prompt") && validation.prompt) errors.prompt = validation.prompt;
    const valid = Object.keys(validation).length === 0;
    state = { command, errors, canSubmit: valid && submission.status !== "saving", submission };
    for (const listener of listeners) listener();
  }

  function change(updates: Partial<CustomCommand>) {
    if (state.submission.status === "saving") return;
    command = { ...command, ...updates };
    publish({ status: "idle" });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
    },
    applyCommands(next) {
      commands = next;
      publish(state.submission);
    },
    setName(name) {
      touched.add("name");
      change({ name });
    },
    setDescription(description) {
      change({ description });
    },
    setPrompt(prompt) {
      touched.add("prompt");
      change({ prompt });
    },
    setAutoSend(autoSend) {
      change({ autoSend });
    },
    async submit() {
      if (state.submission.status === "saving") return false;
      touched.add("name");
      touched.add("prompt");
      publish({ status: "idle" });
      if (!state.canSubmit) return false;
      const saved = { ...command, name: normalizeCustomCommandName(command.name) };
      publish({ status: "saving" });
      try {
        await snapshot.save(saved);
        command = saved;
        publish({ status: "saved" });
        return true;
      } catch (error) {
        if (error instanceof CustomCommandValidationError) {
          publish({ status: "idle" });
          state = { ...state, errors: error.fields, canSubmit: false };
          for (const listener of listeners) listener();
        } else {
          publish({ status: "error" });
        }
        return false;
      }
    },
  };
}
