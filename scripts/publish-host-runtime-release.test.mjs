import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  publishHostRuntimeRelease,
  renderRemoteInstallScript,
  resolveRuntimeDate,
  runtimeReleaseTag,
  stableRuntimeAssetName,
} from "./publish-host-runtime-release.mjs";

test("uses the Shanghai calendar day when no date is given", () => {
  assert.equal(resolveRuntimeDate("", new Date("2026-10-22T16:30:00Z")), "2026-10-23");
  assert.equal(resolveRuntimeDate("2026-01-02"), "2026-01-02");
  assert.equal(runtimeReleaseTag("2026-10-23"), "runtime-2026-10-23");
});

test("rejects a date that is not a calendar day", () => {
  assert.throws(() => resolveRuntimeDate("2026-10-23T00:00:00Z"), /YYYY-MM-DD/);
});

test("drops the package version from the download name", () => {
  assert.equal(
    stableRuntimeAssetName("paseo-runtime-0.13.0-beta.1-linux-arm64.tar.gz"),
    "paseo-runtime-linux-arm64.tar.gz",
  );
  assert.equal(stableRuntimeAssetName("install.sh"), null);
});

test("remote install script downloads this release and does not start a daemon", () => {
  const script = renderRemoteInstallScript({
    repo: "seefs001/paseo",
    tag: "runtime-2026-10-23",
  });
  assert.match(
    script,
    /https:\/\/github.com\/seefs001\/paseo\/releases\/download\/runtime-2026-10-23\/\$ASSET/,
  );
  assert.match(script, /paseo-runtime-darwin-arm64\.tar\.gz/);
  assert.match(script, /paseo-runtime-linux-x64\.tar\.gz/);
  assert.match(script, /paseo-runtime-linux-arm64\.tar\.gz/);
  assert.match(script, /Node 22/);
  assert.doesNotMatch(script, /paseo start|kill /);
});

test("publishes the dated release and runtime-latest from the built archives", async () => {
  const assetDir = mkdtempSync(path.join(tmpdir(), "paseo-assets-"));
  writeFileSync(path.join(assetDir, "paseo-runtime-0.13.0-beta.1-darwin-arm64.tar.gz"), "darwin");
  writeFileSync(path.join(assetDir, "paseo-runtime-0.13.0-beta.1-linux-x64.tar.gz"), "linux");
  const calls = [];
  const result = await publishHostRuntimeRelease({
    repo: "seefs001/paseo",
    sha: "abc123",
    date: "2026-10-23",
    version: "0.13.0-beta.1",
    assetDir,
    workDir: path.join(assetDir, ".stage"),
    gh: (args) => {
      calls.push(args);
      return args[1] === "view" ? 1 : 0;
    },
    upload: ({ release, files }) => {
      calls.push(["upload", release, ...files.map((file) => path.basename(file))]);
      return 0;
    },
  });

  assert.deepEqual(result.tags, ["runtime-2026-10-23", "runtime-latest"]);
  assert.equal(
    result.installUrl,
    "https://github.com/seefs001/paseo/releases/download/runtime-2026-10-23/install.sh",
  );
  assert.equal(calls.filter((args) => args[1] === "create").length, 2);
  const datedUpload = calls.find(
    (args) => args[0] === "upload" && args[1] === "runtime-2026-10-23",
  );
  assert.deepEqual(datedUpload.slice(2).sort(), [
    "install.sh",
    "paseo-runtime-darwin-arm64.tar.gz",
    "paseo-runtime-linux-x64.tar.gz",
  ]);
  const installer = readFileSync(
    path.join(assetDir, ".stage", "runtime-latest", "install.sh"),
    "utf8",
  );
  assert.match(installer, /runtime-latest/);
});
