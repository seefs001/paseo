import { describe, expect, it } from "vitest";
import { addHostname, removeHostname } from "./hostnames-config";

describe("hostname allowlist edits", () => {
  it("normalizes a new name and ignores a duplicate", () => {
    expect(addHostname(["localhost"], " Paseo.Example.COM ")).toEqual({
      ok: true,
      hostnames: ["localhost", "paseo.example.com"],
    });
    expect(addHostname(["paseo.example.com"], "PASEO.example.com")).toEqual({
      ok: true,
      hostnames: ["paseo.example.com"],
    });
    expect(addHostname([], ".Example.com")).toEqual({
      ok: true,
      hostnames: [".example.com"],
    });
  });

  it("rejects a value that is not a hostname", () => {
    expect(addHostname([], "https://paseo.example.com")).toEqual({ ok: false });
    expect(addHostname([], " ")).toEqual({ ok: false });
  });

  it("removes one entry", () => {
    expect(removeHostname(["a.example", "b.example"], "a.example")).toEqual(["b.example"]);
  });
});
