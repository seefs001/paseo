import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { AgentProfileGlyph, useAgentProfiles, type AgentProfile } from "@/agent-profiles";
import { startBoardTaskOnHost } from "@/board/tasks";
import {
  DropdownMenuHint,
  DropdownMenuItem,
  useDropdownMenuClose,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import type { ProjectDescriptor } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

/** The `DropdownMenuSubTrigger` on a Fog or Ready card's menu that opens this page. */
export const BOARD_START_WITH_PAGE_ID = "boardStartWith";

const GLYPH_SIZE = 14;

/**
 * Starts the task on the daemon with one of the host's Agent profiles, skipping New workspace.
 * Git projects get a worktree so the task's changes stay off the project's checkout.
 */
export function BoardStartWithPage({
  serverId,
  taskId,
  project,
}: {
  serverId: string;
  taskId: string;
  project: ProjectDescriptor | null;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const close = useDropdownMenuClose();
  const { profiles, isSupported } = useAgentProfiles(serverId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const canCreateWorktree =
    project !== null && canCreateWorktreeForProjectKind(project.projectKind);
  const isolation = canCreateWorktree ? "worktree" : "local";

  const start = useCallback(
    async (profileId: string) => {
      setPendingId(profileId);
      try {
        await startBoardTaskOnHost(serverId, {
          taskId,
          isolation,
          agent: { kind: "profile", profileId },
        });
        close();
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setPendingId(null);
      }
    },
    [close, isolation, serverId, taskId, toast],
  );

  if (!isSupported)
    return <DropdownMenuHint>{t("board.ui.startWith.unsupported")}</DropdownMenuHint>;
  if (profiles === null)
    return <DropdownMenuHint>{t("board.ui.startWith.loading")}</DropdownMenuHint>;
  if (profiles.length === 0) {
    return <DropdownMenuHint>{t("board.ui.startWith.empty")}</DropdownMenuHint>;
  }
  return (
    <>
      {profiles.map((profile) => (
        <StartWithProfileItem
          key={profile.id}
          profile={profile}
          pendingId={pendingId}
          onStart={start}
        />
      ))}
    </>
  );
}

function StartWithProfileItem({
  profile,
  pendingId,
  onStart,
}: {
  profile: AgentProfile;
  pendingId: string | null;
  onStart: (profileId: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => {
    void onStart(profile.id);
  }, [onStart, profile.id]);
  const leading = useMemo(
    () => <AgentProfileGlyph icon={profile.icon} color={profile.color} size={GLYPH_SIZE} />,
    [profile.color, profile.icon],
  );
  return (
    <DropdownMenuItem
      leading={leading}
      status={pendingId === profile.id ? "pending" : "idle"}
      pendingLabel={t("board.ui.startWith.starting")}
      disabled={pendingId !== null && pendingId !== profile.id}
      closeOnSelect={false}
      onSelect={select}
      testID={`board-start-with-${profile.id}`}
    >
      {profile.name}
    </DropdownMenuItem>
  );
}
