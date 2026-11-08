import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { WorkspaceProjectDescriptorPayload } from "@getpaseo/protocol/messages";
import {
  MenuItem,
  MenuTextField,
  menuRowContentInset,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export const WORKSPACE_PROJECT_PAGE_ID = "workspaceProject";

interface WorkspaceProjectTarget {
  serverId: string;
  workspaceId: string;
}

export function useWorkspaceProjectMenuPages(
  serverId: string | undefined,
  workspaceId: string | undefined,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      serverId && workspaceId
        ? [
            {
              id: WORKSPACE_PROJECT_PAGE_ID,
              title: t("workspaceProject.title"),
              hoverIntent: false,
              content: <WorkspaceProjectPage serverId={serverId} workspaceId={workspaceId} />,
            },
          ]
        : [],
    [serverId, workspaceId, t],
  );
}

function WorkspaceProjectPage(target: WorkspaceProjectTarget) {
  const supported = useHostFeature(target.serverId, "workspaceProjectChange");
  const { t } = useTranslation();
  if (!supported) return <Text style={styles.hint}>{t("workspaceProject.updateHost")}</Text>;
  return <WorkspaceProjectPicker {...target} />;
}

function WorkspaceProjectPicker({ serverId, workspaceId }: WorkspaceProjectTarget) {
  const { t } = useTranslation();
  const toast = useToast();
  const { setOpen } = useMenuContext("WorkspaceProjectPicker");
  const isCompact = useIsCompactFormFactor();
  const [query, setQuery] = useState("");
  const workspace = useSessionStore((state) =>
    state.sessions[serverId]?.workspaces.get(workspaceId),
  );
  const projects = useFetchQuery({
    dataShape: "list",
    staleTimeMs: 0,
    queryKey: ["workspaceProjectTargets", serverId],
    queryFn: async () => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      return (await client.listProjects()).projects;
    },
  });
  const mutation = useMutation({
    mutationFn: async (project: WorkspaceProjectDescriptorPayload | null) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceProject({ workspaceId, projectId: project?.projectId ?? null });
    },
    onSuccess: (_result, project) => {
      toast.show(
        project
          ? t("workspaceProject.success", { name: project.projectDisplayName })
          : t("workspaceProject.unassignedSuccess"),
      );
      setOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });
  const { mutate } = mutation;
  const unassign = useCallback(() => mutate(null), [mutate]);
  const { refetch } = projects;
  const retry = useCallback(() => void refetch(), [refetch]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const options = useMemo(
    () =>
      (projects.data ?? [])
        .filter((project) =>
          `${project.projectDisplayName} ${project.projectRootPath}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
        .sort((left, right) => left.projectDisplayName.localeCompare(right.projectDisplayName)),
    [projects.data, normalizedQuery],
  );

  if (!workspace) return <Text style={styles.hint}>{t("workspaceProject.unavailable")}</Text>;

  return (
    <>
      <Text style={styles.hint} testID="workspace-project-current">
        {t("workspaceProject.current", {
          name:
            workspace.projectId === null
              ? t("workspaceProject.none")
              : workspace.projectDisplayName,
        })}
      </Text>
      <Text style={styles.hint}>{t("workspaceProject.effect")}</Text>
      <MenuTextField
        placeholder={t("workspaceProject.search")}
        onChangeText={setQuery}
        autoFocus={!isCompact}
        editable={!mutation.isPending}
        testID="workspace-project-search"
      />
      <MenuItem
        selected={workspace.projectId === null}
        disabled={mutation.isPending || workspace.projectId === null}
        status={mutation.isPending && mutation.variables === null ? "pending" : "idle"}
        pendingLabel={t("workspaceProject.changing")}
        closeOnSelect={false}
        onSelect={unassign}
        testID="workspace-project-unassign"
      >
        {t("workspaceProject.none")}
      </MenuItem>
      {projects.isPending ? <Text style={styles.hint}>{t("workspaceProject.loading")}</Text> : null}
      {projects.isError ? (
        <>
          <Text style={styles.hint}>{projects.error.message}</Text>
          <MenuItem closeOnSelect={false} onSelect={retry}>
            {t("workspaceProject.retry")}
          </MenuItem>
        </>
      ) : null}
      {projects.isSuccess && options.length === 0 ? (
        <Text style={styles.hint}>{t("workspaceProject.empty")}</Text>
      ) : null}
      {options.map((project) => (
        <WorkspaceProjectOption
          key={project.projectId}
          project={project}
          selected={project.projectId === workspace.projectId}
          disabled={mutation.isPending}
          pending={mutation.isPending && mutation.variables?.projectId === project.projectId}
          onSelect={mutation.mutate}
        />
      ))}
      {mutation.isError ? (
        <Text style={styles.hint} testID="workspace-project-error">
          {mutation.error.message}
        </Text>
      ) : null}
    </>
  );
}

function WorkspaceProjectOption({
  project,
  selected,
  disabled,
  pending,
  onSelect,
}: {
  project: WorkspaceProjectDescriptorPayload;
  selected: boolean;
  disabled: boolean;
  pending: boolean;
  onSelect: (project: WorkspaceProjectDescriptorPayload) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(project), [onSelect, project]);
  return (
    <MenuItem
      description={project.projectRootPath}
      selected={selected}
      disabled={disabled || selected}
      status={pending ? "pending" : "idle"}
      pendingLabel={t("workspaceProject.changing")}
      closeOnSelect={false}
      onSelect={select}
      testID={`workspace-project-option-${project.projectId}`}
    >
      {project.projectDisplayName}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: menuRowContentInset(theme),
    paddingVertical: theme.spacing[1],
  },
}));
