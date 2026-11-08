import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { MenuItem } from "@/components/ui/menu";
import { usePaneContext } from "@/panels/pane-context";
import { useSheetPanePage } from "@/screens/workspace/sheet-pane";
import {
  selectSheetTab,
  useWorkspaceLayoutStore,
  type SheetTab,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { ArtifactSummary } from "./summary";
import { useWorkspaceArtifacts } from "./store";

interface ArtifactsTrackProps {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

export function ArtifactsTrack({ serverId, workspaceId, agentId }: ArtifactsTrackProps) {
  const { t } = useTranslation();
  const { tabId, openPreferredTarget } = usePaneContext();
  const collection = useWorkspaceArtifacts(serverId, workspaceId);
  const [sessionOnly, setSessionOnly] = useState(false);
  const own = useMemo(
    () => collection.filter((artifact) => artifact.sourceAgentId === agentId),
    [agentId, collection],
  );
  const visible = sessionOnly ? own : collection;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layoutMode = useWorkspaceLayoutStore((state) => state.layoutMode);
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const sheets = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.sheetsByWorkspace[workspaceKey] : undefined,
  );
  const sheetPage = useSheetPanePage();
  const sheetFor = useMemo(() => {
    const answers = new Map<string, SheetTab | null>();
    return (artifactId: string | null) => {
      if (!workspaceKey) return null;
      const key = artifactId ?? "collection";
      const known = answers.get(key);
      if (known !== undefined) return known;
      const sheet = selectSheetTab(
        {
          layoutMode,
          layoutByWorkspace: layout ? { [workspaceKey]: layout } : {},
          sheetsByWorkspace: sheets ? { [workspaceKey]: sheets } : {},
        },
        {
          workspaceKey,
          parentTabId: tabId,
          target: artifactId ? { kind: "artifact", artifactId } : { kind: "artifacts" },
        },
      );
      answers.set(key, sheet);
      return sheet;
    };
  }, [layout, layoutMode, sheets, tabId, workspaceKey]);
  const rows = useMemo(
    () => visible.map((artifact) => ({ artifact, sheet: sheetFor(artifact.id) })),
    [sheetFor, visible],
  );
  const collectionSheet = sheetFor(null);
  const pages = useMemo(
    () => [
      ...(collectionSheet ? [sheetPage(collectionSheet)] : []),
      ...rows.flatMap(({ sheet }) => (sheet ? [sheetPage(sheet)] : [])),
    ],
    [collectionSheet, rows, sheetPage],
  );
  const openCollection = useCallback(() => {
    openPreferredTarget({ kind: "artifacts" }, "explorerFiles");
  }, [openPreferredTarget]);
  const openArtifact = useCallback(
    (artifactId: string) => {
      openPreferredTarget({ kind: "artifact", artifactId }, "explorerFiles");
    },
    [openPreferredTarget],
  );
  const toggleSession = useCallback(() => setSessionOnly((value) => !value), []);
  const label = t("artifacts.pill", { count: collection.length });
  const segments = useMemo(() => [{ bucket: null, text: label }], [label]);
  if (collection.length === 0) return null;
  return (
    <ComposerTrackPill
      segments={segments}
      panelTitle={t("artifacts.title")}
      testID="artifacts-track"
      pages={pages}
    >
      <ComposerTrackActions divided={visible.length > 0}>
        <ComposerTrackRow
          onPress={openCollection}
          opensPage={collectionSheet?.tab.tabId}
          testID="artifacts-track-show-all"
        >
          <Text style={styles.action}>
            {t("artifacts.filter.showAll", { count: collection.length })}
          </Text>
        </ComposerTrackRow>
        <MenuItem onSelect={toggleSession} selected={sessionOnly} closeOnSelect={false}>
          {t("artifacts.filter.sessionOnly", { count: own.length })}
        </MenuItem>
      </ComposerTrackActions>
      {visible.length === 0 ? (
        <Text style={styles.empty}>{t("common.empty.noResults")}</Text>
      ) : null}
      {rows.map(({ artifact, sheet }) => (
        <ArtifactTrackRow
          key={artifact.id}
          artifact={artifact}
          sheetId={sheet?.tab.tabId}
          onOpen={openArtifact}
        />
      ))}
    </ComposerTrackPill>
  );
}

interface ArtifactTrackRowProps {
  artifact: Artifact;
  sheetId: string | undefined;
  onOpen: (artifactId: string) => void;
}

function ArtifactTrackRow({ artifact, sheetId, onOpen }: ArtifactTrackRowProps) {
  const open = useCallback(() => onOpen(artifact.id), [artifact.id, onOpen]);
  return (
    <ComposerTrackRow
      onPress={open}
      opensPage={sheetId}
      accessibilityLabel={artifact.title}
      testID={`artifact-track-row-${artifact.id}`}
    >
      <ArtifactSummary artifact={artifact} />
    </ComposerTrackRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  action: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  empty: {
    padding: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
