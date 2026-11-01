import AsyncStorage from "@react-native-async-storage/async-storage";
import { BOARD_DESK_ZONE_IDS } from "@getpaseo/protocol/messages";
import { useCallback } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type DeskZoneId = (typeof BOARD_DESK_ZONE_IDS)[number];

/** How the Desk looks on this device. How it works is a host setting every device shares. */
export interface DeskPrefs {
  density: "comfortable" | "compact";
  /** Which details cards show. */
  fields: {
    model: boolean;
    branch: boolean;
    labels: boolean;
    pullRequest: boolean;
    timer: boolean;
    context: boolean;
  };
  /** Zone widths in px from dragging zone edges; a missing zone uses its default width. */
  zoneWidths: Partial<Record<DeskZoneId, number>>;
}

export const DEFAULT_DESK_PREFS: DeskPrefs = {
  density: "comfortable",
  fields: {
    model: true,
    branch: true,
    labels: true,
    pullRequest: true,
    timer: true,
    context: false,
  },
  zoneWidths: {},
};

const ZoneWidthSchema = z.number().positive().optional();

const DeskPrefsSchema = z.strictObject({
  prefs: z.strictObject({
    density: z.enum(["comfortable", "compact"]),
    fields: z.strictObject({
      model: z.boolean(),
      branch: z.boolean(),
      labels: z.boolean(),
      pullRequest: z.boolean(),
      timer: z.boolean(),
      context: z.boolean(),
    }),
    zoneWidths: z.strictObject({
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

export function updateDeskPrefs(patch: Partial<DeskPrefs>): void {
  useDeskPrefsStore.setState((state) => ({ prefs: { ...state.prefs, ...patch } }));
}

export function useDeskPrefs(): { prefs: DeskPrefs; update: (patch: Partial<DeskPrefs>) => void } {
  const prefs = useDeskPrefsStore((state) => state.prefs);
  const update = useCallback((patch: Partial<DeskPrefs>) => updateDeskPrefs(patch), []);
  return { prefs, update };
}
