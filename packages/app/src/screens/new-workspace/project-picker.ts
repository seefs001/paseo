import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { isWorkspaceArchivePending } from "@/contexts/session-workspace-upserts";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectSourceDirectory,
  resolveInitialWorkspaceProject,
  type HostProjectListItem,
} from "@/projects/host-projects";
import {
  NO_PROJECT_OPTION_ID,
  createManualProjectSelectionContextKey,
  createProjectSelectionContextKey,
  createProjectSelection,
  reconcileProjectSelection,
  resolveInitialProjectSelectionSource,
  resolveProjectSelection,
  type ProjectSelection,
  type ProjectSelectionContext,
} from "./project-selection";

const PROJECT_OPTION_PREFIX = "project:";

interface NewWorkspaceProjectPickerInput {
  selectedServerId: string;
  projects: HostProjectListItem[];
  routeProject: HostProjectListItem | null;
  routeProjectContextViewKey: string | null;
  lastActiveProject: HostProjectListItem | null;
  allowAllProjects: boolean;
  allowNoProject?: boolean;
  initiallyUnassigned?: boolean;
  unassignedDirectory?: string;
  routeServerId?: string;
}

interface NewWorkspaceProjectPickerState {
  selectedProject: HostProjectListItem | null;
  selectedSourceDirectory: string | null;
  projectPickerOptions: ComboboxOptionType[];
  projectByOptionId: Map<string, HostProjectListItem>;
  selectedProjectOptionId: string;
  projectTriggerLabel: string;
  handleSelectProjectOption: (id: string) => void;
}

function projectOptionId(projectId: string): string {
  return `${PROJECT_OPTION_PREFIX}${projectId}`;
}

function computeProjectOptionData(projects: readonly HostProjectListItem[]) {
  const projectByOptionId = new Map<string, HostProjectListItem>();
  const options = projects.map((project) => {
    const id = projectOptionId(project.viewKey);
    projectByOptionId.set(id, project);
    return { id, label: project.projectName };
  });
  return { options, projectByOptionId };
}

function resolveWorkspaceIdFromProjectWorkspaceKey(input: {
  selectedServerId: string;
  workspaceKey: string;
}): string | null {
  const prefix = `${input.selectedServerId}:`;
  return input.workspaceKey.startsWith(prefix) ? input.workspaceKey.slice(prefix.length) : null;
}

function hasPendingArchiveForProject(input: {
  selectedServerId: string;
  project: HostProjectListItem;
}): boolean {
  for (const workspaceKey of input.project.workspaceKeys) {
    const workspaceId = resolveWorkspaceIdFromProjectWorkspaceKey({
      selectedServerId: input.selectedServerId,
      workspaceKey,
    });
    if (
      workspaceId &&
      isWorkspaceArchivePending({ serverId: input.selectedServerId, workspaceId })
    ) {
      return true;
    }
  }

  return false;
}

export function useNewWorkspaceProjectPicker({
  selectedServerId,
  projects,
  routeProject,
  routeProjectContextViewKey,
  lastActiveProject,
  allowAllProjects,
  allowNoProject = false,
  initiallyUnassigned = false,
  unassignedDirectory,
  routeServerId,
}: NewWorkspaceProjectPickerInput): NewWorkspaceProjectPickerState {
  const { t } = useTranslation();
  const selectableProjects = useMemo(
    () =>
      filterWorkspaceProjectsForHost({ projects, serverId: selectedServerId, allowAllProjects }),
    [allowAllProjects, projects, selectedServerId],
  );
  const initialProject = useMemo(
    () =>
      resolveInitialWorkspaceProject({
        routeProject,
        lastActiveProject,
        projects: selectableProjects,
        serverId: selectedServerId,
        allowAllProjects,
      }),
    [allowAllProjects, lastActiveProject, routeProject, selectableProjects, selectedServerId],
  );

  const selectionContextKey = createProjectSelectionContextKey({
    selectedServerId,
    routeProjectViewKey: routeProjectContextViewKey,
    allowAllProjects,
  });
  const manualSelectionContextKey = createManualProjectSelectionContextKey({
    routeProjectViewKey: routeProjectContextViewKey,
  });
  const shouldPreserveMissingProject = useCallback(
    (project: HostProjectListItem) =>
      hasPendingArchiveForProject({
        selectedServerId,
        project,
      }),
    [selectedServerId],
  );
  const selectionContext = useMemo<ProjectSelectionContext>(
    () => ({
      contextKey: selectionContextKey,
      manualContextKey: manualSelectionContextKey,
      selectedServerId,
      initialProject,
      initialProjectSource: resolveInitialProjectSelectionSource({
        initialProject,
        routeProject,
        lastActiveProject,
      }),
      projects: selectableProjects,
      routeProject,
      lastActiveProject,
      shouldPreserveMissingProject,
    }),
    [
      initialProject,
      lastActiveProject,
      manualSelectionContextKey,
      routeProject,
      selectableProjects,
      selectedServerId,
      selectionContextKey,
      shouldPreserveMissingProject,
    ],
  );
  const [projectSelection, setProjectSelection] = useState<ProjectSelection>(() => {
    if (initiallyUnassigned) {
      return { contextKey: manualSelectionContextKey, project: null, source: "none" };
    }
    return createProjectSelection(selectionContext);
  });

  useEffect(() => {
    setProjectSelection((current) => reconcileProjectSelection(current, selectionContext));
  }, [selectionContext]);

  const activeSelection = reconcileProjectSelection(projectSelection, selectionContext);
  const selectedProject = resolveProjectSelection(activeSelection, selectionContext);
  const { options: projectPickerOptions, projectByOptionId } = useMemo(() => {
    const data = computeProjectOptionData(selectableProjects);
    if (allowNoProject) {
      data.options.unshift({ id: NO_PROJECT_OPTION_ID, label: t("workspaceProject.none") });
    }
    return data;
  }, [allowNoProject, selectableProjects, t]);
  const handleSelectProjectOption = useCallback(
    (id: string) => {
      if (id === NO_PROJECT_OPTION_ID && allowNoProject) {
        setProjectSelection({
          contextKey: manualSelectionContextKey,
          project: null,
          source: "none",
        });
        return;
      }
      const project = projectByOptionId.get(id);
      if (!project) return;
      if (
        !allowAllProjects &&
        !project.hosts.some((host) => host.worktreeSupport !== "unsupported")
      )
        return;
      setProjectSelection({
        contextKey: manualSelectionContextKey,
        project,
        originProject: project,
        source: "manual",
      });
    },
    [allowAllProjects, allowNoProject, manualSelectionContextKey, projectByOptionId],
  );

  let selectedSourceDirectory: string | null = null;
  let selectedProjectOptionId = "";
  let projectTriggerLabel = "Choose project";
  if (selectedProject) {
    selectedSourceDirectory = getHostProjectSourceDirectory(selectedProject, selectedServerId);
    selectedProjectOptionId = projectOptionId(selectedProject.viewKey);
    projectTriggerLabel = selectedProject.projectName;
  } else if (allowNoProject || activeSelection.source === "none") {
    selectedSourceDirectory = "~";
    if (initiallyUnassigned && selectedServerId === routeServerId) {
      selectedSourceDirectory = unassignedDirectory?.trim() || "~";
    }
    selectedProjectOptionId = NO_PROJECT_OPTION_ID;
    projectTriggerLabel = t("workspaceProject.none");
  }

  return {
    selectedProject,
    selectedSourceDirectory,
    projectPickerOptions,
    projectByOptionId,
    selectedProjectOptionId,
    projectTriggerLabel,
    handleSelectProjectOption,
  };
}
