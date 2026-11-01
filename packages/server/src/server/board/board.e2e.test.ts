import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const AGENT = { kind: "config" as const, provider: "codex" };

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function git(cwd: string, args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "pipe" },
  );
}

async function initializeRepository(directory: string): Promise<void> {
  execFileSync("git", ["init", "-b", "main", directory], { stdio: "pipe" });
  await writeFile(join(directory, "README.md"), "board\n");
  git(directory, ["add", "README.md"]);
  git(directory, ["commit", "-m", "initial"]);
}

async function startBoardDaemon() {
  const prompts: string[] = [];
  const agentClients = createTestAgentClients({
    onStartTurn: (prompt, config) => {
      if (!config.internal) prompts.push(promptText(prompt));
    },
  });
  const daemon = await createTestPaseoDaemon({
    agentClients,
    // Installed provider CLIs must not change when background naming starts.
    providerOverrides: Object.fromEntries(
      BUILTIN_PROVIDER_IDS.map((id) => [id, { enabled: id in agentClients }]),
    ),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  const readBoard = async () => {
    const subscription = client.observeBoardTasks();
    const snapshot = await subscription.ready;
    await subscription.release();
    return snapshot;
  };
  return { daemon, client, prompts, readBoard };
}

test("Board tasks start on the daemon in blocker order and subtasks branch off their parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-e2e-"));
  const { daemon, client, prompts, readBoard } = await startBoardDaemon();
  const readTask = async (taskId: string) =>
    (await readBoard()).tasks.find((task) => task.id === taskId);
  try {
    await initializeRepository(directory);
    await client.connect();
    const projectId = (await client.addProject(directory)).project?.projectId;
    if (!projectId) throw new Error("Expected a project");

    const first = await client.createBoardTask({
      title: "Add the export button",
      notes: "Put it next to the share button.",
      projectId,
      acceptanceCriteria: [
        { text: "The button downloads a CSV", met: false },
        { text: "The settings page is unchanged", met: true },
      ],
    });
    expect(first.stage).toBe("fog");
    const blocked = await client.createBoardTask({
      title: "Document the export",
      projectId,
      blockedBy: [first.id],
    });

    await expect(
      client.startBoardTask({ taskId: blocked.id, isolation: "local", agent: AGENT }),
    ).rejects.toMatchObject({ code: "task_blocked" });

    const started = await client.startBoardTask({
      taskId: first.id,
      isolation: "local",
      agent: AGENT,
    });
    expect(started.task.workspaceId).toBe(started.workspaceId);
    expect((await client.waitForFinish(started.agentId, 30000)).status).toBe("idle");
    expect(prompts[0]).toContain("Add the export button");
    expect(prompts[0]).toContain("Put it next to the share button.");
    expect(prompts[0]).toContain(
      "- [ ] The button downloads a CSV\n- [x] The settings page is unchanged",
    );
    expect(prompts[0]).toContain("update_board_task");

    await client.archiveWorkspace(started.workspaceId);
    await expect.poll(async () => (await readTask(first.id))?.completedAt ?? null).not.toBeNull();

    const unblocked = await client.startBoardTask({
      taskId: blocked.id,
      isolation: "local",
      agent: AGENT,
    });
    expect((await client.waitForFinish(unblocked.agentId, 30000)).status).toBe("idle");
    expect(prompts[1]).toBe("Document the export");

    const plan = await client.createBoardTask({ title: "Plan the importer", projectId });
    const planStart = await client.startBoardTask({
      taskId: plan.id,
      isolation: "worktree",
      agent: AGENT,
    });
    const planCwd = (await client.fetchAgent(planStart.agentId))?.agent.cwd;
    if (!planCwd) throw new Error("Expected the plan agent's worktree");
    await writeFile(join(planCwd, "plan.md"), "integration\n");
    git(planCwd, ["add", "plan.md"]);
    git(planCwd, ["commit", "-m", "plan"]);

    const subtask = await client.createBoardTask({
      title: "Parse the import file",
      projectId,
      parentId: plan.id,
    });
    const subtaskStart = await client.startBoardTask({
      taskId: subtask.id,
      isolation: "worktree",
      agent: AGENT,
    });
    const subtaskCwd = (await client.fetchAgent(subtaskStart.agentId))?.agent.cwd;
    if (!subtaskCwd) throw new Error("Expected the subtask agent's worktree");
    expect(subtaskCwd).not.toBe(planCwd);
    expect(existsSync(join(subtaskCwd, "plan.md"))).toBe(true);
  } finally {
    await client.close();
    await daemon.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 120000);

test("goal Autopilot with confirmStarts asks before starting a ready task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-e2e-"));
  const { daemon, client, prompts, readBoard } = await startBoardDaemon();
  try {
    await initializeRepository(directory);
    await client.connect();
    const projectId = (await client.addProject(directory)).project?.projectId;
    if (!projectId) throw new Error("Expected a project");

    const goal = await client.createBoardGoal({ title: "Ship the importer" });
    expect(goal.number).toBe(1);
    const ready = await client.createBoardTask({
      title: "Parse the import file",
      projectId,
      goalId: goal.id,
      stage: "ready",
    });
    await client.createBoardTask({ title: "Maybe a preview", projectId, goalId: goal.id });
    await expect(
      client.createBoardTask({ title: "Lost", projectId, goalId: "gol_missing" }),
    ).rejects.toMatchObject({ code: "goal_not_found" });

    await client.updateBoardGoal({
      goalId: goal.id,
      autopilot: {
        enabled: true,
        agent: AGENT,
        isolation: "local",
        maxActive: 2,
        dailyStartLimit: 5,
        confirmStarts: true,
      },
    });

    // Only the ready task is proposed; the Fog task is never asked about.
    await expect
      .poll(async () => (await readBoard()).decisions.filter((d) => d.resolvedAt === null).length)
      .toBe(1);
    const [question] = (await readBoard()).decisions;
    expect(question).toMatchObject({ kind: "autopilot_start", goalId: goal.id, taskId: ready.id });
    expect((await readBoard()).tasks.find((task) => task.id === ready.id)?.workspaceId).toBeNull();

    const resolved = await client.resolveBoardDecision({
      decisionId: question.id,
      choiceId: "start",
    });
    expect(resolved.choiceId).toBe("start");
    const board = await readBoard();
    expect(board.tasks.find((task) => task.id === ready.id)?.workspaceId).not.toBeNull();
    expect(board.goals.find((candidate) => candidate.id === goal.id)?.startsToday).toBe(1);
    await expect.poll(() => prompts[0]).toBe("Parse the import file");
    expect(board.decisions.filter((decision) => decision.resolvedAt === null)).toHaveLength(0);
  } finally {
    await client.close();
    await daemon.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}, 120000);
