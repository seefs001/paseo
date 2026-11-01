import type { BoardDecision, BoardGoal } from "@getpaseo/protocol/messages";
import { NotebookPen, SquareArrowOutUpRight } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAgentProfiles } from "@/agent-profiles";
import { resolveBoardDecision } from "@/board/tasks";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { DeskClamp } from "@/components/board/desk-clamp";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { AgentChip, TaskChip, useReadyBoardHost } from "./desk-brief-parts";

/** A brief taller than this folds; the options stay in view under it. */
const BRIEF_CLAMP_HEIGHT = 160;

type Submission =
  | { status: "idle" }
  | { status: "sending"; choiceId: string }
  | { status: "failed"; message: string };

/**
 * A decision brief: the agent's Markdown brief and one button per option. The choice, with the
 * optional note, goes back to the agent as its next prompt.
 */
export function DeskBriefDecision({
  serverId,
  decision,
  goal,
}: {
  serverId: string;
  decision: BoardDecision;
  goal: BoardGoal | null;
}): ReactElement {
  const { t } = useTranslation();
  const controlSize = useIsCompactFormFactor() ? "md" : "sm";
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const sending = submission.status === "sending";

  const choose = useCallback(
    async (choiceId: string) => {
      setSubmission({ status: "sending", choiceId });
      try {
        const trimmed = note.trim();
        await resolveBoardDecision(serverId, {
          decisionId: decision.id,
          choiceId,
          ...(trimmed ? { note: trimmed } : {}),
        });
        setSubmission({ status: "idle" });
      } catch (error) {
        setSubmission({ status: "failed", message: toErrorMessage(error) });
      }
    },
    [decision.id, note, serverId],
  );
  const openNote = useCallback(() => setNoteOpen(true), []);

  return (
    <View style={styles.container}>
      {decision.kind === "autopilot_start" ? (
        <AutopilotStartFacts serverId={serverId} decision={decision} goal={goal} />
      ) : (
        <DecisionAgent serverId={serverId} agentId={decision.agentId} />
      )}
      {decision.brief.trim() ? (
        <DeskClamp maxHeight={BRIEF_CLAMP_HEIGHT} testID={`desk-decision-brief-${decision.id}`}>
          <MarkdownRenderer text={decision.brief} compact />
        </DeskClamp>
      ) : null}
      {noteOpen ? (
        <FormTextInput
          size={controlSize}
          initialValue=""
          onChangeText={setNote}
          placeholder={t("board.brief.decision.notePlaceholder")}
          accessibilityLabel={t("board.brief.decision.note")}
          multiline
          editable={!sending}
          autoFocus
          testID={`desk-decision-note-${decision.id}`}
        />
      ) : null}
      <View style={styles.options}>
        {decision.options.map((option, index) => (
          <DecisionOption
            key={option.id}
            id={option.id}
            label={option.label}
            primary={index === 0}
            submission={submission}
            onChoose={choose}
          />
        ))}
        {noteOpen ? null : (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={NotebookPen}
            onPress={openNote}
            disabled={sending}
            testID={`desk-decision-add-note-${decision.id}`}
          >
            {t("board.brief.decision.note")}
          </Button>
        )}
      </View>
      {submission.status === "failed" ? (
        <Text style={styles.error}>
          {t("board.brief.decision.failed", { message: submission.message })}
        </Text>
      ) : null}
    </View>
  );
}

function DecisionOption({
  id,
  label,
  primary,
  submission,
  onChoose,
}: {
  id: string;
  label: string;
  primary: boolean;
  submission: Submission;
  onChoose: (choiceId: string) => Promise<void>;
}): ReactElement {
  const press = useCallback(() => {
    void onChoose(id);
  }, [id, onChoose]);
  const sending = submission.status === "sending";
  return (
    <Button
      size="xs"
      variant={primary ? "default" : "secondary"}
      onPress={press}
      loading={sending && submission.choiceId === id}
      disabled={sending}
      testID={`desk-decision-option-${id}`}
    >
      {label}
    </Button>
  );
}

/** Who is asking, with a way into their session. */
function DecisionAgent({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const agent = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents.get(agentId) ?? null) : null,
  );
  const open = useCallback(() => {
    if (agentId) navigateToAgent({ serverId, agentId });
  }, [agentId, serverId]);
  if (!agent) return null;
  return (
    <View style={styles.facts}>
      <AgentChip title={agent.title?.trim() || t("board.brief.decision.unnamedAgent")} />
      <Button size="xs" variant="ghost" leftIcon={SquareArrowOutUpRight} onPress={open}>
        {t("board.brief.decision.openAgent")}
      </Button>
    </View>
  );
}

/** What Autopilot wants to start, and with which profile. */
function AutopilotStartFacts({
  serverId,
  decision,
  goal,
}: {
  serverId: string;
  decision: BoardDecision;
  goal: BoardGoal | null;
}): ReactElement {
  const { t } = useTranslation();
  const host = useReadyBoardHost(serverId);
  const task = decision.taskId ? (host?.tasks.get(decision.taskId) ?? null) : null;
  const { profiles } = useAgentProfiles(serverId);
  const agent = goal?.autopilot?.agent ?? null;
  const profileName = useMemo(() => {
    if (!agent) return null;
    if (agent.kind === "config") {
      return agent.model ? `${agent.provider} · ${agent.model}` : agent.provider;
    }
    return profiles?.find((profile) => profile.id === agent.profileId)?.name ?? agent.profileId;
  }, [agent, profiles]);
  return (
    <View style={styles.facts}>
      {task ? <TaskChip task={task} /> : null}
      {profileName ? (
        <Text style={styles.muted} numberOfLines={1}>
          {t("board.brief.decision.startsWith", { profile: profileName })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  muted: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
