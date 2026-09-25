import { expect, it, vi } from "vitest";
import type { z } from "zod";
import { SessionTitles, InvalidSessionTitlesError } from "./session-titles.js";

it("previews bounded conversation excerpts using the naming instructions without renaming sessions", async () => {
  const apply = vi.fn();
  const prompts: string[] = [];
  const service = new SessionTitles(
    {
      readSessionTitleContext: async (_workspaceId, agentId) => {
        if (agentId === "gone") return null;
        return {
          agentId,
          title: "Old",
          cwd: "/repo",
          excerpt: agentId === "empty" ? "" : "user_message: Fix sorting",
        };
      },
      applySessionTitle: apply,
    },
    {
      async generate<T>(input: { prompt: string; schema: z.ZodType<T> }): Promise<T> {
        prompts.push(input.prompt);
        return input.schema.parse({ titles: [{ agentId: "a", title: "Fix session sorting" }] });
      },
    },
  );
  const result = await service.preview({
    workspaceId: "ws",
    agentIds: ["a", "a", "empty", "gone"],
    prompt: "Use concrete task names",
  });
  expect(result).toEqual({
    proposals: [{ agentId: "a", previousTitle: "Old", title: "Fix session sorting" }],
    skipped: [
      { agentId: "empty", reason: "empty" },
      { agentId: "gone", reason: "missing" },
    ],
  });
  expect(prompts[0]).toContain("Use concrete task names");
  expect(prompts[0]).toContain("Fix sorting");
  expect(apply).not.toHaveBeenCalled();
});

it("rejects mismatched generated IDs and reports partial apply failures", async () => {
  const service = new SessionTitles(
    {
      readSessionTitleContext: async (_ws, agentId) => ({
        agentId,
        title: "Old",
        cwd: "/repo",
        excerpt: "Fix sorting",
      }),
      applySessionTitle: async (_ws, proposal) => {
        if (proposal.agentId === "b") throw new Error("disk full");
        return { agentId: proposal.agentId, status: "conflict" };
      },
    },
    {
      async generate<T>({ schema }: { schema: z.ZodType<T> }): Promise<T> {
        return schema.parse({ titles: [{ agentId: "wrong", title: "Wrong" }] });
      },
    },
  );
  await expect(
    service.preview({ workspaceId: "ws", agentIds: ["a"], prompt: "Name it" }),
  ).rejects.toBeInstanceOf(InvalidSessionTitlesError);
  expect(
    await service.apply(
      "ws",
      ["a", "b"].map((agentId) => ({ agentId, previousTitle: "Old", title: "New" })),
    ),
  ).toEqual([
    { agentId: "a", status: "conflict" },
    { agentId: "b", status: "failed" },
  ]);
});

it("bounds a large batch's conversation context before calling the model", async () => {
  const agentIds = Array.from({ length: 100 }, (_, index) => `session-${index}`);
  const service = new SessionTitles(
    {
      readSessionTitleContext: async (_ws, agentId) => ({
        agentId,
        title: "Old",
        cwd: "/repo",
        excerpt: "x".repeat(3600),
      }),
      applySessionTitle: async (_ws, proposal) => ({
        agentId: proposal.agentId,
        status: "applied",
      }),
    },
    {
      async generate<T>({ prompt, schema }: { prompt: string; schema: z.ZodType<T> }): Promise<T> {
        expect(prompt.length).toBeLessThan(65_000);
        return schema.parse({
          titles: agentIds.map((agentId) => ({ agentId, title: "Task title" })),
        });
      },
    },
  );
  expect(
    (await service.preview({ workspaceId: "ws", agentIds, prompt: "Name the tasks" })).proposals,
  ).toHaveLength(100);
});
