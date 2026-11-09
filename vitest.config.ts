import fs from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";

// React's test APIs require its development build, even in a production shell.
process.env.NODE_ENV = "test";

const appDir = path.resolve(__dirname, "packages/app");
const appNodeModules = path.resolve(appDir, "node_modules");
const rootNodeModules = path.resolve(__dirname, "node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

// No tracked JS lives under packages/*/src (see .gitignore). Any .js there is a stale in-place tsc
// emit, and Vite would load it instead of the .ts source, both for NodeNext "./foo.js" imports and
// for alias/extensionless imports, where resolve.extensions lists .js before .ts.
const packageSourceDir = /[\\/]packages[\\/][^\\/]+[\\/]src[\\/]/;
const staleEmitPattern = /\.(m?js|jsx)$/;
const preferTypeScriptSources: Plugin = {
  name: "paseo:prefer-ts-over-stale-emit",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved || resolved.external) return resolved;
    const [file, query = ""] = resolved.id.split("?");
    if (!packageSourceDir.test(file) || !staleEmitPattern.test(file)) return resolved;
    const base = file.replace(staleEmitPattern, "");
    const tsExt = file.endsWith(".mjs") ? [".mts"] : [".ts", ".tsx"];
    for (const ext of tsExt) {
      if (fs.existsSync(base + ext)) return query ? `${base + ext}?${query}` : base + ext;
    }
    return resolved;
  },
};
export default defineConfig({
  plugins: [preferTypeScriptSources],
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@getpaseo\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "packages/relay/src/e2ee.ts"),
      },
      {
        find: /^@getpaseo\/relay$/,
        replacement: path.resolve(__dirname, "packages/relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(appDir, "src") },
      // The website's `~/` path alias, as in packages/website/tsconfig.json.
      { find: /^~\/(.*)$/, replacement: path.resolve(__dirname, "packages/website/src/$1") },
      { find: "@server", replacement: path.resolve(__dirname, "packages/server/src") },
      {
        find: "react-native",
        replacement: path.resolve(rootNodeModules, "react-native-web/dist/index.js"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      { find: "react-dom", replacement: resolvePackageEntry("react-dom") },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(appDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
    ],
  },
  test: {
    // Fake-timer suites freeze p-throttle's clock, so a real per-second cap deadlocks them.
    env: {
      PASEO_GIT_MAX_PROCESSES_PER_SECOND: "10000",
    },
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/.dev/**",
      // Stale in-place tsc emits; see preferTypeScriptSources.
      "packages/*/src/**/*.{js,jsx}",
    ],
    // The website installs its own React; bundling its router lets tests render website components
    // that use router hooks against the one React the tests use.
    server: { deps: { inline: [/packages\/website\/node_modules\/@tanstack\/(react-)?router/] } },
  },
});
