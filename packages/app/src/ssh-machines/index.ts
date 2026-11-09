/**
 * SSH machines are execution targets owned by a daemon. A workspace bound to one runs its
 * Pi agent on the daemon computer while tools and files act on the machine.
 *
 * Import from `@/ssh-machines`, never a path inside it.
 */

export { SshMachinesSection } from "./settings/ssh-machines-section";
export { SshFileBrowser } from "./files/ssh-file-browser";

export { useWorkspaceExecutionLocation } from "./internal/use-execution-location";
export { withLocalOnlyGuard, useSshExplorerTabs } from "./panels/local-only";
export { useSshMachines } from "./internal/use-ssh-machines";
