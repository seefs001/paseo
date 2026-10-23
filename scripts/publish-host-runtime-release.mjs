import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";
import { uploadWithRetry } from "./upload-release-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LATEST_TAG = "runtime-latest";

export function resolveRuntimeDate(input, now = new Date()) {
  const requested = input?.trim();
  if (requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
      throw new Error(`Release date must be YYYY-MM-DD, got ${requested}`);
    }
    return requested;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function runtimeReleaseTag(date) {
  return `runtime-${resolveRuntimeDate(date)}`;
}

export function stableRuntimeAssetName(filename) {
  const match = /^paseo-runtime-.+-(linux)-(arm64|x64)\.tar\.gz$/.exec(
    path.basename(filename),
  );
  if (!match) return null;
  return `paseo-runtime-${match[1]}-${match[2]}.tar.gz`;
}

export function readRuntimeNodeMajor(runtimeText) {
  const match = /^node=v(\d+)\./m.exec(runtimeText);
  if (!match) throw new Error("Could not read the Node version from the runtime package");
  return match[1];
}

export function renderRemoteInstallScript({ repo, tag, nodeMajor }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Unexpected repository name ${repo}`);
  }
  if (tag !== LATEST_TAG && !/^runtime-\d{4}-\d{2}-\d{2}$/.test(tag)) {
    throw new Error(`Unexpected release tag ${tag}`);
  }
  if (!/^\d+$/.test(nodeMajor)) throw new Error(`Unexpected Node version ${nodeMajor}`);
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  return `#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Node ${nodeMajor} is required." >&2
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" != "${nodeMajor}" ]; then
  echo "Node ${nodeMajor} is required. Current node is $(node -v)." >&2
  exit 1
fi

OS="$(uname -s)"
MACH="$(uname -m)"
case "$OS-$MACH" in
  Linux-x86_64) ASSET="paseo-runtime-linux-x64.tar.gz" ;;
  Linux-aarch64|Linux-arm64) ASSET="paseo-runtime-linux-arm64.tar.gz" ;;
  *)
    echo "No runtime package for $OS $MACH." >&2
    echo "This release has Linux x64 and Linux arm64." >&2
    exit 1
    ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "${base}/$ASSET" -o "$TMP/runtime.tar.gz"
tar -xzf "$TMP/runtime.tar.gz" -C "$TMP"
"$TMP/paseo-runtime/install.sh"
`;
}

function readVersion() {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
}

function stageAssets(assetDir, stageDir, { repo, tag, nodeMajor }) {
  mkdirSync(stageDir, { recursive: true });
  const staged = [];
  for (const name of readdirSync(assetDir)) {
    const source = path.join(assetDir, name);
    if (!statSync(source).isFile()) continue;
    const assetName = stableRuntimeAssetName(name);
    if (!assetName) continue;
    const target = path.join(stageDir, assetName);
    copyFileSync(source, target);
    staged.push(target);
  }
  if (staged.length === 0) {
    throw new Error(`No runtime archives found in ${assetDir}`);
  }
  const installer = path.join(stageDir, "install.sh");
  writeFileSync(installer, renderRemoteInstallScript({ repo, tag, nodeMajor }), { mode: 0o755 });
  staged.push(installer);
  return staged.sort();
}

function releaseNotes({ repo, tag, date, version, sha, nodeMajor }) {
  const url = `https://github.com/${repo}/releases/download/${tag}/install.sh`;
  return `CLI and daemon ${version} from ${sha}.

Install:

curl -fsSL ${url} | sh

The other machine needs Node ${nodeMajor}. This does not start or stop a daemon.
Built for Linux x64 and Linux arm64.
Date: ${date}.
`;
}

function ghCommand(args, { allowFailure = false } = {}) {
  const command = process.platform === "win32" ? "gh.exe" : "gh";
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const exitCode = result.status ?? 1;
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`gh ${args.join(" ")} exited ${exitCode}`);
  }
  return exitCode;
}

function nodeMajorFromArchive(archivePath) {
  const result = spawnSync("tar", ["-xOzf", archivePath, "paseo-runtime/RUNTIME.txt"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Could not read RUNTIME.txt from ${archivePath}`);
  }
  return readRuntimeNodeMajor(result.stdout);
}

function resolveNodeMajor(assetDir, nodeMajor) {
  if (nodeMajor) return nodeMajor;
  const archive = readdirSync(assetDir)
    .map((name) => path.join(assetDir, name))
    .find((file) => statSync(file).isFile() && stableRuntimeAssetName(path.basename(file)));
  if (!archive) throw new Error(`No runtime archives found in ${assetDir}`);
  return nodeMajorFromArchive(archive);
}

export async function publishHostRuntimeRelease({
  repo,
  sha,
  date,
  version,
  assetDir,
  workDir,
  nodeMajor,
  gh = ghCommand,
  upload = (input) =>
    uploadWithRetry(input, {
      upload: ({ release, file, repo: releaseRepo }) =>
        gh(["release", "upload", release, file, "--clobber", "--repo", releaseRepo], {
          allowFailure: true,
        }),
    }),
}) {
  const resolvedDate = resolveRuntimeDate(date);
  const resolvedNodeMajor = resolveNodeMajor(assetDir, nodeMajor);
  const datedTag = runtimeReleaseTag(resolvedDate);
  const tags = [datedTag, LATEST_TAG];
  for (const tag of tags) {
    const stageDir = path.join(workDir, tag);
    const files = stageAssets(assetDir, stageDir, {
      repo,
      tag,
      nodeMajor: resolvedNodeMajor,
    });
    const title =
      tag === LATEST_TAG
        ? `Paseo runtime latest (${resolvedDate})`
        : `Paseo runtime ${resolvedDate}`;
    const notes = releaseNotes({
      repo,
      tag,
      date: resolvedDate,
      version,
      sha,
      nodeMajor: resolvedNodeMajor,
    });
    if (gh(["release", "view", tag, "--repo", repo], { allowFailure: true }) === 0) {
      gh(["release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag"]);
    }
    gh([
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--target",
      sha,
      "--title",
      title,
      "--notes",
      notes,
    ]);
    const exitCode = await upload({ release: tag, files, repo });
    if (exitCode !== 0) {
      throw new Error(`Uploading ${tag} failed`);
    }
  }
  return {
    date: resolvedDate,
    tags,
    installUrl: `https://github.com/${repo}/releases/download/${datedTag}/install.sh`,
    latestInstallUrl: `https://github.com/${repo}/releases/download/${LATEST_TAG}/install.sh`,
  };
}

if (isMainModule(import.meta.url)) {
  const assetDir = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!assetDir || !repo || !sha) {
    console.error(
      "Usage: GITHUB_REPOSITORY=owner/name GITHUB_SHA=sha node scripts/publish-host-runtime-release.mjs <asset-dir>",
    );
    process.exit(1);
  }
  try {
    const result = await publishHostRuntimeRelease({
      repo,
      sha,
      date: process.env.HOST_RUNTIME_DATE,
      version: readVersion(),
      assetDir,
      workDir: path.join(assetDir, ".stage"),
    });
    console.log(result.installUrl);
    console.log(result.latestInstallUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
