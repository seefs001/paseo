import type { Artifact, BoardTask } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Copy, Download, Ellipsis, MessageSquareQuote } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { readArtifact, useArtifact, useArtifactHostState } from "@/artifacts/store";
import {
  closeArtifactViewer,
  dismissArtifactViewer,
  useArtifactViewer,
} from "@/artifacts/viewer-state";
import { ArtifactHostState } from "./collection";
import { ArtifactContent } from "./content";
import { ArtifactSummary } from "./summary";
import { useArtifactActions } from "./use-artifact-actions";
import type { ArtifactQuoteInput } from "./quote";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { openBoardTaskSheet } from "@/board/sheet";
import { useBoardTasks } from "@/board/tasks";
import { useFetchQuery } from "@/data/query";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PaneContentToolbar, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedCopy = withUnistyles(Copy, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedDownload = withUnistyles(Download, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedEllipsis = withUnistyles(Ellipsis, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedQuote = withUnistyles(MessageSquareQuote, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function ArtifactViewerHost(): ReactElement | null {
  const viewer = useArtifactViewer();
  if (viewer.status !== "open") return null;
  return (
    <ArtifactViewer
      key={viewer.openCount}
      serverId={viewer.serverId}
      artifactId={viewer.artifactId}
      visible={viewer.visible}
    />
  );
}

function ArtifactViewer({
  serverId,
  artifactId,
  visible,
}: {
  serverId: string;
  artifactId: string;
  visible: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const artifact = useArtifact(serverId, artifactId);
  const header = useMemo<SheetHeader>(
    () => ({ title: artifact?.title ?? t("artifacts.title") }),
    [artifact, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={closeArtifactViewer}
      onDismiss={dismissArtifactViewer}
      desktopMaxWidth={960}
      desktopHeight="85%"
      scrollable={false}
      contentStyle={styles.container}
      testID="artifact-viewer"
    >
      <ArtifactView serverId={serverId} artifactId={artifactId} onLeave={closeArtifactViewer} />
    </AdaptiveModalSheet>
  );
}

interface ArtifactViewProps {
  serverId: string;
  artifactId: string;
  onLeave: () => void;
  onOpenFile?: (path: string) => void;
  onQuote?: (quote: ArtifactQuoteInput) => void;
}

export function ArtifactView({
  serverId,
  artifactId,
  onLeave,
  onOpenFile,
  onQuote,
}: ArtifactViewProps): ReactElement {
  const { t } = useTranslation();
  const artifact = useArtifact(serverId, artifactId);
  const host = useArtifactHostState(serverId);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const content = useFetchQuery({
    queryKey: ["artifact", serverId, artifactId, artifact?.revision ?? 0],
    queryFn: () => readArtifact(serverId, artifactId),
    enabled: artifact !== null,
    dataShape: "value",
    immutableWhen: () => true,
  });
  const actions = useArtifactActions({
    serverId,
    artifact,
    content: content.data,
    onRemoved: onLeave,
  });
  const busy = actions.pending !== null;
  const detailsHeader = useMemo(() => ({ title: t("artifacts.interaction.details") }), [t]);
  const views = useMemo(
    () => [
      {
        value: "preview" as const,
        label: t("panels.file.editor.preview"),
        testID: "artifact-mode-preview",
      },
      {
        value: "source" as const,
        label: t("panels.file.editor.source"),
        testID: "artifact-mode-source",
      },
    ],
    [t],
  );
  const showDetails = useCallback(() => setDetailsOpen(true), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const leaveDetails = useCallback(() => {
    setDetailsOpen(false);
    onLeave();
  }, [onLeave]);
  const { refetch } = content;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const openFile = useCallback(() => {
    if (artifact?.sourcePath) onOpenFile?.(artifact.sourcePath);
  }, [artifact?.sourcePath, onOpenFile]);
  const quote = useCallback(() => {
    if (content.data) onQuote?.({ artifact: content.data.artifact, text: content.data.content });
  }, [content.data, onQuote]);
  if (host?.status !== "ready") return <ArtifactHostState host={host} />;
  if (!artifact)
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t("artifacts.viewer.missing")}</Text>
      </View>
    );
  const supportsPreview = artifact.media === "markdown" || artifact.media === "html";
  const canQuote = onQuote !== undefined && artifact.media !== "image";
  let body = (
    <View style={styles.center}>
      <Text style={styles.muted}>{t("artifacts.viewer.loading")}</Text>
    </View>
  );
  if (content.isError) {
    body = (
      <View style={styles.center}>
        <Text style={styles.error}>{toErrorMessage(content.error)}</Text>
        <Button variant="outline" onPress={retry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else if (content.data) {
    body = <ArtifactContent payload={content.data} view={view} onQuote={onQuote} />;
  }
  return (
    <View style={styles.container} testID="artifact-document">
      <PaneContentToolbar style={styles.toolbar}>
        <View style={styles.viewSwitcher}>
          {supportsPreview ? (
            <SegmentedControl size="sm" value={view} onValueChange={setView} options={views} />
          ) : (
            <Text style={styles.muted} numberOfLines={1}>
              {t("artifacts.interaction.savedCopy")}
            </Text>
          )}
        </View>
        <ArtifactContentActions
          actions={actions}
          media={artifact.media}
          disabled={!content.data || busy}
        />
        {canQuote ? (
          <ToolbarButton
            label={t("artifacts.interaction.quote")}
            onPress={quote}
            disabled={!content.data}
            testID="artifact-quote"
          >
            <ThemedQuote size={16} />
          </ToolbarButton>
        ) : null}
        <DropdownMenu>
          <ToolbarButton
            kind="menu"
            label={t("workspace.fileActions.moreActions")}
            disabled={busy}
            testID="artifact-actions"
          >
            {busy ? <ThemedSpinner size={14} /> : <ThemedEllipsis size={16} />}
          </ToolbarButton>
          <DropdownMenuContent align="end">
            {onOpenFile && artifact.sourcePath ? (
              <DropdownMenuItem onSelect={openFile} testID="artifact-open-file">
                {t("artifacts.interaction.openFile")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={actions.download}
              disabled={!content.data}
              testID="artifact-download"
            >
              {t("artifacts.interaction.download")}
            </DropdownMenuItem>
            {artifact.sourcePath ? (
              <DropdownMenuItem onSelect={actions.copyPath} testID="artifact-copy-path">
                {t("workspace.fileActions.copyPath")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={showDetails}>
              {t("artifacts.interaction.details")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={actions.remove} testID="artifact-remove">
              {t("artifacts.viewer.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PaneContentToolbar>
      <View style={styles.summary}>
        <ArtifactSummary artifact={artifact} />
      </View>
      {body}
      <AdaptiveModalSheet visible={detailsOpen} onClose={closeDetails} header={detailsHeader}>
        <View style={styles.details}>
          <ArtifactSummary artifact={artifact} />
          <ArtifactLinks serverId={serverId} artifact={artifact} onLeave={leaveDetails} />
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

interface ArtifactContentActionsProps {
  actions: ReturnType<typeof useArtifactActions>;
  media: Artifact["media"];
  disabled: boolean;
}

function ArtifactContentActions({ actions, media, disabled }: ArtifactContentActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      {media !== "image" ? (
        <ToolbarButton
          label={t("common.actions.copy")}
          onPress={actions.copy}
          disabled={disabled}
          testID="artifact-copy"
        >
          {actions.pending === "copy" ? <ThemedSpinner size={14} /> : <ThemedCopy size={16} />}
        </ToolbarButton>
      ) : null}
      <ToolbarButton
        label={t("artifacts.interaction.download")}
        onPress={actions.download}
        disabled={disabled}
        testID="artifact-download-quick"
      >
        {actions.pending === "download" ? (
          <ThemedSpinner size={14} />
        ) : (
          <ThemedDownload size={16} />
        )}
      </ToolbarButton>
    </>
  );
}

/**
 * Where the artifact came from and what it serves. Each link opens the record's own surface; a
 * record that is gone says so instead of opening nothing.
 */
function ArtifactLinks({
  serverId,
  artifact,
  onLeave,
}: {
  serverId: string;
  artifact: Artifact;
  onLeave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const agentKnown = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const id = artifact.sourceAgentId;
    return id ? Boolean(session?.agents.get(id) ?? session?.agentDetails.get(id)) : false;
  });
  const host = useBoardTasks((state) => state.hosts[serverId]);
  const goal = host?.status === "ready" && artifact.goalId ? host.goals.get(artifact.goalId) : null;
  const tasks =
    host?.status === "ready"
      ? artifact.taskIds.map((id) => ({ id, task: host.tasks.get(id) ?? null }))
      : artifact.taskIds.map((id) => ({ id, task: null }));

  const openAgent = useCallback(() => {
    if (!artifact.sourceAgentId) return;
    onLeave();
    navigateToAgent({ serverId, agentId: artifact.sourceAgentId });
  }, [artifact.sourceAgentId, onLeave, serverId]);
  const openGoal = useCallback(() => {
    if (!goal) return;
    onLeave();
    openDeskGoalSheet({ mode: "edit", serverId, goal });
  }, [goal, onLeave, serverId]);

  return (
    <View style={styles.links} testID="artifact-links">
      {artifact.sourceAgentId ? (
        <ArtifactLink
          label={agentKnown ? t("artifacts.viewer.openSource") : null}
          gone={t("artifacts.viewer.sourceGone")}
          onPress={openAgent}
          testID="artifact-open-source"
        />
      ) : null}
      {artifact.goalId ? (
        <ArtifactLink
          label={goal ? `G-${goal.number} ${goal.title}` : null}
          gone={t("artifacts.viewer.goalGone")}
          onPress={openGoal}
          testID="artifact-open-goal"
        />
      ) : null}
      {tasks.map(({ id, task }) => (
        <TaskLink key={id} serverId={serverId} task={task} onLeave={onLeave} />
      ))}
      {artifact.sourcePath ? (
        <Text style={styles.muted} selectable>
          {artifact.sourcePath}
        </Text>
      ) : null}
    </View>
  );
}

/** A link to a record, or a plain note that the record is gone. */
function ArtifactLink({
  label,
  gone,
  onPress,
  testID,
}: {
  label: string | null;
  gone: string;
  onPress: () => void;
  testID: string;
}): ReactElement {
  if (label === null) return <Text style={styles.muted}>{gone}</Text>;
  return (
    <Button variant="outline" size="sm" onPress={onPress} testID={testID}>
      {label}
    </Button>
  );
}

function TaskLink({
  serverId,
  task,
  onLeave,
}: {
  serverId: string;
  task: BoardTask | null;
  onLeave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => {
    if (!task) return;
    onLeave();
    openBoardTaskSheet({ mode: "edit", serverId, task });
  }, [onLeave, serverId, task]);
  return (
    <ArtifactLink
      label={task ? `T-${task.number} ${task.title}` : null}
      gone={t("artifacts.viewer.taskGone")}
      onPress={open}
      testID={task ? `artifact-open-task-${task.number}` : "artifact-task-gone"}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  viewSwitcher: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  summary: {
    flexShrink: 0,
    padding: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  details: { padding: theme.spacing[4], gap: theme.spacing[3] },
  links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
