import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View, type GestureResponderEvent } from "react-native";
import { Ellipsis, Square, SquareCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { isWeb } from "@/constants/platform";
import { useArtifactDragSource } from "./drag-source";
import { NO_MODIFIERS, type PressModifiers } from "./multi-select";
import { ArtifactSummary } from "./summary";
import { useArtifactActions } from "./use-artifact-actions";

const ThemedEllipsis = withUnistyles(Ellipsis, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export interface ArtifactRowSelection {
  /** Selection mode: a plain press toggles the row instead of opening it. */
  active: boolean;
  selected: boolean;
  /** Returns true when the press was taken by selection. */
  onPress: (artifactId: string, modifiers: PressModifiers) => boolean;
}

interface ArtifactRowProps {
  serverId: string;
  artifact: Artifact;
  onOpen: (artifactId: string) => void;
  onOpenFile?: (path: string) => void;
  selection?: ArtifactRowSelection;
  /** Source files a drag from this row carries into a composer. */
  dragPaths?: readonly string[];
  testID?: string;
}

const NO_PATHS: readonly string[] = [];

function pressModifiers(event: GestureResponderEvent | undefined): PressModifiers {
  if (!isWeb || !event) return NO_MODIFIERS;
  const native = event.nativeEvent as unknown as {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  };
  return {
    toggle: Boolean(native.metaKey || native.ctrlKey),
    range: Boolean(native.shiftKey),
  };
}

export function ArtifactRow({
  serverId,
  artifact,
  onOpen,
  onOpenFile,
  selection,
  dragPaths = NO_PATHS,
  testID,
}: ArtifactRowProps) {
  const { t } = useTranslation();
  const actions = useArtifactActions({ serverId, artifact });
  const dragRef = useArtifactDragSource({
    serverId,
    workspaceId: artifact.workspaceId,
    paths: dragPaths,
  });
  const open = useCallback(() => onOpen(artifact.id), [artifact.id, onOpen]);
  const selectionActive = selection?.active === true;
  const selected = selection?.selected === true;
  const accessibilityState = useMemo(
    () => (selectionActive ? { checked: selected } : undefined),
    [selected, selectionActive],
  );
  const press = useCallback(
    (event?: GestureResponderEvent) => {
      if (selection?.onPress(artifact.id, pressModifiers(event))) return;
      onOpen(artifact.id);
    },
    [artifact.id, onOpen, selection],
  );
  const openFile = useCallback(() => {
    if (artifact.sourcePath) onOpenFile?.(artifact.sourcePath);
  }, [artifact.sourcePath, onOpenFile]);
  const busy = actions.pending !== null;
  const canOpenFile = onOpenFile !== undefined && artifact.sourcePath !== null;
  return (
    <View ref={dragRef} style={[styles.row, selection?.selected && styles.rowSelected]}>
      <PressHighlight
        accessibilityRole={selection?.active ? "checkbox" : "button"}
        accessibilityState={accessibilityState}
        accessibilityLabel={t("shell.commandCenter.open", { name: artifact.title })}
        onPress={press}
        style={styles.main}
        testID={testID ?? `artifact-row-${artifact.id}`}
      >
        {selection?.active ? <SelectionMark selected={selection.selected} /> : null}
        <View style={styles.summary}>
          <ArtifactSummary artifact={artifact} />
        </View>
      </PressHighlight>
      <DropdownMenu>
        <ToolbarButton
          kind="menu"
          label={`${t("workspace.fileActions.moreActions")}: ${artifact.title}`}
          disabled={busy}
          testID={`artifact-row-actions-${artifact.id}`}
        >
          {busy ? <ThemedSpinner size={14} /> : <ThemedEllipsis size={16} />}
        </ToolbarButton>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={open}>
            {t("shell.commandCenter.open", { name: artifact.title })}
          </DropdownMenuItem>
          {canOpenFile ? (
            <DropdownMenuItem onSelect={openFile}>
              {t("artifacts.interaction.openFile")}
            </DropdownMenuItem>
          ) : null}
          {artifact.media !== "image" ? (
            <DropdownMenuItem onSelect={actions.copy}>{t("common.actions.copy")}</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={actions.download}>
            {t("artifacts.interaction.download")}
          </DropdownMenuItem>
          {artifact.sourcePath ? (
            <DropdownMenuItem onSelect={actions.copyPath}>
              {t("workspace.fileActions.copyPath")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={actions.remove} destructive>
            {t("artifacts.viewer.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function SelectionMark({ selected }: { selected: boolean }): ReactElement {
  return (
    <DensityIcon
      icon={selected ? SquareCheck : Square}
      size="sm"
      color={selected ? "accent" : "foregroundMuted"}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[2],
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  summary: { flex: 1, minWidth: 0 },
}));
