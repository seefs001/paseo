import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { List } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/combobox";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Button } from "@/components/ui/button";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppSettings } from "@/hooks/use-settings";
import { useToast } from "@/contexts/toast-context";
import { formatCompactTimeAgo } from "@/utils/time";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { collectOpenSessions, type OpenSession } from "./model";
import { SessionRenameSheet } from "./rename-sheet";

const ListIcon = withUnistyles(List);
type Surface =
  | { kind: "closed" }
  | { kind: "picker" | "rename"; entries: OpenSession[]; activeTabId: string };

export function SessionPicker({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const focused = useIsFocused();
  const anchorRef = useRef<View>(null);
  const [surface, setSurface] = useState<Surface>({ kind: "closed" });
  useEffect(() => {
    if (!focused) setSurface({ kind: "closed" });
  }, [focused]);
  const workspaceKey = `${serverId}:${workspaceId}`;
  const connected = useHostRuntimeIsConnected(serverId);
  const { isLoading: settingsLoading } = useAppSettings();
  // COMPAT(sessionTitles): added after v0.9.1, remove gate after 2027-09-25.
  const supportsTitles = useHostFeature(serverId, "sessionTitles");
  const open = useCallback(() => {
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    const state = useSessionStore.getState();
    const host = state.sessions[serverId];
    if (!layout || !host) return;
    const entries = collectOpenSessions({
      tabs: collectAllTabs(layout.root),
      agents: host.agents,
      details: host.agentDetails,
      activity: state.agentLastActivity,
      untitled: t("sessionPicker.untitled"),
    });
    const activeTabId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId ?? "";
    setSurface({ kind: "picker", entries, activeTabId });
  }, [serverId, workspaceKey, t]);
  const close = useCallback(() => setSurface({ kind: "closed" }), []);
  const changeOpen = useCallback(
    (isOpen: boolean) => {
      if (isOpen) open();
      else setSurface((current) => (current.kind === "picker" ? { kind: "closed" } : current));
    },
    [open],
  );
  const select = useCallback(
    (tabId: string) => {
      const store = useWorkspaceLayoutStore.getState();
      const layout = store.layoutByWorkspace[workspaceKey];
      const exists = layout && collectAllTabs(layout.root).some((tab) => tab.tabId === tabId);
      if (!exists) {
        toast.error(t("sessionPicker.closed"));
        return;
      }
      store.focusTab(workspaceKey, tabId);
      close();
    },
    [workspaceKey, close, toast, t],
  );
  const rename = useCallback(() => {
    if (surface.kind !== "picker") return;
    if (!supportsTitles) {
      toast.error(t("sessionPicker.updateHost"));
      return;
    }
    if (surface.entries.length > 100) {
      toast.error(t("sessionPicker.tooMany"));
      return;
    }
    setSurface({ ...surface, kind: "rename" });
  }, [surface, supportsTitles, toast, t]);
  const options = useMemo(() => {
    if (surface.kind === "closed") return [];
    return surface.entries.map((entry) => ({
      id: entry.tabId,
      label: entry.title,
      description: `${entry.provider} · ${formatCompactTimeAgo(new Date(entry.activityAt))}`,
    }));
  }, [surface]);
  const agentIds = useMemo(
    () =>
      surface.kind === "closed" ? [] : [...new Set(surface.entries.map((entry) => entry.agentId))],
    [surface],
  );
  const footer = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        onPress={rename}
        disabled={!connected || settingsLoading || agentIds.length === 0}
        testID="session-picker-rename"
      >
        {t("sessionPicker.rename")}
      </Button>
    ),
    [rename, connected, settingsLoading, agentIds.length, t],
  );
  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <ToolbarButton
          label={t("sessionPicker.title")}
          testID="session-picker-trigger"
          onPress={open}
        >
          <ListIcon size={14} uniProps={extraMutedIconColorMapping} />
        </ToolbarButton>
      </View>
      <Combobox
        anchorRef={anchorRef}
        open={focused && surface.kind === "picker"}
        onOpenChange={changeOpen}
        options={options}
        value={surface.kind === "closed" ? "" : surface.activeTabId}
        onSelect={select}
        title={t("sessionPicker.title")}
        searchPlaceholder={t("sessionPicker.search")}
        emptyText={t("sessionPicker.empty")}
        desktopMinWidth={360}
        footer={footer}
      />
      {focused && surface.kind === "rename" ? (
        <SessionRenameSheet
          serverId={serverId}
          workspaceId={workspaceId}
          agentIds={agentIds}
          onClose={close}
        />
      ) : null}
    </>
  );
}
