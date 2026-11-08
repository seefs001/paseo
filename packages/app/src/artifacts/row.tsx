import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Ellipsis } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ArtifactSummary } from "./summary";
import { useArtifactActions } from "./use-artifact-actions";

const ThemedEllipsis = withUnistyles(Ellipsis, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface ArtifactRowProps {
  serverId: string;
  artifact: Artifact;
  onOpen: (artifactId: string) => void;
  onOpenFile?: (path: string) => void;
  testID?: string;
}

export function ArtifactRow({ serverId, artifact, onOpen, onOpenFile, testID }: ArtifactRowProps) {
  const { t } = useTranslation();
  const actions = useArtifactActions({ serverId, artifact });
  const open = useCallback(() => onOpen(artifact.id), [artifact.id, onOpen]);
  const openFile = useCallback(() => {
    if (artifact.sourcePath) onOpenFile?.(artifact.sourcePath);
  }, [artifact.sourcePath, onOpenFile]);
  const busy = actions.pending !== null;
  const canOpenFile = onOpenFile !== undefined && artifact.sourcePath !== null;
  return (
    <View style={styles.row}>
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={t("shell.commandCenter.open", { name: artifact.title })}
        onPress={open}
        style={styles.main}
        testID={testID ?? `artifact-row-${artifact.id}`}
      >
        <ArtifactSummary artifact={artifact} />
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

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[2],
    gap: theme.spacing[1],
  },
  main: { flex: 1, minWidth: 0, padding: theme.spacing[3], borderRadius: theme.borderRadius.md },
}));
