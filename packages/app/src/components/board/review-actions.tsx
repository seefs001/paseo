import type { CheckoutPrMergeMethod } from "@getpaseo/protocol/messages";
import { Check, ChevronDown, MessageSquare } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BoardCard } from "@/board/columns";
import { BoardReviewChangesSheet } from "@/components/board/review-changes-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { getForgePresentation } from "@/git/forge";
import { narrowPullRequestState, type GitActionId } from "@/git/policy";
import { useGitActions } from "@/git/use-actions";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";

const MERGE_METHOD_BY_ACTION: Partial<Record<GitActionId, CheckoutPrMergeMethod>> = {
  "merge-pr-squash": "squash",
  "merge-pr-merge": "merge",
  "merge-pr-rebase": "rebase",
};

const ThemedChevron = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const acceptTrailing = <ThemedChevron size={12} uniProps={mutedColorMapping} />;

const noop = () => undefined;

type SheetState = "closed" | "open" | "closing";

/**
 * Accept and Request changes on a Review card. Accept archives the workspace, which marks the task
 * done on the daemon; with a mergeable change request it offers to merge first.
 */
export function BoardReviewActions({
  card,
  workspace,
}: {
  card: BoardCard;
  workspace: WorkspaceDescriptor;
}): ReactElement {
  const { t } = useTranslation();
  const { serverId, task } = card;
  const [hiding, setHiding] = useState(false);
  const [sheet, setSheet] = useState<SheetState>("closed");
  const agentId = useSessionStore(
    (state) => state.sessions[serverId]?.workspaceAgentActivity.get(workspace.id)?.agentId ?? null,
  );
  const { archive } = useWorkspaceArchive({
    serverId,
    workspaceId: workspace.id,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    isDirty: workspace.gitRuntime?.isDirty,
    aheadOfOrigin: workspace.gitRuntime?.aheadOfOrigin,
    diffStat: workspace.diffStat,
    onArchiveStarted: noop,
    onSetHiding: setHiding,
  });
  const archiving = hiding || workspace.archivingAt !== null;
  const pullRequest = workspace.githubRuntime?.pullRequest;
  const hasOpenChangeRequest =
    pullRequest != null &&
    !pullRequest.isMerged &&
    narrowPullRequestState(pullRequest.state) === "open";

  const openSheet = useCallback(() => setSheet("open"), []);
  const closeSheet = useCallback(() => setSheet("closing"), []);
  const dismissSheet = useCallback(() => setSheet("closed"), []);

  return (
    <View style={styles.row}>
      {hasOpenChangeRequest ? (
        <MergeAwareAccept
          serverId={serverId}
          workspace={workspace}
          archive={archive}
          archiving={archiving}
        />
      ) : (
        <AcceptButton onPress={archive} busy={archiving} archiving={archiving} />
      )}
      <Button
        size="sm"
        variant="ghost"
        leftIcon={MessageSquare}
        onPress={openSheet}
        disabled={agentId === null || archiving}
        accessibilityHint={agentId === null ? t("board.review.changes.noAgent") : undefined}
        testID={`board-review-request-changes-${task.id}`}
      >
        {t("board.review.requestChanges")}
      </Button>
      {sheet !== "closed" && agentId !== null ? (
        <BoardReviewChangesSheet
          serverId={serverId}
          agentId={agentId}
          taskTitle={task.title}
          visible={sheet === "open"}
          onClose={closeSheet}
          onDismiss={dismissSheet}
        />
      ) : null}
    </View>
  );
}

/** Accept when the workspace has an open change request: merge it if the forge allows, then archive. */
function MergeAwareAccept({
  serverId,
  workspace,
  archive,
  archiving,
}: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  archive: () => void;
  archiving: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const cwd = workspace.workspaceDirectory;
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  // The workspace's own git actions decide whether a direct merge is available right now.
  const { gitActions } = useGitActions({ serverId, cwd, icons: GIT_ACTION_ICONS });
  const mergeMethod = useMemo(() => {
    const actions = [gitActions.primary, ...gitActions.secondary, ...gitActions.menu];
    for (const action of actions) {
      const method = action ? MERGE_METHOD_BY_ACTION[action.id] : undefined;
      if (method && action && !action.disabled) return method;
    }
    return null;
  }, [gitActions]);
  const noun = getForgePresentation(workspace.forge ?? "").changeRequestAbbrev;
  const busy = merging || archiving;

  const mergeAndArchive = useCallback(async () => {
    if (!mergeMethod) return;
    setMerging(true);
    try {
      await useCheckoutGitActionsStore.getState().mergePr({ serverId, cwd, method: mergeMethod });
    } catch (error) {
      toast.error(t("board.review.mergeFailed", { noun, message: toErrorMessage(error) }));
      return;
    } finally {
      setMerging(false);
    }
    archive();
  }, [archive, cwd, mergeMethod, noun, serverId, t, toast]);
  const mergeSelect = useCallback(() => {
    void mergeAndArchive();
  }, [mergeAndArchive]);
  const openMenu = useCallback(() => setOpen(true), []);

  if (!mergeMethod) return <AcceptButton onPress={archive} busy={busy} archiving={archiving} />;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* The trigger anchors the menu; the button inside takes the press and opens it. */}
      <DropdownMenuTrigger disabled={busy} accessibilityLabel={t("board.review.accept")}>
        <AcceptButton
          onPress={openMenu}
          busy={busy}
          archiving={archiving}
          mergingNoun={merging ? noun : null}
          trailing={acceptTrailing}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={240}>
        <DropdownMenuItem onSelect={mergeSelect} testID="board-review-merge-and-archive">
          {t("board.review.mergeAndArchive", { noun })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={archive} testID="board-review-archive-only">
          {t("board.review.archiveOnly")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AcceptButton({
  onPress,
  busy,
  archiving,
  mergingNoun = null,
  trailing,
}: {
  onPress: () => void;
  busy: boolean;
  archiving: boolean;
  mergingNoun?: string | null;
  trailing?: ReactElement;
}): ReactElement {
  const { t } = useTranslation();
  let label = t("board.review.accept");
  if (mergingNoun !== null) label = t("board.review.merging", { noun: mergingNoun });
  else if (archiving) label = t("board.review.archiving");
  return (
    <Button
      size="sm"
      variant="secondary"
      leftIcon={Check}
      trailing={trailing}
      onPress={onPress}
      loading={busy}
      disabled={busy}
      testID="board-review-accept"
    >
      {label}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
