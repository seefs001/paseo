import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_RUNTIME_WORKSPACES,
  hostRuntimeArchiveName,
  renderInstallScript,
} from "./package-host-runtime.mjs";

test("packs the daemon and CLI workspaces in Docker order", () => {
  assert.deepEqual(HOST_RUNTIME_WORKSPACES, [
    "@getpaseo/highlight",
    "@getpaseo/relay",
    "@getpaseo/protocol",
    "@getpaseo/client",
    "@getpaseo/plugin",
    "@getpaseo/server",
    "@getpaseo/cli",
  ]);
});

test("names the archive from the checkout version and target", () => {
  assert.equal(
    hostRuntimeArchiveName("0.13.0-beta.1", "darwin", "arm64"),
    "paseo-runtime-0.13.0-beta.1-darwin-arm64.tar.gz",
  );
});

test("install script pins Node and does not start a daemon", () => {
  const script = renderInstallScript({
    version: "0.13.0-beta.1",
    gitSha: "abc123",
    platform: "linux",
    arch: "arm64",
    nodeMajor: "22",
  });

  assert.match(script, /Node 22/);
  assert.match(script, /\$HOME\/\.local\/bin\/paseo/);
  assert.match(script, /paseo start/);
  assert.match(script, /leaves an already running daemon alone/);
  assert.doesNotMatch(script, /kill /);
});
