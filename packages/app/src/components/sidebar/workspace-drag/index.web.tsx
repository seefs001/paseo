import { createContext, useCallback, useContext, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { density } from "@/styles/density";
import type { Theme } from "@/styles/theme";
import type {
  SidebarWorkspaceDragScopeProps,
  SidebarWorkspaceDragSourceProps,
  SidebarWorkspaceDropSectionProps,
  SidebarWorkspaceSection,
} from "./types";

interface WorkspaceDrop {
  workspace: SidebarWorkspaceEntry;
  section: SidebarWorkspaceSection;
}

interface WorkspaceDragScope {
  workspacesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  supportsPinning: ReadonlyMap<string, boolean>;
  supportsResident: ReadonlyMap<string, boolean>;
  pendingSection: SidebarWorkspaceSection | null;
}

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const WorkspaceDragContext = createContext<WorkspaceDragScope | null>(null);
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [restrictToVerticalAxis];

function useWorkspaceDragScope(): WorkspaceDragScope {
  const scope = useContext(WorkspaceDragContext);
  if (!scope) throw new Error("Sidebar workspace drag scope is missing");
  return scope;
}

function supportsDrop(scope: WorkspaceDragScope, drop: WorkspaceDrop): boolean {
  if (scope.pendingSection) return false;
  const { workspace, section } = drop;
  const supportsResident = scope.supportsResident.get(workspace.serverId) === true;
  if (section === "resident") return supportsResident;
  const supportsPinning = scope.supportsPinning.get(workspace.serverId) === true;
  const canLeaveResident = workspace.residentAt == null || supportsResident;
  return supportsPinning && canLeaveResident;
}

function readSection(value: unknown): SidebarWorkspaceSection | null {
  return value === "resident" || value === "pinned" ? value : null;
}

export function SidebarWorkspaceDragScope({
  workspacesByKey,
  children,
}: SidebarWorkspaceDragScopeProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const serverIds = useMemo(() => {
    const ids = new Set<string>();
    for (const workspace of workspacesByKey.values()) ids.add(workspace.serverId);
    return Array.from(ids);
  }, [workspacesByKey]);
  const supportsPinning = useHostFeatureMap(serverIds, "workspacePinning");
  const supportsResident = useHostFeatureMap(serverIds, "workspaceResident");
  const mutation = useMutation({
    mutationFn: async ({ workspace, section }: WorkspaceDrop) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      if (section === "resident") {
        await client.setWorkspaceResident(workspace.workspaceId, true);
        return;
      }
      // Pin first so a failed pin request never removes the workspace from Resident.
      if (workspace.pinnedAt == null) await client.setWorkspacePinned(workspace.workspaceId, true);
      if (workspace.residentAt != null)
        await client.setWorkspaceResident(workspace.workspaceId, false);
    },
    onError(error) {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
  });
  const pendingSection = mutation.isPending ? mutation.variables.section : null;
  const scope = useMemo(
    () => ({ workspacesByKey, supportsPinning, supportsResident, pendingSection }),
    [workspacesByKey, supportsPinning, supportsResident, pendingSection],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const workspace = workspacesByKey.get(String(args.active.id));
      const containerId = args.active.data.current?.sortable?.containerId;
      const droppableContainers = args.droppableContainers.filter((container) => {
        const section = readSection(container.data.current?.sidebarWorkspaceSection);
        if (!workspace) return !section && !workspacesByKey.has(String(container.id));
        if (section) return supportsDrop(scope, { workspace, section });
        const sameList =
          containerId != null && container.data.current?.sortable?.containerId === containerId;
        return sameList && workspacesByKey.has(String(container.id));
      });
      const filtered = { ...args, droppableContainers };
      if (!workspace || !args.pointerCoordinates) return closestCenter(filtered);
      const hits = pointerWithin(filtered);
      const rowHits = hits.filter((hit) => workspacesByKey.has(String(hit.id)));
      return rowHits.length > 0 ? rowHits : hits;
    },
    [workspacesByKey, scope],
  );
  const { mutate } = mutation;
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const workspace = workspacesByKey.get(String(event.active.id));
      const section = readSection(event.over?.data.current?.sidebarWorkspaceSection);
      if (!workspace || !section) return;
      const drop = { workspace, section };
      if (!supportsDrop(scope, drop)) return;
      if (section === "resident" && workspace.residentAt != null) return;
      const alreadyPinned = workspace.pinnedAt != null && workspace.residentAt == null;
      if (section === "pinned" && alreadyPinned) return;
      mutate(drop);
    },
    [workspacesByKey, scope, mutate],
  );

  return (
    <WorkspaceDragContext.Provider value={scope}>
      <DndContext
        sensors={sensors}
        modifiers={MODIFIERS}
        collisionDetection={collisionDetection}
        onDragEnd={handleDragEnd}
      >
        {children}
        <WorkspaceDragOverlay />
      </DndContext>
    </WorkspaceDragContext.Provider>
  );
}

function WorkspaceDragOverlay() {
  const { active } = useDndContext();
  const { workspacesByKey } = useWorkspaceDragScope();
  const workspace = active ? workspacesByKey.get(String(active.id)) : null;
  return (
    <DragOverlay dropAnimation={null}>
      {workspace ? (
        <View style={styles.preview}>
          <Text numberOfLines={1} style={styles.previewTitle}>
            {workspace.name}
          </Text>
        </View>
      ) : null}
    </DragOverlay>
  );
}

export function SidebarWorkspaceDragSource(props: SidebarWorkspaceDragSourceProps) {
  if (props.dragHandleProps) {
    return props.children({ isDragging: props.isDragging, dragHandleProps: props.dragHandleProps });
  }
  return <WorkspaceDragSource {...props} />;
}

function WorkspaceDragSource({
  workspaceKey,
  disabled = false,
  children,
}: SidebarWorkspaceDragSourceProps) {
  const scope = useWorkspaceDragScope();
  const workspace = scope.workspacesByKey.get(workspaceKey);
  const canDropResident =
    workspace != null && supportsDrop(scope, { workspace, section: "resident" });
  const canDropPinned = workspace != null && supportsDrop(scope, { workspace, section: "pinned" });
  const enabled = !disabled && (canDropResident || canDropPinned);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: workspaceKey,
    disabled: !enabled,
  });
  const setActivatorRef = useCallback(
    (node: unknown) => {
      if (node === null || node instanceof HTMLElement) setActivatorNodeRef(node);
    },
    [setActivatorNodeRef],
  );
  const dragHandleProps = useMemo(
    () => ({
      attributes: { ...attributes },
      listeners: { ...listeners },
      setActivatorNodeRef: setActivatorRef,
    }),
    [attributes, listeners, setActivatorRef],
  );
  const style = useMemo(() => ({ opacity: isDragging ? 0.3 : 1 }), [isDragging]);
  const activeDragHandleProps = enabled ? dragHandleProps : undefined;
  return (
    <div ref={setNodeRef} style={style}>
      {children({ isDragging, dragHandleProps: activeDragHandleProps })}
    </div>
  );
}

export function SidebarWorkspaceDropSection({
  section,
  hasItems,
  children,
}: SidebarWorkspaceDropSectionProps) {
  const scope = useWorkspaceDragScope();
  const { active } = useDndContext();
  const workspace = active ? scope.workspacesByKey.get(String(active.id)) : null;
  const enabled = workspace != null && supportsDrop(scope, { workspace, section });
  const { setNodeRef, isOver } = useDroppable({
    id: `sidebar-workspace-drop-${section}`,
    data: { sidebarWorkspaceSection: section },
    disabled: !enabled,
  });
  const pending = scope.pendingSection === section;
  if (!hasItems && !enabled && !pending) return null;
  return (
    <div ref={setNodeRef}>
      <View
        style={[styles.section, enabled && styles.dropAvailable, isOver && styles.dropHovered]}
        testID={`sidebar-${section}-section`}
      >
        {children}
        {pending ? (
          <View style={styles.pending} testID={`sidebar-${section}-saving`}>
            <ThemedLoadingSpinner size={14} uniProps={spinnerColor} />
          </View>
        ) : null}
      </View>
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: "transparent",
    position: "relative",
  },
  dropAvailable: {
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    minHeight: density.rowHeight,
  },
  dropHovered: {
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pending: {
    position: "absolute",
    right: theme.spacing[8],
    top: theme.spacing[2],
  },
  preview: {
    minHeight: density.rowHeight,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.md,
  },
  previewTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
