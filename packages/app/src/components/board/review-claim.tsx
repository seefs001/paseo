import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { updateBoardTask } from "@/board/tasks";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

const SHORT_ID_LENGTH = 8;

/** The claiming agent's title, or a short id when this app does not know the agent. */
export function useClaimantName(serverId: string, agentId: string | null): string | null {
  const title = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents.get(agentId)?.title ?? null) : null,
  );
  if (agentId === null) return null;
  return title ?? agentId.slice(0, SHORT_ID_LENGTH);
}

/** "Claimed by <agent>" with Release, which hands the task back to the frontier. */
export function BoardReviewClaim({
  serverId,
  taskId,
  claimantName,
}: {
  serverId: string;
  taskId: string;
  claimantName: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>
        {t("board.review.claim.claimedBy", { name: claimantName })}
      </Text>
      <BoardReleaseClaimButton serverId={serverId} taskId={taskId} />
    </View>
  );
}

/** Clears the claim so the task returns to the frontier. */
export function BoardReleaseClaimButton({
  serverId,
  taskId,
}: {
  serverId: string;
  taskId: string;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [releasing, setReleasing] = useState(false);
  const release = useCallback(async () => {
    setReleasing(true);
    try {
      await updateBoardTask(serverId, { taskId, claimedBy: null });
    } catch (error) {
      toast.error(t("board.review.claim.releaseFailed", { message: toErrorMessage(error) }));
    } finally {
      setReleasing(false);
    }
  }, [serverId, t, taskId, toast]);
  const releasePress = useCallback(() => {
    void release();
  }, [release]);

  return (
    <Button
      size="sm"
      variant="ghost"
      onPress={releasePress}
      loading={releasing}
      disabled={releasing}
      testID={`board-card-release-${taskId}`}
    >
      {releasing ? t("board.review.claim.releasing") : t("board.review.claim.release")}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
