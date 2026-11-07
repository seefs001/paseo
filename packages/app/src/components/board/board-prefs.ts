import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DESK_MODES, type DeskMode } from "@/board/desk-mode";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** Device-local Desk layout: the goals pane on wide layouts and the last mode. */
interface BoardLayoutPrefsState {
  goalsPaneHidden: boolean;
  mode: DeskMode;
  toggleGoalsPane: () => void;
  setMode: (mode: DeskMode) => void;
}

const BoardLayoutPrefsSchema = z.object({
  goalsPaneHidden: z.boolean(),
  mode: z.enum(DESK_MODES).optional(),
});

export const useBoardLayoutPrefs = create<BoardLayoutPrefsState>()(
  persist(
    (set) => ({
      goalsPaneHidden: false,
      mode: "handle",
      toggleGoalsPane: () => set((state) => ({ goalsPaneHidden: !state.goalsPaneHidden })),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "desk-layout",
      storage: createValidatedPersistStorage(AsyncStorage, BoardLayoutPrefsSchema),
      partialize: (state) => ({ goalsPaneHidden: state.goalsPaneHidden, mode: state.mode }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<BoardLayoutPrefsState>),
        mode: (persisted as Partial<BoardLayoutPrefsState> | undefined)?.mode ?? current.mode,
      }),
    },
  ),
);
