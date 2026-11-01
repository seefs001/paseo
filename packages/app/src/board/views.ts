import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { EMPTY_BOARD_FILTERS, type BoardFilters } from "./items";

/** A named Desk filter. Zones always show; a view only narrows which work they hold. */
export interface BoardView {
  id: string;
  /** An i18n key for built-in views; the user's own name for saved ones. */
  name: string;
  builtin: boolean;
  filters: BoardFilters;
}

export const BOARD_BUILTIN_VIEWS: readonly BoardView[] = [
  {
    id: "all",
    name: "board.desk.views.all",
    builtin: true,
    filters: EMPTY_BOARD_FILTERS,
  },
];

export function boardViewLabel(view: BoardView, t: TFunction): string {
  return view.builtin ? t(view.name) : view.name;
}

// Views saved before the Desk also carried columns; the non-strict object drops them on load.
const SavedBoardViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filters: z.object({
    query: z.string(),
    projects: z.array(z.string()),
    workspaces: z.array(z.string()),
    providers: z.array(z.string()),
    labels: z.array(z.string()),
  }),
});
type SavedBoardView = z.infer<typeof SavedBoardViewSchema>;

const PersistedBoardViewsSchema = z.object({ views: z.array(SavedBoardViewSchema) });
type PersistedBoardViews = z.infer<typeof PersistedBoardViewsSchema>;

interface BoardViewsState extends PersistedBoardViews {
  save: (name: string, filters: BoardFilters) => BoardView;
  remove: (id: string) => void;
}

function toBoardView(view: SavedBoardView): BoardView {
  return { ...view, builtin: false };
}

/** Saved views are a per-device preference, like the sidebar's filters. */
const useBoardViewsStore = create<BoardViewsState>()(
  persist<BoardViewsState, [], [], PersistedBoardViews>(
    (set) => ({
      views: [],
      save: (name, filters) => {
        const view: SavedBoardView = {
          id: `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim(),
          filters: {
            query: filters.query,
            projects: [...filters.projects],
            workspaces: [...filters.workspaces],
            providers: [...filters.providers],
            labels: [...filters.labels],
          },
        };
        set((state) => ({ views: [...state.views, view] }));
        return toBoardView(view);
      },
      remove: (id) => set((state) => ({ views: state.views.filter((view) => view.id !== id) })),
    }),
    {
      name: "board-views",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedBoardViewsSchema),
      partialize: (state) => ({ views: state.views }),
    },
  ),
);

export function useSavedBoardViews(): {
  views: BoardView[];
  save(name: string, filters: BoardFilters): BoardView;
  remove(id: string): void;
} {
  const saved = useBoardViewsStore((state) => state.views);
  const save = useBoardViewsStore((state) => state.save);
  const remove = useBoardViewsStore((state) => state.remove);
  const views = useMemo(() => saved.map(toBoardView), [saved]);
  return useMemo(() => ({ views, save, remove }), [remove, save, views]);
}
