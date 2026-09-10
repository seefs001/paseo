import { describe, expect, it } from "vitest";
import { mentionOptionGroups } from "@/utils/session-mention-autocomplete";

describe("mentionOptionGroups", () => {
  it("limits @chat to sessions, @agent to profiles, and @file to workspace files", () => {
    expect(mentionOptionGroups("chat")).toEqual({
      sessions: true,
      profiles: false,
      files: false,
    });
    expect(mentionOptionGroups("agent")).toEqual({
      sessions: false,
      profiles: true,
      files: false,
    });
    expect(mentionOptionGroups("file")).toEqual({
      sessions: false,
      profiles: false,
      files: true,
    });
    expect(mentionOptionGroups("all")).toEqual({
      sessions: true,
      profiles: true,
      files: true,
    });
  });
});
