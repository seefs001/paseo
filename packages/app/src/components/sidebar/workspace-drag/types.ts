import type { ReactNode } from "react";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

export type SidebarWorkspaceSection = "resident" | "pinned";

export interface SidebarWorkspaceDragScopeProps {
  workspacesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  children: ReactNode;
}

export interface SidebarWorkspaceDragPresentation {
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

export interface SidebarWorkspaceDragSourceProps extends SidebarWorkspaceDragPresentation {
  workspaceKey: string;
  disabled?: boolean;
  children: (presentation: SidebarWorkspaceDragPresentation) => ReactNode;
}

export interface SidebarWorkspaceDropSectionProps {
  section: SidebarWorkspaceSection;
  hasItems: boolean;
  children: ReactNode;
}
