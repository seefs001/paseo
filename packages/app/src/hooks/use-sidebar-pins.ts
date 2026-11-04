import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";
import { useSessionStore } from "@/stores/session-store";

export interface PinnedSidebarKeys {
  pinnedWorkspaceKeys: string[];
  // workspaceKey -> pinnedAt ISO string, used to order by recency.
  pinnedAtByKey: Record<string, string>;
  // Resident chats are the user's standing bots. They get their own section above Pinned.
  residentWorkspaceKeys?: string[];
  residentAtByKey?: Record<string, string>;
}

export interface PinnedSidebarGroups {
  // Resident chats, hoisted above Pinned. Oldest marked first, so a bot keeps its slot.
  residentChats: SidebarWorkspacePlacement[];
  // Individually pinned chats, hoisted into the Pinned section and removed from their
  // project below. Most recently pinned first.
  pinnedChats: SidebarWorkspacePlacement[];
  // Everything else, with pinned chats removed. Feeds the draggable project list.
  unpinnedProjects: SidebarProjectEntry[];
}

function projectWithoutPinnedWorkspaces(
  project: SidebarProjectEntry,
  pinnedWorkspaceKeys: ReadonlySet<string>,
): SidebarProjectEntry {
  const workspaces = project.workspaces.filter(
    (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
  );
  // Keep the project even when every chat moved to Pinned. The project row owns
  // its settings and new-workspace actions; chats are not its ownership boundary.
  return workspaces.length === project.workspaces.length ? project : { ...project, workspaces };
}

function buildPinnedSidebarKeys(
  projects: SidebarProjectEntry[],
  workspaceMaps: ReadonlyMap<string, ReadonlyMap<string, SidebarPinFields>>,
): PinnedSidebarKeys {
  const pinnedWorkspaceKeys: string[] = [];
  const pinnedAtByKey: Record<string, string> = {};
  const residentWorkspaceKeys: string[] = [];
  const residentAtByKey: Record<string, string> = {};

  for (const project of projects) {
    for (const placement of project.workspaces) {
      const workspace = workspaceMaps.get(placement.serverId)?.get(placement.workspaceId);
      if (workspace?.residentAt) {
        residentWorkspaceKeys.push(placement.workspaceKey);
        residentAtByKey[placement.workspaceKey] = workspace.residentAt;
      } else if (workspace?.pinnedAt) {
        pinnedWorkspaceKeys.push(placement.workspaceKey);
        pinnedAtByKey[placement.workspaceKey] = workspace.pinnedAt;
      }
    }
  }
  return { pinnedWorkspaceKeys, pinnedAtByKey, residentWorkspaceKeys, residentAtByKey };
}

interface SidebarPinFields {
  pinnedAt?: string | null;
  residentAt?: string | null;
}

function areKeyListsEqual(
  left: string[],
  leftAt: Record<string, string>,
  right: string[],
  rightAt: Record<string, string>,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const key = left[index];
    if (key !== right[index] || (key && leftAt[key] !== rightAt[key])) return false;
  }
  return true;
}

function arePinnedSidebarKeysEqual(left: PinnedSidebarKeys, right: PinnedSidebarKeys): boolean {
  return (
    areKeyListsEqual(
      left.pinnedWorkspaceKeys,
      left.pinnedAtByKey,
      right.pinnedWorkspaceKeys,
      right.pinnedAtByKey,
    ) &&
    areKeyListsEqual(
      left.residentWorkspaceKeys ?? [],
      left.residentAtByKey ?? {},
      right.residentWorkspaceKeys ?? [],
      right.residentAtByKey ?? {},
    )
  );
}

export function usePinnedSidebarKeys(projects: SidebarProjectEntry[]): PinnedSidebarKeys {
  const previousKeysRef = useRef<PinnedSidebarKeys>({
    pinnedWorkspaceKeys: [],
    pinnedAtByKey: {},
    residentWorkspaceKeys: [],
    residentAtByKey: {},
  });
  const serverIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
        ),
      ),
    [projects],
  );
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces ?? null),
    shallow,
  );
  return useMemo(() => {
    const workspaceMapByServerId = new Map<string, ReadonlyMap<string, SidebarPinFields>>();
    for (let index = 0; index < serverIds.length; index += 1) {
      const serverId = serverIds[index];
      const workspaceMap = workspaceMaps[index];
      if (serverId && workspaceMap) {
        workspaceMapByServerId.set(serverId, workspaceMap);
      }
    }
    const nextKeys = buildPinnedSidebarKeys(projects, workspaceMapByServerId);
    if (arePinnedSidebarKeysEqual(previousKeysRef.current, nextKeys)) {
      return previousKeysRef.current;
    }
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [projects, serverIds, workspaceMaps]);
}

// Splits the sidebar into a dedicated Pinned section (chats) and the regular list below.
// Pinned chats are ordered most-recently-pinned first.
export function splitPinnedSidebarGroups(input: {
  projects: SidebarProjectEntry[];
  keys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
}): PinnedSidebarGroups {
  const { projects, keys, pinnedWorkspaceOrder } = input;
  const residentWorkspaceKeys = keys.residentWorkspaceKeys ?? [];
  const residentAtByKey = keys.residentAtByKey ?? {};
  if (keys.pinnedWorkspaceKeys.length === 0 && residentWorkspaceKeys.length === 0) {
    return { residentChats: [], pinnedChats: [], unpinnedProjects: projects };
  }
  const pinnedWorkspaceKeySet = new Set(keys.pinnedWorkspaceKeys);
  const residentWorkspaceKeySet = new Set(residentWorkspaceKeys);
  const hoistedWorkspaceKeySet = new Set([...pinnedWorkspaceKeySet, ...residentWorkspaceKeySet]);
  const residentChats: SidebarWorkspacePlacement[] = [];
  const pinnedChats: SidebarWorkspacePlacement[] = [];
  const unpinnedProjects: SidebarProjectEntry[] = [];

  for (const project of projects) {
    for (const workspace of project.workspaces) {
      if (residentWorkspaceKeySet.has(workspace.workspaceKey)) {
        residentChats.push(workspace);
      } else if (pinnedWorkspaceKeySet.has(workspace.workspaceKey)) {
        pinnedChats.push(workspace);
      }
    }
    unpinnedProjects.push(projectWithoutPinnedWorkspaces(project, hoistedWorkspaceKeySet));
  }

  residentChats.sort((a, b) =>
    (residentAtByKey[a.workspaceKey] ?? "").localeCompare(residentAtByKey[b.workspaceKey] ?? ""),
  );

  pinnedChats.sort((a, b) =>
    (keys.pinnedAtByKey[b.workspaceKey] ?? "").localeCompare(
      keys.pinnedAtByKey[a.workspaceKey] ?? "",
    ),
  );

  return {
    residentChats,
    pinnedChats: applyStoredOrdering({
      items: pinnedChats,
      storedOrder: pinnedWorkspaceOrder,
      getKey: (workspace) => workspace.workspaceKey,
    }),
    unpinnedProjects,
  };
}
