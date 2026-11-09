import { useEffect, type ComponentType, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useWorkspaceExecutionLocation } from "../internal/use-execution-location";

// Panels that read the owner computer (Git, diffs, PRs, local files, terminals). In an SSH
// workspace they render a notice and never mount the real panel, so no local request is sent.
export function withLocalOnlyGuard(Panel: ComponentType): ComponentType {
  function LocalOnlyPanel(): ReactElement {
    const { serverId, workspaceId } = usePaneContext();
    const location = useWorkspaceExecutionLocation(serverId, workspaceId);
    return location ? <SshUnsupportedPanel /> : <Panel />;
  }
  LocalOnlyPanel.displayName = `LocalOnly(${Panel.displayName ?? Panel.name ?? "Panel"})`;
  return LocalOnlyPanel;
}

function SshUnsupportedPanel(): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.center} testID="ssh-panel-unsupported">
      <Text style={styles.text}>{t("sshMachines.workspace.panelUnavailable")}</Text>
    </View>
  );
}

const EXPLORER_LOCAL_KINDS = new Set([
  "changes_tree",
  "working_diff",
  "pull_request",
  "commit_diff",
]);

// The explorer of an SSH workspace offers Files only. Default or restored Changes, Diff and
// PR tabs are closed once the workspace is known to be SSH.
export function useSshExplorerTabs(workspaceKey: string | null, isSsh: boolean): void {
  useEffect(() => {
    if (!isSsh || !workspaceKey) return;
    const store = useWorkspaceLayoutStore.getState();
    const layout = store.layoutByWorkspace[workspaceKey];
    if (!layout) return;
    const tabs = collectAllTabs(layout.root);
    for (const tab of tabs) {
      if (EXPLORER_LOCAL_KINDS.has(tab.target.kind)) store.closeTab(workspaceKey, tab.tabId);
    }
    const files = tabs.find((tab) => tab.target.kind === "files");
    if (files && tabs.some((tab) => EXPLORER_LOCAL_KINDS.has(tab.target.kind))) {
      store.focusTab(workspaceKey, files.tabId);
    }
  }, [isSsh, workspaceKey]);
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
