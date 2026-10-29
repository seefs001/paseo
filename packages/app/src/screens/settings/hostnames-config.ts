const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostnamePattern(input: string): string | null {
  const value = input.trim().toLowerCase();
  const suffix = value.startsWith(".");
  const body = suffix ? value.slice(1) : value;
  if (!body || body.length > 253 || body.startsWith(".") || body.endsWith(".")) return null;
  const labels = body.split(".");
  if (!labels.every((label) => HOSTNAME_LABEL.test(label))) return null;
  return suffix ? `.${body}` : body;
}

export function addHostname(
  current: readonly string[],
  input: string,
): { ok: true; hostnames: string[] } | { ok: false } {
  const pattern = normalizeHostnamePattern(input);
  if (!pattern) return { ok: false };
  if (current.some((entry) => entry.toLowerCase() === pattern)) {
    return { ok: true, hostnames: [...current] };
  }
  return { ok: true, hostnames: [...current, pattern] };
}

export function removeHostname(current: readonly string[], pattern: string): string[] {
  return current.filter((entry) => entry !== pattern);
}
