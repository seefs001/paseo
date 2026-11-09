import { agentPanelRegistration } from "@/panels/agent-panel";
import { browserPanelRegistration } from "@/desktop/browser/panel";
import {
  changesTreePanelRegistration,
  commitDiffPanelRegistration,
  workingDiffPanelRegistration,
} from "@/panels/diff-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { filesPanelRegistration } from "@/panels/files-panel";
import { registerPanel } from "@/panels/panel-registry";
import { setupPanelRegistration } from "@/panels/setup-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";
import { providerSubagentPanelRegistration } from "@/panels/provider-subagent-panel";
import { pullRequestPanelRegistration } from "@/panels/pull-request-panel";
import { pluginPanelRegistration } from "@/plugins/workspace-panels/panel";
import { newTabPanelRegistration } from "@/panels/new-tab-panel";
import { artifactPanelRegistration } from "@/artifacts/panel";
import { artifactsPanelRegistration } from "@/artifacts/collection";
import { workspaceTracePanelRegistration } from "@/workspace-trace/panel";
import { withLocalOnlyGuard } from "@/ssh-machines";

// Owner-computer panels render a notice instead in SSH workspaces.
function localOnly<T extends { component: import("react").ComponentType }>(registration: T): T {
  return { ...registration, component: withLocalOnlyGuard(registration.component) };
}

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(newTabPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(providerSubagentPanelRegistration);
  registerPanel(setupPanelRegistration);
  registerPanel(localOnly(terminalPanelRegistration));
  registerPanel(browserPanelRegistration);
  registerPanel(localOnly(filePanelRegistration));
  registerPanel(filesPanelRegistration);
  registerPanel(localOnly(pullRequestPanelRegistration));
  registerPanel(localOnly(commitDiffPanelRegistration));
  registerPanel(artifactPanelRegistration);
  registerPanel(artifactsPanelRegistration);
  registerPanel(workspaceTracePanelRegistration);
  registerPanel(localOnly(workingDiffPanelRegistration));
  registerPanel(localOnly(changesTreePanelRegistration));
  registerPanel(pluginPanelRegistration);
  panelsRegistered = true;
}
