import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { useCallback, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { DeskArtifact, DeskSession } from "@/desk/model";
import { DeskArtifactChip } from "./artifact";
import { DeskReturnButton, openDeskConversation, useDeskSessionLabels } from "./session";

type RequestKind = AgentPermissionRequest["kind"];

/** What a session is blocked on, from requests the Desk already shows above. */
export interface DeskSessionWaits {
  requestKinds: readonly RequestKind[];
  hasOpenDecision: boolean;
}

export const NO_WAITS: DeskSessionWaits = { requestKinds: [], hasOpenDecision: false };

type Dot = "running" | "waiting" | "failed" | "quiet" | "unknown";

/**
 * A session that is working, blocked on a request, failed, or last seen on an offline host. A
 * pending tool request or question blocks the turn, so its reason replaces "Running". An open
 * Decision does not prove the agent stopped, so the literal status stays and the decision is only
 * noted. A failure shows the agent's own error text and nothing guessed beyond it.
 */
export function DeskActiveRow({
  session,
  waits,
}: {
  session: DeskSession;
  waits: DeskSessionWaits;
}): ReactElement {
  const { t } = useTranslation();
  const labels = useDeskSessionLabels(session);
  const isUnknown = session.freshness === "last-known" || session.currentStatus === null;
  const failed = session.currentStatus === "error";
  const blocking = waits.requestKinds;
  let dot: Dot = "running";
  let status: string;
  if (isUnknown) {
    dot = "unknown";
    status = t("desk.session.unknown");
  } else if (blocking.length > 0) {
    dot = "waiting";
    status = blocking.map((kind) => t(`desk.session.waiting.${kind}`)).join(", ");
  } else if (failed) {
    dot = "failed";
    status = t("desk.session.status.error");
  } else {
    status = t(`desk.session.status.${session.currentStatus}`);
  }
  const decisionNote = waits.hasOpenDecision && !isUnknown ? t("desk.session.openDecision") : null;
  const lastError = failed ? session.agent.lastError : null;
  return (
    <SessionRow
      session={session}
      dot={dot}
      title={labels.title}
      meta={joinParts([labels.workspace, session.serverName, status, decisionNote])}
    >
      {lastError ? (
        <Text style={styles.error} numberOfLines={3} selectable>
          {lastError}
        </Text>
      ) : null}
    </SessionRow>
  );
}

/**
 * A session whose turn ended with an unseen reply. The flag is the existing attention state and
 * clears the way it always has, when the conversation is opened. Ending a turn never means the
 * work is done.
 */
export function DeskRecentRow({
  session,
  artifacts,
}: {
  session: DeskSession;
  artifacts: readonly DeskArtifact[];
}): ReactElement {
  const { t } = useTranslation();
  const labels = useDeskSessionLabels(session);
  const isCurrent = session.freshness === "current" && session.currentStatus !== null;
  const meta = isCurrent
    ? [
        labels.workspace,
        session.serverName,
        t(`desk.session.status.${session.currentStatus}`),
        t("desk.session.newReply"),
      ]
    : [
        labels.workspace,
        session.serverName,
        t("desk.session.unknown"),
        t("desk.session.lastKnownReply"),
      ];
  return (
    <SessionRow
      session={session}
      dot={isCurrent ? "quiet" : "unknown"}
      title={labels.title}
      meta={joinParts(meta)}
      unread={isCurrent}
    >
      {artifacts.length > 0 ? (
        <View style={styles.chips}>
          {artifacts.map((entry) => (
            <DeskArtifactChip key={entry.artifact.id} entry={entry} />
          ))}
        </View>
      ) : null}
    </SessionRow>
  );
}

interface SessionRowProps {
  session: DeskSession;
  dot: Dot;
  title: string;
  meta: string;
  unread?: boolean;
  children?: ReactNode;
}

function SessionRow({
  session,
  dot,
  title,
  meta,
  unread = false,
  children,
}: SessionRowProps): ReactElement {
  const open = useCallback(() => openDeskConversation(session), [session]);
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <PressHighlight
          accessibilityRole="button"
          onPress={open}
          style={styles.main}
          testID={`desk-session-${session.agent.id}`}
        >
          <View style={[styles.dot, dotStyle(dot)]} />
          <View style={styles.text}>
            <View style={styles.titleLine}>
              <Text style={unread ? styles.titleUnread : styles.title} numberOfLines={1}>
                {title}
              </Text>
              {session.isChild ? <ChildTag /> : null}
            </View>
            <Text style={styles.meta} numberOfLines={2}>
              {meta}
            </Text>
          </View>
        </PressHighlight>
        {children ? <View style={styles.extra}>{children}</View> : null}
      </View>
      <DeskReturnButton session={session} />
    </View>
  );
}

function ChildTag(): ReactElement {
  const { t } = useTranslation();
  return <Text style={styles.childTag}>{t("desk.session.child")}</Text>;
}

function dotStyle(dot: Dot) {
  if (dot === "running") return styles.dotRunning;
  if (dot === "waiting") return styles.dotWaiting;
  if (dot === "failed") return styles.dotFailed;
  if (dot === "unknown") return styles.dotUnknown;
  return styles.dotQuiet;
}

function joinParts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

const DOT_SIZE = 7;

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  extra: {
    paddingLeft: theme.spacing[4] + DOT_SIZE + theme.spacing[3],
    paddingBottom: theme.spacing[3],
    marginTop: -theme.spacing[2],
  },
  main: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingLeft: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  childTag: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  titleUnread: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    paddingTop: theme.spacing[1],
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
    paddingTop: theme.spacing[1.5],
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginTop: theme.spacing[1.5],
  },
  dotRunning: {
    backgroundColor: theme.colors.statusDotRunning,
  },
  dotWaiting: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  dotFailed: {
    backgroundColor: theme.colors.statusDotDanger,
  },
  dotQuiet: {
    backgroundColor: theme.colors.surface3,
  },
  dotUnknown: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.foregroundMuted,
  },
}));
