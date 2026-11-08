export const PRIMARY_LAUNCH_ORDER = [
  "agent",
  "terminal",
  "changes",
  "diff",
  "files",
  "artifacts",
  "browser",
  "pullRequest",
] as const;

export const SUPPORTING_LAUNCH_ORDER = [
  "changes",
  "terminal",
  "diff",
  "files",
  "artifacts",
  "agent",
  "browser",
  "pullRequest",
] as const;

export type BuiltInLaunchItemId = (typeof PRIMARY_LAUNCH_ORDER)[number];

export function getBuiltInLaunchOrder(
  purpose: "primary" | "supporting",
  features: { artifacts: boolean } = { artifacts: false },
) {
  const order = purpose === "supporting" ? SUPPORTING_LAUNCH_ORDER : PRIMARY_LAUNCH_ORDER;
  return order.filter((id) => id !== "artifacts" || features.artifacts);
}
