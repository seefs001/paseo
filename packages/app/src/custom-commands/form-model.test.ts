import { describe, expect, it } from "vitest";
import { openCustomCommandForm } from "./form-model";
import { CustomCommandValidationError, upsertCustomCommand, type CustomCommand } from "./model";

function commandStore(initial: CustomCommand[] = []) {
  let commands = initial;
  let fail = false;
  return {
    get commands() {
      return commands;
    },
    setFailure(value: boolean) {
      fail = value;
    },
    async save(command: CustomCommand) {
      if (fail) throw new Error("Storage unavailable");
      commands = upsertCustomCommand({ command, commands });
    },
  };
}

const existing: CustomCommand = {
  id: "existing",
  name: "review",
  description: "Review changes",
  prompt: "Review the diff",
  autoSend: true,
};

describe("custom command form", () => {
  it("opens fresh create fields with auto-send off and saves a normalized Chinese name", async () => {
    const store = commandStore();
    const model = openCustomCommandForm({
      command: null,
      commands: [],
      createId: () => "new-id",
      save: store.save,
    });
    expect(model.getState()).toEqual({
      command: { id: "new-id", name: "", description: "", prompt: "", autoSend: false },
      errors: {},
      canSubmit: false,
      submission: { status: "idle" },
    });
    model.setName(" /检查 ");
    model.setPrompt("检查代码\n保留格式");
    expect(await model.submit()).toBe(true);
    expect(store.commands).toEqual([
      {
        id: "new-id",
        name: "检查",
        description: "",
        prompt: "检查代码\n保留格式",
        autoSend: false,
      },
    ]);
    expect(model.getState().submission).toEqual({ status: "saved" });
  });

  it("seeds every field from an edit snapshot and keeps the same id after a rename", async () => {
    const store = commandStore([existing]);
    const model = openCustomCommandForm({
      command: existing,
      commands: store.commands,
      createId: () => "unused",
      save: store.save,
    });
    expect(model.getState().command).toEqual(existing);
    model.setName("review-tests");
    model.setDescription("Tests only");
    model.setPrompt("Review the tests");
    model.setAutoSend(false);
    expect(await model.submit()).toBe(true);
    expect(store.commands).toEqual([
      {
        id: "existing",
        name: "review-tests",
        description: "Tests only",
        prompt: "Review the tests",
        autoSend: false,
      },
    ]);
    const fresh = openCustomCommandForm({
      command: null,
      commands: store.commands,
      createId: () => "fresh",
      save: store.save,
    });
    expect(fresh.getState().command).toEqual({
      id: "fresh",
      name: "",
      description: "",
      prompt: "",
      autoSend: false,
    });
  });

  it("shows field errors and never saves an invalid or duplicate command", async () => {
    const store = commandStore([existing]);
    const model = openCustomCommandForm({
      command: null,
      commands: store.commands,
      createId: () => "new",
      save: store.save,
    });
    model.setName("SHARE");
    expect(model.getState().errors).toEqual({ name: "nameReserved" });
    model.setName("review");
    expect(await model.submit()).toBe(false);
    expect(model.getState().errors).toEqual({ name: "nameDuplicate", prompt: "promptRequired" });
    expect(store.commands).toEqual([existing]);
  });

  it("applies command-list updates without resetting in-progress edits", () => {
    const store = commandStore();
    const model = openCustomCommandForm({
      command: null,
      commands: [],
      createId: () => "new",
      save: store.save,
    });
    model.setName("review");
    model.setPrompt("Unsaved prompt");
    model.applyCommands([existing]);
    expect(model.getState()).toMatchObject({
      command: { id: "new", name: "review", prompt: "Unsaved prompt" },
      errors: { name: "nameDuplicate" },
      canSubmit: false,
    });
  });

  it("keeps failed edits and the stable id so the user can retry saving", async () => {
    const store = commandStore();
    store.setFailure(true);
    const model = openCustomCommandForm({
      command: null,
      commands: [],
      createId: () => "new",
      save: store.save,
    });
    model.setName("review");
    model.setPrompt("Review the changes");
    expect(await model.submit()).toBe(false);
    expect(model.getState()).toMatchObject({
      command: { id: "new", name: "review", prompt: "Review the changes" },
      canSubmit: true,
      submission: { status: "error" },
    });
    expect(store.commands).toEqual([]);
    store.setFailure(false);
    expect(await model.submit()).toBe(true);
    expect(store.commands).toEqual([
      { id: "new", name: "review", description: "", prompt: "Review the changes", autoSend: false },
    ]);
  });

  it("prevents duplicate submissions and edits while storage is pending", async () => {
    const written: CustomCommand[] = [];
    let complete = () => {};
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const model = openCustomCommandForm({
      command: existing,
      commands: [existing],
      createId: () => "unused",
      save: async (command) => {
        await pending;
        written.push(command);
      },
    });
    const submission = model.submit();
    expect(model.getState().submission).toEqual({ status: "saving" });
    expect(model.getState().canSubmit).toBe(false);
    model.setPrompt("Do not change while saving");
    expect(await model.submit()).toBe(false);
    complete();
    expect(await submission).toBe(true);
    expect(written).toEqual([existing]);
  });

  it("shows a duplicate discovered at save time as a field error rather than a storage error", async () => {
    const model = openCustomCommandForm({
      command: existing,
      commands: [],
      createId: () => "unused",
      save: async () => {
        throw new CustomCommandValidationError({ name: "nameDuplicate" });
      },
    });
    expect(await model.submit()).toBe(false);
    expect(model.getState()).toMatchObject({
      errors: { name: "nameDuplicate" },
      canSubmit: false,
      submission: { status: "idle" },
    });
  });
});
