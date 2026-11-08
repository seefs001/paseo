import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AgentProfileGlyph, useAgentProfiles, type AgentProfile } from "@/agent-profiles";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useHostDirectories } from "@/stores/session-store-hooks";
import { DeskDropTarget, useDeskDragActive } from "./desk-dnd";
import { isPlannedTask, type DeskDropTargetSpec } from "./desk-dnd-drop";

/**
 * While a planned task from this host is dragged, the host's Agent profiles appear as drop targets:
 * dropping the task on one starts it with that profile. Git projects start in a worktree.
 */
export function DeskProfileDock({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const active = useDeskDragActive();
  const task = active?.type === "task" && active.serverId === serverId ? active.task : null;
  const { profiles } = useAgentProfiles(task ? serverId : null);
  const supportsProjectlessCreate = useHostFeature(serverId, "workspaceProjectlessCreate");
  const serverIds = useMemo(() => [serverId], [serverId]);
  const [directory] = useHostDirectories(serverIds);
  const projectKind = task?.projectId
    ? directory?.projects.get(task.projectId)?.projectKind
    : undefined;
  const isolation =
    projectKind && canCreateWorktreeForProjectKind(projectKind) ? "worktree" : "local";

  if (!task || !isPlannedTask(task) || task.claimedBy !== null) return null;
  if (task.projectId === null && !supportsProjectlessCreate) return null;
  return (
    <View style={styles.dock} testID="desk-profile-dock">
      <Text style={styles.label}>{t("board.plan2.dnd.startWith")}</Text>
      {profiles && profiles.length > 0 ? (
        <View style={styles.profiles}>
          {profiles.map((profile) => (
            <DeskProfileTarget
              key={profile.id}
              serverId={serverId}
              profile={profile}
              isolation={isolation}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{t("board.plan2.dnd.noProfiles")}</Text>
      )}
    </View>
  );
}

function DeskProfileTarget({
  serverId,
  profile,
  isolation,
}: {
  serverId: string;
  profile: AgentProfile;
  isolation: "local" | "worktree";
}): ReactElement {
  const target = useMemo<DeskDropTargetSpec>(
    () => ({ type: "profile", serverId, profileId: profile.id, isolation }),
    [isolation, profile.id, serverId],
  );
  return (
    <DeskDropTarget target={target} style={styles.profile}>
      <View style={styles.profileBody} testID={`desk-profile-target-${profile.id}`}>
        <AgentProfileGlyph icon={profile.icon} color={profile.color} />
        <Text style={styles.profileName} numberOfLines={1}>
          {profile.name}
        </Text>
      </View>
    </DeskDropTarget>
  );
}

const styles = StyleSheet.create((theme) => ({
  dock: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  profiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  profile: {
    borderRadius: theme.borderRadius.lg,
  },
  profileBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 200,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  profileName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));
