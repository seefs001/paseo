import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/** Device-local Desk layout: whether the goals pane shows on wide layouts. */
interface BoardLayoutPrefsState {
  goalsPaneHidden: boolean;
  toggleGoalsPane: () => void;
}

const BoardLayoutPrefsSchema = z.object({
  goalsPaneHidden: z.boolean(),
});

export const useBoardLayoutPrefs = create<BoardLayoutPrefsState>()(
  persist(
    (set) => ({
      goalsPaneHidden: false,
      toggleGoalsPane: () => set((state) => ({ goalsPaneHidden: !state.goalsPaneHidden })),
    }),
    {
      name: "desk-layout",
      storage: createValidatedPersistStorage(AsyncStorage, BoardLayoutPrefsSchema),
      partialize: (state) => ({ goalsPaneHidden: state.goalsPaneHidden }),
    },
  ),
);
