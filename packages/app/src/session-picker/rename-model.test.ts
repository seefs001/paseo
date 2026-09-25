import { expect, it, vi } from "vitest";
import { openRenameForm } from "./rename-model";

function setup() {
  const preview = vi.fn(async () => ({
    proposals: [
      { agentId: "a", previousTitle: "Old A", title: "New A" },
      { agentId: "b", previousTitle: "Old B", title: "New B" },
    ],
    skipped: [],
  }));
  const apply = vi.fn(async () => [{ agentId: "a", status: "applied" as const }]);
  const savePrompt = vi.fn(async () => undefined);
  return {
    preview,
    apply,
    savePrompt,
    model: openRenameForm({
      prompt: "Name the task",
      preview,
      apply,
      savePrompt,
      invalidPrompt: "prompt required",
      invalidTitle: "invalid title",
      failed: "failed",
    }),
  };
}

it("saves the custom prompt, previews without applying, and applies only selected edited titles", async () => {
  const { model, preview, apply, savePrompt } = setup();
  model.setPrompt("Use Chinese task names");
  await model.generate();
  expect(savePrompt).toHaveBeenCalledWith("Use Chinese task names");
  expect(preview).toHaveBeenCalledWith("Use Chinese task names");
  expect(apply).not.toHaveBeenCalled();
  model.toggle("b");
  model.editTitle("a", "用户修改的名称");
  await model.apply();
  expect(apply).toHaveBeenCalledExactlyOnceWith([
    { agentId: "a", previousTitle: "Old A", title: "用户修改的名称" },
  ]);
  await model.apply();
  expect(apply).toHaveBeenCalledOnce();
});

it("ignores late generation after closing and refuses invalid state transitions", async () => {
  const { model, apply } = setup();
  await model.apply();
  expect(apply).not.toHaveBeenCalled();
  const generating = model.generate();
  expect(model.close()).toBe(true);
  await generating;
  expect(model.getState()).toEqual({ phase: "closed" });
});

it("invalidates a preview when the instructions change and blocks blank titles", async () => {
  const { model, apply } = setup();
  await model.generate();
  model.editTitle("a", " ");
  await model.apply();
  expect(apply).not.toHaveBeenCalled();
  expect(model.getState()).toMatchObject({ phase: "preview", error: "invalid title" });
  model.setPrompt("different instructions");
  expect(model.getState()).toMatchObject({ phase: "editing" });
  await model.apply();
  expect(apply).not.toHaveBeenCalled();
});
