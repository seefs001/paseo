import { describe, expect, it } from "vitest";
import { mentionOptionGroups } from "@/utils/session-mention-autocomplete";

describe("mentionOptionGroups", () => {
  it("limits @chat to sessions and @file to workspace files, with agent profiles on # only", () => {
    expect(mentionOptionGroups("chat")).toEqual({
      sessions: true,
      files: false,
    });
    expect(mentionOptionGroups("file")).toEqual({
      sessions: false,
      files: true,
    });
    expect(mentionOptionGroups("all")).toEqual({
      sessions: true,
      files: true,
    });
  });
});
