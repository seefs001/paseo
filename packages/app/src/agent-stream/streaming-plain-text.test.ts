import { describe, expect, it } from "vitest";

import { splitLivePlainText } from "./streaming-plain-text";

describe("splitLivePlainText", () => {
  it("keeps a single open line together", () => {
    expect(splitLivePlainText("still writing")).toBeNull();
  });

  it("puts completed lines in the head and the open line in the tail", () => {
    expect(splitLivePlainText("line one\nline two\npartial")).toEqual({
      head: "line one\nline two",
      tail: "partial",
    });
  });

  it("leaves an empty tail after a trailing newline", () => {
    expect(splitLivePlainText("line one\n")).toEqual({ head: "line one", tail: "" });
  });
});
