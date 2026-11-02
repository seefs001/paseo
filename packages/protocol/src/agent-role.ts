import { z } from "zod";

/**
 * A named way of working: instructions the daemon writes into a new agent's
 * system prompt, and an optional Agent profile a client preselects with it.
 *
 * A role applies only when an agent is created. Most providers fix the system
 * prompt at creation, so there is no way to give a running agent a role, and
 * later edits to the role do not reach agents that already have it.
 */
export const AgentRoleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** A key into the client's icon registry, shared with Agent profiles. */
    icon: z.string().optional(),
    /** An identity colour name shared with host badges. */
    color: z.string().optional(),
    /** One line on what the role is for, shown in pickers and by `list_roles`. */
    description: z.string().optional(),
    instructions: z.string(),
    /** An Agent profile a client applies when the user picks this role. The daemon never reads it. */
    defaultProfileId: z.string().optional(),
  })
  .passthrough();

export type AgentRole = z.infer<typeof AgentRoleSchema>;

/**
 * What an agent records about the role it was created with, so clients can
 * still name it after the role is renamed or removed. The instructions are not
 * copied: they live in the agent's system prompt.
 */
export const AgentRoleSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export type AgentRoleSnapshot = z.infer<typeof AgentRoleSnapshotSchema>;

/**
 * Used while `agentRoles` is absent from daemon config. The first edit writes
 * the whole list, so from then on the user's copy no longer follows changes
 * here; an empty list means the user removed them all.
 */
export const DEFAULT_AGENT_ROLES: readonly AgentRole[] = [
  {
    id: "planner",
    name: "Planner",
    icon: "compass",
    description: "Reads the code and writes a plan. Does not edit files.",
    instructions: [
      "You are working as a planner.",
      "Read the relevant code before you propose anything.",
      "Write a plan: the goal, the files and modules to change, the order of the steps, the risks, and how to verify each step.",
      "Do not edit files.",
      "Ask for a decision only when the answer changes the plan.",
    ].join("\n"),
  },
  {
    id: "reviewer",
    name: "Reviewer",
    icon: "eye",
    description: "Reviews a change and reports findings. Does not edit files.",
    instructions: [
      "You are working as a reviewer.",
      "Review the change you are given: a diff, a branch, or a set of files.",
      "Report findings in order of severity. Give each one the file and line, the evidence, and a concrete fix.",
      "Keep confirmed problems apart from suspicions.",
      "Do not edit files.",
    ].join("\n"),
  },
  {
    id: "debugger",
    name: "Debugger",
    icon: "bug",
    description: "Reproduces the problem, finds the root cause, then fixes it.",
    instructions: [
      "You are working as a debugger.",
      "Reproduce the problem first and record the exact steps.",
      "Test one hypothesis at a time with the smallest experiment that can disprove it.",
      "Find the root cause before you change code. Then fix it and show that the reproduction now passes.",
    ].join("\n"),
  },
];

export function resolveAgentRoles(roles: readonly AgentRole[] | undefined): readonly AgentRole[] {
  return roles ?? DEFAULT_AGENT_ROLES;
}

/** Matches the id first, then the name, the same way agents address Agent profiles. */
export function findAgentRole(
  roles: readonly AgentRole[],
  idOrName: string,
): AgentRole | undefined {
  return roles.find((role) => role.id === idOrName) ?? roles.find((role) => role.name === idOrName);
}

export function toAgentRoleSnapshot(role: AgentRole): AgentRoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    ...(role.icon ? { icon: role.icon } : {}),
    ...(role.color ? { color: role.color } : {}),
  };
}
