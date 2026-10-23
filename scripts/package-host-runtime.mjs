import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same pack order as docker/base/Dockerfile. Server prepack builds the web UI,
// so it has to follow the packages that export already depends on.
export const HOST_RUNTIME_WORKSPACES = [
  "@getpaseo/highlight",
  "@getpaseo/relay",
  "@getpaseo/protocol",
  "@getpaseo/client",
  "@getpaseo/plugin",
  "@getpaseo/server",
  "@getpaseo/cli",
];

export function hostRuntimeArchiveName(version, platform = process.platform, arch = process.arch) {
  return `paseo-runtime-${version}-${platform}-${arch}.tar.gz`;
}

export function renderInstallScript({ version, gitSha, platform, arch, nodeMajor }) {
  return `#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DEST="\${PASEO_PREFIX:-$HOME/.local/paseo}"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node ${nodeMajor} is required. This runtime was built with Node ${nodeMajor}." >&2
  exit 1
fi

if [ "$NODE_MAJOR" != "${nodeMajor}" ]; then
  echo "This runtime was built for Node ${nodeMajor}. Current node is $(node -v)." >&2
  exit 1
fi

case "$DEST" in
  /|$HOME|$HOME/.local)
    echo "Refusing to replace $DEST. Set PASEO_PREFIX to a directory for this runtime." >&2
    exit 1
    ;;
esac

if [ "$DEST" != "$ROOT" ]; then
  rm -rf "$DEST"
  mkdir -p "$(dirname -- "$DEST")"
  cp -a "$ROOT" "$DEST"
fi

mkdir -p "$HOME/.local/bin"
ln -sfn "$DEST/node_modules/.bin/paseo" "$HOME/.local/bin/paseo"

echo "Installed paseo ${version} (${platform}-${arch}, $(node -v))."
echo "Source: ${gitSha}"
echo "Command: $HOME/.local/bin/paseo"
echo "Start the daemon with: paseo start"
echo "The daemon uses ~/.paseo and leaves an already running daemon alone."
`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
}

function readVersion() {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
}

function readGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packWorkspaces(packDir) {
  mkdirSync(packDir, { recursive: true });
  for (const workspace of HOST_RUNTIME_WORKSPACES) {
    run("npm", ["pack", `--workspace=${workspace}`, "--pack-destination", packDir]);
  }
  return readdirSync(packDir)
    .filter((name) => name.endsWith(".tgz"))
    .sort()
    .map((name) => path.join(packDir, name));
}

function packageNameFromTarball(tarball) {
  const result = spawnSync("tar", ["-xOzf", tarball, "package/package.json"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Could not read package.json from ${tarball}`);
  }
  return JSON.parse(result.stdout).name;
}

function installRuntime(runtimeDir, tarballs) {
  const overrides = {};
  const dependencies = {};
  for (const tarball of tarballs) {
    const name = packageNameFromTarball(tarball);
    const spec = `file:${tarball}`;
    overrides[name] = spec;
    dependencies[name] = spec;
  }

  writeFileSync(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify({ name: "paseo-runtime", private: true, version: "0.0.0", dependencies, overrides }, null, 2)}\n`,
  );
  run("npm", ["install", "--omit=dev", "--ignore-scripts=false"], {
    cwd: runtimeDir,
    env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: "skip" },
  });
}

function assertInstalledServerMatchesBuild(runtimeDir) {
  const built = path.join(repoRoot, "packages/server/dist/scripts/supervisor-entrypoint.js");
  const installed = path.join(
    runtimeDir,
    "node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js",
  );
  const builtHash = sha256(built);
  const installedHash = sha256(installed);
  if (builtHash !== installedHash) {
    throw new Error(
      "Installed daemon does not match the packed checkout. npm used a different @getpaseo/server.",
    );
  }
}

export function packageHostRuntime({
  version = readVersion(),
  gitSha = readGitSha(),
  platform = process.platform,
  arch = process.arch,
  nodeMajor = process.versions.node.split(".")[0],
} = {}) {
  if (platform === "win32") {
    throw new Error("Host runtime packages are built for macOS and Linux.");
  }

  const stage = mkdtempSync(path.join(tmpdir(), "paseo-runtime-"));
  try {
    const tarballs = packWorkspaces(path.join(stage, "packs"));
    const runtimeDir = path.join(stage, "paseo-runtime");
    mkdirSync(runtimeDir);
    installRuntime(runtimeDir, tarballs);
    assertInstalledServerMatchesBuild(runtimeDir);

    rmSync(path.join(runtimeDir, "package-lock.json"), { force: true });
    rmSync(path.join(runtimeDir, "node_modules/.package-lock.json"), { force: true });
    writeFileSync(
      path.join(runtimeDir, "package.json"),
      `${JSON.stringify({ name: "paseo-runtime", private: true, version }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(runtimeDir, "RUNTIME.txt"),
      `version=${version}\ngit=${gitSha}\nplatform=${platform}\narch=${arch}\nnode=${process.version}\n`,
    );
    writeFileSync(
      path.join(runtimeDir, "install.sh"),
      renderInstallScript({ version, gitSha, platform, arch, nodeMajor }),
      { mode: 0o755 },
    );

    const artifactDir = path.join(repoRoot, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const archiveName = hostRuntimeArchiveName(version, platform, arch);
    const archivePath = path.join(artifactDir, archiveName);
    rmSync(archivePath, { force: true });
    run("tar", ["-czf", archivePath, "-C", stage, "paseo-runtime"]);
    return archivePath;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const archivePath = packageHostRuntime();
    console.log(archivePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
