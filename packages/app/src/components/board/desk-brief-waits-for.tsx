import type { BoardTask } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { updateBoardTask } from "@/board/tasks";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import {
  BoardTaskBlockersField,
  toBoardTaskRef,
  type BoardTaskRef,
} from "@/components/board/dependency-fields";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { toErrorMessage } from "@/utils/error-messages";
import { useReadyBoardHost } from "./desk-brief-parts";

type Submission = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string };

const NO_TASKS: ReadonlyMap<string, BoardTask> = new Map();

/** "Waits for…" from a card menu: the task's blockers, edited with the task form's field. */
export function DeskWaitsForSheet({
  serverId,
  task,
  visible,
  onClose,
  onDismiss,
}: {
  serverId: string;
  task: BoardTask;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const tasks = useReadyBoardHost(serverId)?.tasks ?? NO_TASKS;
  const [blockers, setBlockers] = useState<BoardTaskRef[]>(() =>
    task.blockedBy.flatMap((id) => toBoardTaskRef(tasks, id) ?? []),
  );
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const saving = submission.status === "saving";

  const save = useCallback(async () => {
    setSubmission({ status: "saving" });
    try {
      await updateBoardTask(serverId, {
        taskId: task.id,
        blockedBy: blockers.map((blocker) => blocker.id),
      });
      onClose();
    } catch (error) {
      setSubmission({ status: "failed", message: toErrorMessage(error) });
    }
  }, [blockers, onClose, serverId, task.id]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("board.brief.card.waitsForTitle", { number: task.number }) }),
    [t, task.number],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button style={styles.footerButton} variant="secondary" onPress={onClose} disabled={saving}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={savePress}
          disabled={saving}
          loading={saving}
          testID="desk-waits-for-save"
        >
          {saving ? t("board.brief.card.saving") : t("board.brief.card.save")}
        </Button>
      </View>
    ),
    [onClose, savePress, saving, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissible={!saving}
      footer={footer}
      testID="desk-waits-for-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.hint}>{task.title}</Text>
        <BoardTaskBlockersField
          tasks={tasks}
          taskId={task.id}
          value={blockers}
          onChange={setBlockers}
          size={controlSize}
        />
        {submission.status === "failed" ? (
          <Text style={styles.error}>
            {t("board.brief.card.saveFailed", { message: submission.message })}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
