import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import type { TFunction } from "i18next";
import { useIsFocused } from "expo-router";
import { ListTodo } from "lucide-react-native";
import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DeskArtifactRow } from "@/components/desk/artifact";
import { DeskHostNotices } from "@/components/desk/host-notices";
import { DeskRequestRow } from "@/components/desk/request-row";
import { DeskRowDivider, DeskSection } from "@/components/desk/section";
import {
  DeskActiveRow,
  DeskRecentRow,
  NO_WAITS,
  type DeskSessionWaits,
} from "@/components/desk/session-row";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import type { DeskArtifact, DeskModel, DeskSession } from "@/desk/model";
import { useDesk } from "@/desk/use-desk";

type RequestKind = AgentPermissionRequest["kind"];

const CONTENT_MAX_WIDTH = 780;
const NO_ARTIFACTS: readonly DeskArtifact[] = [];

/**
 * An optional view over the conversations the user already has: what is waiting on them, what is
 * active, and what replied. It only reads, answers existing requests, opens existing artifacts and
 * returns to the conversation. Not opening it changes nothing.
 */
export function DeskScreen({ onOpenTasks }: { onOpenTasks: () => void }): ReactElement {
  const isFocused = useIsFocused();
  const desk = useDesk({ enabled: isFocused });
  const { t } = useTranslation();
  const tasksAction = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={ListTodo}
        onPress={onOpenTasks}
        testID="desk-open-tasks"
      >
        {t("desk.tasksAndGoals")}
      </Button>
    ),
    [onOpenTasks, t],
  );
  return (
    <View style={styles.container}>
      <MenuHeader title={t("desk.title")} rightContent={tasksAction} />
      {isFocused ? <DeskContent desk={desk} /> : null}
    </View>
  );
}

interface DeskLayers {
  waitsBySession: ReadonlyMap<string, DeskSessionWaits>;
  artifactsBySession: ReadonlyMap<string, DeskArtifact[]>;
  workspaceArtifacts: DeskArtifact[];
}

function buildLayers(desk: DeskModel): DeskLayers {
  const waitsBySession = new Map<string, DeskSessionWaits>();
  for (const request of desk.requests) {
    if (!request.session) continue;
    const previous = waitsBySession.get(request.session.key) ?? NO_WAITS;
    const requestKinds: RequestKind[] = [...previous.requestKinds];
    if (request.kind === "permission" && !requestKinds.includes(request.request.kind)) {
      requestKinds.push(request.request.kind);
    }
    const hasOpenDecision = previous.hasOpenDecision || request.kind === "decision";
    waitsBySession.set(request.session.key, { requestKinds, hasOpenDecision });
  }
  const recentKeys = new Set(desk.recentReplies.map((session) => session.key));
  const artifactsBySession = new Map<string, DeskArtifact[]>();
  const workspaceArtifacts: DeskArtifact[] = [];
  for (const entry of desk.artifacts) {
    const sourceKey = entry.sourceSession?.key;
    if (sourceKey && recentKeys.has(sourceKey)) {
      const list = artifactsBySession.get(sourceKey) ?? [];
      list.push(entry);
      artifactsBySession.set(sourceKey, list);
    } else {
      workspaceArtifacts.push(entry);
    }
  }
  return { waitsBySession, artifactsBySession, workspaceArtifacts };
}

function DeskContent({ desk }: { desk: DeskModel }): ReactElement {
  const { t } = useTranslation();
  const layers = useMemo(() => buildLayers(desk), [desk]);
  const { counts } = desk;
  const unrespondable = desk.requests.length - counts.needsYou;
  const needsNote = needsYouNote({ unrespondable, isComplete: counts.isComplete, t });
  const currentActive = desk.activeSessions.filter((session) => session.freshness === "current");
  const unknownActive = desk.activeSessions.length - currentActive.length;
  const activeNote =
    unknownActive > 0 ? t("desk.section.unknownCount", { count: unknownActive }) : null;
  const currentRecent = desk.recentReplies.filter((session) => session.freshness === "current");
  const recentCount = currentRecent.length + layers.workspaceArtifacts.length;
  const recentRows = desk.recentReplies.length + layers.workspaceArtifacts.length;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.column}>
        <DeskSection
          title={t("desk.section.needsYou")}
          count={counts.needsYou}
          rowCount={desk.requests.length}
          note={needsNote}
          empty={t("desk.empty.needsYou")}
          testID="desk-needs-you"
        >
          {desk.requests.map((request, index) => (
            <DeskRowDivider key={request.key} first={index === 0}>
              <DeskRequestRow item={request} />
            </DeskRowDivider>
          ))}
        </DeskSection>
        <DeskHostNotices hosts={desk.hosts} />
        <DeskSection
          title={t("desk.section.active")}
          count={currentActive.length}
          rowCount={desk.activeSessions.length}
          note={activeNote}
          empty={t("desk.empty.active")}
          testID="desk-active"
        >
          {desk.activeSessions.map((session, index) => (
            <DeskRowDivider key={session.key} first={index === 0}>
              <DeskActiveRow session={session} waits={waitsFor(layers, session)} />
            </DeskRowDivider>
          ))}
        </DeskSection>
        <DeskSection
          title={t("desk.section.recent")}
          count={recentCount}
          rowCount={recentRows}
          note={t("desk.section.recentNote")}
          empty={t("desk.empty.recent")}
          testID="desk-recent"
        >
          {desk.recentReplies.map((session, index) => (
            <DeskRowDivider key={session.key} first={index === 0}>
              <DeskRecentRow
                session={session}
                artifacts={layers.artifactsBySession.get(session.key) ?? NO_ARTIFACTS}
              />
            </DeskRowDivider>
          ))}
          {layers.workspaceArtifacts.map((entry, index) => (
            <DeskRowDivider key={entry.key} first={index === 0 && desk.recentReplies.length === 0}>
              <DeskArtifactRow entry={entry} />
            </DeskRowDivider>
          ))}
        </DeskSection>
      </View>
    </ScrollView>
  );
}

function needsYouNote(input: {
  unrespondable: number;
  isComplete: boolean;
  t: TFunction;
}): string | null {
  const { unrespondable, isComplete, t } = input;
  if (unrespondable > 0) return t("desk.section.notRespondable", { count: unrespondable });
  if (!isComplete) return t("desk.section.incomplete");
  return null;
}

function waitsFor(layers: DeskLayers, session: DeskSession): DeskSessionWaits {
  return layers.waitsBySession.get(session.key) ?? NO_WAITS;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[12],
  },
  column: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    gap: theme.spacing[6],
  },
}));
