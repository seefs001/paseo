import type { ArtifactReadPayload } from "@getpaseo/client/internal/daemon-client";
import type { Artifact, BoardTask } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { readArtifact, removeArtifact, useArtifact } from "@/artifacts/store";
import {
  closeArtifactViewer,
  dismissArtifactViewer,
  useArtifactViewer,
} from "@/artifacts/viewer-state";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { openBoardTaskSheet } from "@/board/sheet";
import { useBoardTasks } from "@/board/tasks";
import { useFetchQuery } from "@/data/query";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { FileHtmlPreview } from "@/file-panels/html-preview";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";

/** Mounted once in the app shell. */
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

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

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
    () => ({
      title: artifact?.title ?? t("artifacts.viewer.missing"),
      subtitle: artifact ? <ArtifactMeta artifact={artifact} /> : undefined,
    }),
    [artifact, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={closeArtifactViewer}
      onDismiss={dismissArtifactViewer}
      desktopMaxWidth={960}
      testID="artifact-viewer"
    >
      <ArtifactView serverId={serverId} artifactId={artifactId} onLeave={closeArtifactViewer} />
    </AdaptiveModalSheet>
  );
}

export function ArtifactMeta({ artifact }: { artifact: Artifact }): ReactElement {
  const { t } = useTranslation();
  return (
    <Text style={styles.muted} numberOfLines={1}>
      {t("artifacts.row.meta", {
        kind: t(`artifacts.kinds.${artifact.kind}`),
        revision: artifact.revision,
        time: formatTimeAgo(new Date(artifact.updatedAt)),
      })}
    </Text>
  );
}

/**
 * One artifact: where it came from and what it serves, then its content. The workspace side pane
 * and the goal's viewer both render this. `onLeave` runs before a link navigates away.
 */
export function ArtifactView({
  serverId,
  artifactId,
  onLeave,
}: {
  serverId: string;
  artifactId: string;
  onLeave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const artifact = useArtifact(serverId, artifactId);
  const revision = artifact?.revision ?? 0;
  // The key carries the revision, so an update reads the new copy and an old one never changes.
  const content = useFetchQuery({
    queryKey: ["artifact", serverId, artifactId, revision],
    queryFn: () => readArtifact(serverId, artifactId),
    enabled: artifact !== null,
    dataShape: "value",
    immutableWhen: () => true,
  });
  const remove = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("artifacts.viewer.removeTitle"),
      message: t("artifacts.viewer.removeMessage"),
      confirmLabel: t("artifacts.viewer.remove"),
      destructive: true,
    });
    if (!confirmed) return;
    await removeArtifact(serverId, artifactId);
    onLeave();
  }, [artifactId, onLeave, serverId, t]);
  const removePress = useCallback(() => {
    void remove().catch(() => undefined);
  }, [remove]);

  return (
    <View style={styles.body}>
      {artifact ? (
        <ArtifactLinks serverId={serverId} artifact={artifact} onLeave={onLeave} />
      ) : null}
      <ArtifactBody exists={artifact !== null} query={content} />
      {artifact ? (
        <View style={styles.footer}>
          <Button variant="ghost" size="sm" onPress={removePress} testID="artifact-remove">
            {t("artifacts.viewer.remove")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function ArtifactBody({
  exists,
  query,
}: {
  exists: boolean;
  query: ReturnType<typeof useFetchQuery<ArtifactReadPayload>>;
}): ReactElement {
  const { t } = useTranslation();
  if (!exists) return <Text style={styles.muted}>{t("artifacts.viewer.missing")}</Text>;
  if (query.isError) return <Text style={styles.error}>{toErrorMessage(query.error)}</Text>;
  if (!query.data) return <Text style={styles.muted}>{t("artifacts.viewer.loading")}</Text>;
  return (
    <ArtifactContent
      artifact={query.data.artifact}
      content={query.data.content}
      encoding={query.data.encoding}
    />
  );
}

function ArtifactContent({
  artifact,
  content,
  encoding,
}: {
  artifact: Artifact;
  content: string;
  encoding: "utf8" | "base64";
}): ReactElement {
  switch (artifact.media) {
    case "markdown":
      return <MarkdownRenderer text={content} selectable />;
    case "html":
      return (
        <View style={styles.frame}>
          <FileHtmlPreview html={content} testID="artifact-html" />
        </View>
      );
    case "image": {
      const extension = artifact.fileName.split(".").pop()?.toLowerCase() ?? "";
      const mime = IMAGE_MIME[extension] ?? "image/png";
      return (
        <ArtifactImage
          uri={`data:${mime};base64,${encoding === "base64" ? content : ""}`}
          title={artifact.title}
        />
      );
    }
    case "text":
      return (
        <ScrollView horizontal style={styles.textScroll}>
          <Text selectable style={styles.code} testID="artifact-text">
            {content}
          </Text>
        </ScrollView>
      );
  }
}

function ArtifactImage({ uri, title }: { uri: string; title: string }): ReactElement {
  const source = useMemo(() => ({ uri }), [uri]);
  return (
    <Image
      source={source}
      style={styles.image}
      resizeMode="contain"
      accessibilityLabel={title}
      testID="artifact-image"
    />
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
        <Text style={styles.muted} numberOfLines={1}>
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
  body: {
    gap: theme.spacing[4],
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  frame: {
    height: 520,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 480,
  },
  textScroll: {
    maxHeight: 560,
  },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
}));
