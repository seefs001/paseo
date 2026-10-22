import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { buildToolCallPresentation, type ToolCallPresentationIcon } from "./presentation";

const fakeIcons = {
  paseo: (() => null) as ToolCallPresentationIcon,
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
  agentMessage: AgentMessage | undefined,
): ToolCallPresentationIcon {
  if (agentMessage) {
    return fakeIcons.paseo;
  }
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it.each([
    ["/home/user/.agents/skills/code-review/SKILL.md", "code-review"],
    [".agents/skills/tdd/SKILL.md", "tdd"],
    ["code-review/SKILL.md", "code-review"],
    ["C:\\Users\\dev\\skills\\code-review\\SKILL.md", "code-review"],
  ])("shows the skill name for %s while preserving file details", (filePath, skillName) => {
    const detail: ToolCallDetail = { type: "read", filePath, content: "# Instructions" };
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail,
      metadata: { piToolSummary: [{ kind: "path", value: filePath }] },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation).toMatchObject({
      displayName: "Read skill",
      summary: skillName,
      openFilePath: filePath,
      detail,
      hasDetails: true,
      canOpenDetails: true,
    });
  });

  it("uses the declared skill name rather than the checkout folder or document title", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail: {
        type: "read",
        filePath: "/skills/review-checkout/SKILL.md",
        content:
          '---\nname: "code-review"\ndescription: Review code changes.\n---\n# Review workflow',
      },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe("Read skill");
    expect(presentation.summary).toBe("code-review");
  });

  it.each([
    [
      "/home/user/.pi/agent/npm/node_modules/nowledge-mem-pi/skills/search-memory/SKILL.md",
      "---\nname: search-memory\n---\n# Search Memory",
      "search-memory",
    ],
    [
      "/work/skills/skills/engineering/tdd/SKILL.md",
      "---\nname: tdd\n---\n# Test-Driven Development",
      "tdd",
    ],
    ["SKILL.md", "---\nname: paseo-committee\n---\n# Committee Skill", "paseo-committee"],
    [
      "./SKILL.md",
      "\uFEFF--- \r\nname: 'wait-what' # registered name\r\n---\r\nInstructions",
      "wait-what",
    ],
  ])(
    "resolves observed skill formats and document-relative reads: %s",
    (filePath, content, name) => {
      const presentation = buildToolCallPresentation({
        toolName: "read",
        status: "completed",
        error: null,
        detail: { type: "read", filePath, content },
        resolveIcon: fakeResolveIcon,
      });
      expect(presentation.displayName).toBe("Read skill");
      expect(presentation.summary).toBe(name);
    },
  );

  it.each([
    undefined,
    "# A document title is not the skill name",
    "---\nmetadata:\n  name: not-the-skill-name\n---\n# Instructions",
    "---\nname: [not, a, name]\n---\n# Instructions",
    "---\nname: first\nname: second\n---\n# Instructions",
    '---\nname: "unfinished\n---\n# Instructions',
    "---\nname: ''\n---\n# Instructions",
    "---\nname: alias\n",
  ])("falls back to the directory when a usable declaration is unavailable: %s", (content) => {
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail: { type: "read", filePath: "/skills/code-review/SKILL.md", content },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.summary).toBe("code-review");
  });

  it("does not interpret an example in a partial read as the document frontmatter", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail: {
        type: "read",
        filePath: "/skills/writing-for-agents/SKILL.md",
        offset: 80,
        content: "---\nname: example-skill\n---\nExample instructions",
      },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.summary).toBe("writing-for-agents");
  });

  it("keeps other Markdown files as reads even when their frontmatter has a name", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail: {
        type: "read",
        filePath: "/skills/code-review/README.md",
        content: "---\nname: code-review\n---\n# Reference",
      },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe("Read");
  });

  it.each(["running", "failed", "canceled"] as const)(
    "retains the %s state of a skill read without claiming it was applied",
    (status) => {
      const error = status === "failed" ? "File not found" : null;
      const presentation = buildToolCallPresentation({
        toolName: "read",
        status,
        error,
        detail: { type: "read", filePath: "/skills/tdd/SKILL.md" },
        resolveIcon: fakeResolveIcon,
      });
      expect(presentation.displayName).toBe("Read skill");
      expect(presentation.summary).toBe("tdd");
      expect(presentation.errorText).toBe(error ?? undefined);
      expect(presentation.canOpenDetails).toBe(true);
    },
  );

  it.each([
    "/skills/code-review/references/checklist.md",
    "/skills/code-review/SKILL.md.bak",
    "SKILL.md",
    "./SKILL.md",
    "../SKILL.md",
  ])("keeps ordinary or unnamed reads as files: %s", (filePath) => {
    const presentation = buildToolCallPresentation({
      toolName: "read",
      status: "completed",
      error: null,
      detail: { type: "read", filePath },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe("Read");
    expect(presentation.openFilePath).toBe(filePath);
  });

  it("keeps the Codemode name on a script without nested calls", () => {
    const presentation = buildToolCallPresentation({
      toolName: "codemode",
      status: "completed",
      error: null,
      detail: { type: "plain_text", label: "Output", text: "Loaded instructions" },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe("Codemode");
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});

it.each([
  ["message", "Message received"],
  ["finished", "Agent finished"],
  ["errored", "Agent errored"],
  ["permission-required", "Agent needs permission"],
  ["closed", "Agent closed"],
] as const)(
  "presents %s with a fixed label, the sender as context, and the Paseo icon",
  (event, heading) => {
    const presentation = buildToolCallPresentation({
      toolName: "internal_name_should_not_be_visible",
      status: "completed",
      error: null,
      detail: { type: "plain_text", label: "legacy summary", text: "legacy body", icon: "bot" },
      agentMessage: {
        event,
        sender: { id: "server::sender", title: "QA messenger" },
        text: "The delivered message.",
      },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe(heading);
    expect(presentation.summary).toBe("QA messenger");
    expect(presentation.icon).toBe(fakeIcons.paseo);
    expect(presentation.detail).toEqual({
      type: "plain_text",
      text: "From agent: server::sender\n\nThe delivered message.",
    });
  },
);

it("uses an opaque sender ID when no title is available", () => {
  const presentation = buildToolCallPresentation({
    toolName: "agent_message",
    status: "completed",
    error: null,
    agentMessage: { event: "message", sender: { id: "remote::worker" }, text: "Hello" },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Message received");
  expect(presentation.summary).toBe("remote::worker");
});

it("shows the target agent title as context for Paseo agent tools", () => {
  const presentation = buildToolCallPresentation({
    toolName: "mcp__paseo__kill_agent",
    status: "completed",
    error: null,
    detail: { type: "unknown", input: { agentId: "agt_1" }, output: null },
    targetAgentTitle: "Reviewer",
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Kill agent");
  expect(presentation.summary).toBe("Reviewer");
});
