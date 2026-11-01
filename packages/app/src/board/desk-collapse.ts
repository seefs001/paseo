import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Which Desk groups and Fog lists this device keeps folded. Keys name a group in a zone or a
 * group's Fog list; a key whose group is gone stays harmless until it comes back.
 */
interface DeskCollapseState {
  collapsed: string[];
}

const DeskCollapseSchema = z.strictObject({ collapsed: z.array(z.string()) });

const useDeskCollapseStore = create<DeskCollapseState>()(
  persist((): DeskCollapseState => ({ collapsed: [] }), {
    name: "desk-collapsed",
    storage: createValidatedPersistStorage(AsyncStorage, DeskCollapseSchema),
  }),
);

export function deskGroupCollapseKey(zone: string, groupKey: string): string {
  return `group:${zone}:${groupKey}`;
}

export function deskFogCollapseKey(groupKey: string): string {
  return `fog:${groupKey}`;
}

export function useDeskCollapsed(key: string): { collapsed: boolean; toggle: () => void } {
  const collapsed = useDeskCollapseStore((state) => state.collapsed.includes(key));
  const toggle = useCallback(() => {
    useDeskCollapseStore.setState((state) => ({
      collapsed: state.collapsed.includes(key)
        ? state.collapsed.filter((entry) => entry !== key)
        : [...state.collapsed, key],
    }));
  }, [key]);
  return { collapsed, toggle };
}
