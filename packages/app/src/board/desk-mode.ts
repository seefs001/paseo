import type { DeskZoneId } from "@/components/board/board-desk";

/**
 * The Desk answers one question at a time. Each mode shows only the zones that answer it,
 * so the four zones never compete for the same screen.
 */
export const DESK_MODES = ["handle", "plan", "overview"] as const;
export type DeskMode = (typeof DESK_MODES)[number];

const MODE_ZONES: Record<DeskMode, readonly DeskZoneId[] | "all"> = {
  handle: ["decide", "flight"],
  plan: ["ahead"],
  overview: "all",
};

/** Keeps the host's zone order and visibility; a mode only narrows them. */
export function zonesForMode<Zone extends { id: DeskZoneId }>(
  mode: DeskMode,
  zones: readonly Zone[],
): Zone[] {
  const wanted = MODE_ZONES[mode];
  if (wanted === "all") return [...zones];
  return zones.filter((zone) => wanted.includes(zone.id));
}

/** Plan creates ideas and tasks; Handle and Overview capture straight to Ready. */
export function modeShowsCapture(mode: DeskMode): boolean {
  return mode !== "overview";
}
