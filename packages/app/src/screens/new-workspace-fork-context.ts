import type { AgentAttachment } from "@getpaseo/protocol/messages";

function isLikelyWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isExcludedFromWorkspaceNaming(attachment: AgentAttachment): boolean {
  if (attachment.type !== "text") {
    return false;
  }
  return (
    attachment.contextKind === "chat_history" ||
    attachment.contextKind === "agent_session" ||
    attachment.contextKind === "agent_profile"
  );
}

export function getWorkspaceNamingAttachments(
  attachments: readonly AgentAttachment[],
): AgentAttachment[] {
  return attachments.filter((attachment) => !isExcludedFromWorkspaceNaming(attachment));
}

export function remapDraftCwdToWorkspace(input: {
  cwd: string;
  sourceDirectory?: string | null;
  workspaceDirectory: string;
}): string {
  const cwd = input.cwd.trim();
  const sourceDirectory = input.sourceDirectory?.trim();
  const workspaceDirectory = input.workspaceDirectory.trim();
  if (!cwd || !sourceDirectory) {
    return workspaceDirectory;
  }
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = sourceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const compareCaseInsensitively =
    isLikelyWindowsPath(normalizedCwd) || isLikelyWindowsPath(normalizedSource);
  const comparableCwd = compareCaseInsensitively ? normalizedCwd.toLowerCase() : normalizedCwd;
  const comparableSource = compareCaseInsensitively
    ? normalizedSource.toLowerCase()
    : normalizedSource;
  if (comparableCwd === comparableSource) {
    return workspaceDirectory;
  }
  const relativePath = comparableCwd.startsWith(`${comparableSource}/`)
    ? normalizedCwd.slice(normalizedSource.length + 1)
    : "";
  if (!relativePath) {
    return workspaceDirectory;
  }
  const separator =
    workspaceDirectory.includes("\\") && !workspaceDirectory.includes("/") ? "\\" : "/";
  return [workspaceDirectory.replace(/[\\/]+$/, ""), ...relativePath.split("/")]
    .filter(Boolean)
    .join(separator);
}
