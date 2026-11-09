import { useCallback, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { SshRemoteEntry, WorkspaceExecutionLocation } from "@getpaseo/protocol/ssh-workspaces";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { useSshMachines } from "../internal/use-ssh-machines";
import { SshWorkspaceOperationsPanel, SshWorkspaceRoutingPanel } from "./ssh-workspace-details";

type BrowserView = "files" | "routing" | "operations";

// Read-only browser for SSH workspaces. Paths go to the daemon with the workspace id, so
// the daemon resolves the machine; the owner computer's file RPCs are never used here.
export function SshFileBrowser({
  serverId,
  workspaceId,
  location,
}: {
  serverId: string;
  workspaceId: string;
  location: WorkspaceExecutionLocation;
}): ReactElement {
  const { t } = useTranslation();
  const isActive = useRetainedPanelActive();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { machines } = useSshMachines(serverId);
  const machineName =
    machines?.find((machine) => machine.machineId === location.machineId)?.displayName ??
    location.machineDisplayName ??
    location.machineId;
  const [path, setPath] = useState(location.directory);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [view, setView] = useState<BrowserView>("files");
  const showFiles = useCallback(() => setView("files"), []);
  const showRouting = useCallback(() => setView("routing"), []);
  const showOperations = useCallback(() => setView("operations"), []);

  const listing = useFetchQuery({
    queryKey: ["sshWorkspaceFiles", serverId, workspaceId, path],
    dataShape: "value",
    staleTimeMs: 5_000,
    enabled: Boolean(isActive && client && isConnected),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.listSshWorkspaceFiles({ workspaceId, path });
    },
  });
  const file = useFetchQuery({
    queryKey: ["sshWorkspaceFile", serverId, workspaceId, openFile],
    dataShape: "value",
    staleTimeMs: 5_000,
    enabled: Boolean(isActive && client && isConnected && openFile),
    queryFn: async () => {
      if (!client || !openFile) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.readSshWorkspaceFile({ workspaceId, path: openFile });
    },
  });

  const goUp = useCallback(() => {
    if (path === "/") return;
    setOpenFile(null);
    setPath(path.slice(0, path.lastIndexOf("/")) || "/");
  }, [path]);
  const handleEntry = useCallback((entry: SshRemoteEntry) => {
    if (entry.kind === "directory") {
      setOpenFile(null);
      setPath(entry.path);
    } else {
      setOpenFile(entry.path);
    }
  }, []);
  const closeFile = useCallback(() => setOpenFile(null), []);
  const refresh = useCallback(() => {
    void listing.refetch();
    if (openFile) void file.refetch();
  }, [file, listing, openFile]);
  const entries = listing.data?.entries ?? [];

  return (
    <View style={styles.container} testID="ssh-file-browser">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.machine} numberOfLines={1}>
            {t("sshMachines.files.location", { machine: machineName })}
          </Text>
          <Text style={styles.path} numberOfLines={1}>
            {path}
          </Text>
        </View>
        <Button size="sm" variant="ghost" onPress={goUp} disabled={path === "/"}>
          {t("sshMachines.files.up")}
        </Button>
        <Button size="sm" variant="ghost" onPress={refresh}>
          {t("sshMachines.files.refresh")}
        </Button>
      </View>
      <View style={styles.tabs}>
        <Button size="sm" variant={view === "files" ? "secondary" : "ghost"} onPress={showFiles}>
          {t("sshMachines.files.title")}
        </Button>
        <Button
          size="sm"
          variant={view === "routing" ? "secondary" : "ghost"}
          onPress={showRouting}
          testID="ssh-workspace-routing"
        >
          {t("sshMachines.toolRouting")}
        </Button>
        <Button
          size="sm"
          variant={view === "operations" ? "secondary" : "ghost"}
          onPress={showOperations}
          testID="ssh-workspace-operations"
        >
          {t("sshMachines.operations.title")}
        </Button>
      </View>
      {view === "routing" ? (
        <ScrollView style={styles.list}>
          <SshWorkspaceRoutingPanel serverId={serverId} workspaceId={workspaceId} />
        </ScrollView>
      ) : null}
      {view === "operations" ? (
        <SshWorkspaceOperationsPanel serverId={serverId} workspaceId={workspaceId} />
      ) : null}
      {view === "files" ? (
        <FilesView
          isConnected={isConnected}
          listing={listing}
          entries={entries}
          openFile={openFile}
          file={file}
          onEntry={handleEntry}
          onCloseFile={closeFile}
        />
      ) : null}
    </View>
  );
}

function FilesView({
  isConnected,
  listing,
  entries,
  openFile,
  file,
  onEntry,
  onCloseFile,
}: {
  isConnected: boolean;
  listing: { error: Error | null; isLoading: boolean; data?: unknown };
  entries: SshRemoteEntry[];
  openFile: string | null;
  file: {
    error: Error | null;
    data?: { text: string | null; binary: boolean; truncated: boolean };
  };
  onEntry: (entry: SshRemoteEntry) => void;
  onCloseFile: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.list}>
      {isConnected ? null : <Text style={styles.state}>{t("sshMachines.files.disconnected")}</Text>}
      {listing.error ? <Text style={styles.error}>{toErrorMessage(listing.error)}</Text> : null}
      {listing.isLoading ? (
        <Text style={styles.state}>{t("sshMachines.files.loading")}</Text>
      ) : null}
      <ScrollView style={openFile ? styles.listShort : styles.list}>
        {entries.map((entry) => (
          <EntryRow key={entry.path} entry={entry} onOpen={onEntry} />
        ))}
        {listing.data && entries.length === 0 ? (
          <Text style={styles.state}>{t("sshMachines.files.empty")}</Text>
        ) : null}
      </ScrollView>
      {openFile ? (
        <FilePreview
          path={openFile}
          error={file.error}
          result={file.data ?? null}
          onClose={onCloseFile}
        />
      ) : null}
    </View>
  );
}

function EntryRow({
  entry,
  onOpen,
}: {
  entry: SshRemoteEntry;
  onOpen: (entry: SshRemoteEntry) => void;
}): ReactElement {
  const handlePress = useCallback(() => onOpen(entry), [entry, onOpen]);
  return (
    <PressHighlight
      onPress={handlePress}
      style={styles.entry}
      highlightStyle={styles.entryPressed}
      accessibilityRole="button"
    >
      <Text style={styles.entryKind}>{entry.kind === "directory" ? "▸" : " "}</Text>
      <Text style={styles.entryName} numberOfLines={1}>
        {entry.name}
      </Text>
      {entry.size === null ? null : <Text style={styles.entrySize}>{entry.size}</Text>}
    </PressHighlight>
  );
}

function FilePreview({
  path,
  error,
  result,
  onClose,
}: {
  path: string;
  error: Error | null;
  result: { text: string | null; binary: boolean; truncated: boolean } | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.preview}>
      <View style={styles.header}>
        <Text style={[styles.path, styles.headerText]} numberOfLines={1}>
          {path}
        </Text>
        <Button size="sm" variant="ghost" onPress={onClose}>
          {t("sshMachines.files.close")}
        </Button>
      </View>
      {error ? <Text style={styles.error}>{toErrorMessage(error)}</Text> : null}
      {result?.binary ? <Text style={styles.state}>{t("sshMachines.files.binary")}</Text> : null}
      {result?.truncated ? (
        <Text style={styles.state}>{t("sshMachines.files.truncated")}</Text>
      ) : null}
      <ScrollView style={styles.previewBody}>
        <Text selectable style={styles.code}>
          {result?.text ?? ""}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  tabs: {
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  machine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  path: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  list: {
    flex: 1,
  },
  listShort: {
    flex: 1,
    maxHeight: "40%",
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  entryPressed: {
    backgroundColor: theme.colors.surface2,
  },
  entryKind: {
    width: 12,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entryName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  entrySize: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  state: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[3],
  },
  preview: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  previewBody: {
    flex: 1,
    padding: theme.spacing[3],
  },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
}));
