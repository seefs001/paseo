import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  selectSidebarViewSnapshot,
  SidebarViewSnapshotSchema,
  useSidebarViewStore,
  type SidebarViewSnapshot,
} from "@/stores/sidebar-view-store";

const SavedSidebarViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  snapshot: SidebarViewSnapshotSchema,
});
export type SavedSidebarView = z.infer<typeof SavedSidebarViewSchema>;

const PersistedSidebarViewsSchema = z.object({ views: z.array(SavedSidebarViewSchema) });
type PersistedSidebarViews = z.infer<typeof PersistedSidebarViewsSchema>;

interface SidebarSavedViewsState extends PersistedSidebarViews {
  save: (name: string) => boolean;
  apply: (id: string) => void;
  remove: (id: string) => void;
}

export function sidebarSavedViewKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

export function matchesSidebarView(view: SavedSidebarView, current: SidebarViewSnapshot): boolean {
  const saved = view.snapshot;
  return (
    saved.groupMode === current.groupMode &&
    saved.workspaceSort === current.workspaceSort &&
    saved.showBackground === current.showBackground &&
    sameSelection(saved.hostFilters, current.hostFilters) &&
    sameSelection(saved.projectFilters, current.projectFilters) &&
    sameSelection(saved.labelFilter.labels, current.labelFilter.labels)
  );
}

// Saved views stay on this device, independently of host-owned label catalogs.
export const useSidebarSavedViewsStore = create<SidebarSavedViewsState>()(
  persist<SidebarSavedViewsState, [], [], PersistedSidebarViews>(
    (set, get) => ({
      views: [],
      save: (input) => {
        const name = input.replace(/\s+/g, " ").trim();
        const id = sidebarSavedViewKey(name);
        const exists = get().views.some((view) => view.id === id);
        if (!name || exists) return false;
        const snapshot = selectSidebarViewSnapshot(useSidebarViewStore.getState());
        const view: SavedSidebarView = { id, name, snapshot };
        set((state) => ({ views: [...state.views, view] }));
        return true;
      },
      apply: (id) => {
        const view = get().views.find((entry) => entry.id === id);
        if (view) useSidebarViewStore.setState(view.snapshot);
      },
      remove: (id) => set((state) => ({ views: state.views.filter((view) => view.id !== id) })),
    }),
    {
      name: "sidebar-saved-views",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSidebarViewsSchema),
      partialize: (state) => ({ views: state.views }),
    },
  ),
);
