import AsyncStorage from "@react-native-async-storage/async-storage";
import { BOARD_DESK_ZONE_IDS } from "@getpaseo/protocol/messages";
import { useCallback } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type DeskZoneId = (typeof BOARD_DESK_ZONE_IDS)[number];

/** How the Desk looks on this device: only the zone widths dragged on wide layouts. */
export interface DeskPrefs {
  /** Zone widths in px; a missing zone uses its default width. */
  zoneWidths: Partial<Record<DeskZoneId, number>>;
}

export const DEFAULT_DESK_PREFS: DeskPrefs = { zoneWidths: {} };

const ZoneWidthSchema = z.number().positive().optional();

// Density and card fields were removed; z.object drops them from older saved prefs.
const DeskPrefsSchema = z.object({
  prefs: z.object({
    zoneWidths: z.object({
      decide: ZoneWidthSchema,
      flight: ZoneWidthSchema,
      ahead: ZoneWidthSchema,
      landed: ZoneWidthSchema,
    }),
  }),
});

interface DeskPrefsState {
  prefs: DeskPrefs;
}

const useDeskPrefsStore = create<DeskPrefsState>()(
  persist(() => ({ prefs: DEFAULT_DESK_PREFS }), {
    name: "desk-prefs",
    storage: createValidatedPersistStorage(AsyncStorage, DeskPrefsSchema),
  }),
);

export function useDeskPrefs(): { prefs: DeskPrefs; update: (patch: Partial<DeskPrefs>) => void } {
  const prefs = useDeskPrefsStore((state) => state.prefs);
  const update = useCallback(
    (patch: Partial<DeskPrefs>) =>
      useDeskPrefsStore.setState((state) => ({ prefs: { ...state.prefs, ...patch } })),
    [],
  );
  return { prefs, update };
}
