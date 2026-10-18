export const PI_DISABLED_TOOLS_FEATURE_ID = "disabled_tools";
export const PI_SCOPEWEAVER_TOOL_PATTERN = "scopeweaver_*";
export const PI_DEFAULT_DISABLED_TOOLS = [PI_SCOPEWEAVER_TOOL_PATTERN] as const;

const TOOL_PATTERN = /^[A-Za-z0-9_*.-]+$/;
const MAX_TOOL_PATTERN_LENGTH = 128;

export function piToolMatches(name: string, pattern: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return name === pattern;
  }
  if (pattern.indexOf("*", star + 1) !== -1) {
    return false;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    name.startsWith(prefix) && name.endsWith(suffix) && name.length >= prefix.length + suffix.length
  );
}

export function isPiToolDisabled(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => piToolMatches(name, pattern));
}

function rawDisabledToolPatterns(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",");
  return null;
}

export function parsePiDisabledToolsValue(value: unknown): string[] {
  const raw = rawDisabledToolPatterns(value);
  if (!raw) {
    throw new Error("Pi disabled tools require a string or a list of patterns");
  }

  const patterns: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new Error("Pi disabled tools require a string or a list of patterns");
    }
    const pattern = entry.trim();
    if (!pattern) continue;
    if (pattern.length > MAX_TOOL_PATTERN_LENGTH || !TOOL_PATTERN.test(pattern)) {
      throw new Error(`Invalid Pi tool pattern: ${pattern}`);
    }
    if ((pattern.match(/\*/g) ?? []).length > 1) {
      throw new Error(`Invalid Pi tool pattern: ${pattern}`);
    }
    if (!patterns.includes(pattern)) {
      patterns.push(pattern);
    }
  }
  return patterns;
}

export function resolvePiDisabledTools(
  featureValues: Record<string, unknown> | undefined,
): string[] {
  if (
    !featureValues ||
    !Object.prototype.hasOwnProperty.call(featureValues, PI_DISABLED_TOOLS_FEATURE_ID)
  ) {
    return [...PI_DEFAULT_DISABLED_TOOLS];
  }
  try {
    return parsePiDisabledToolsValue(featureValues[PI_DISABLED_TOOLS_FEATURE_ID]);
  } catch {
    return [...PI_DEFAULT_DISABLED_TOOLS];
  }
}

export function formatPiDisabledTools(patterns: readonly string[]): string {
  return patterns.join(",");
}

export function togglePiToolGroup(
  patterns: readonly string[],
  pattern: string,
  enabled: boolean,
): string[] {
  const without = patterns.filter((entry) => entry !== pattern);
  return enabled ? without : [...without, pattern];
}

export function piEnabledToolGroupLabels(
  patterns: readonly string[],
  groups: readonly { label: string; pattern: string }[],
): string[] {
  return groups
    .filter(
      (group) =>
        isPiToolDisabled(group.pattern, PI_DEFAULT_DISABLED_TOOLS) &&
        !isPiToolDisabled(group.pattern, patterns),
    )
    .map((group) => group.label);
}
