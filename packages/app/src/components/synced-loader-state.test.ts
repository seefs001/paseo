import { describe, expect, test } from "vitest";
import {
  SYNCED_LOADER_STEP_MS,
  getSyncedLoaderDotOpacity,
  getSyncedLoaderStep,
  msUntilNextSyncedLoaderStep,
} from "./synced-loader-state";

describe("synced loader state", () => {
  test("advances through six wall-clock-aligned steps every 950 milliseconds", () => {
    const sampleTimes = [0, 158, 159, 316, 317, 474, 475, 633, 634, 791, 792, 949, 950];

    const steps = sampleTimes.map(getSyncedLoaderStep);

    expect(steps).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0]);
  });

  test("waits until the next step instead of the next display frame", () => {
    expect(msUntilNextSyncedLoaderStep(0)).toBeCloseTo(SYNCED_LOADER_STEP_MS, 5);
    expect(msUntilNextSyncedLoaderStep(100)).toBeCloseTo(SYNCED_LOADER_STEP_MS - 100, 5);
    expect(msUntilNextSyncedLoaderStep(158)).toBe(1);
    expect(msUntilNextSyncedLoaderStep(159)).toBeGreaterThan(150);
  });

  test("preserves the six visible snake states", () => {
    const states: number[][] = [];
    for (let step = 0; step < 6; step += 1) {
      const dotOpacities: number[] = [];
      for (let dot = 0; dot < 6; dot += 1) {
        dotOpacities.push(getSyncedLoaderDotOpacity(step, dot));
      }
      states.push(dotOpacities);
    }

    expect(states).toEqual([
      [1, 0, 0.78, 0, 0.56, 0.34],
      [0.78, 1, 0.56, 0, 0.34, 0],
      [0.56, 0.78, 0.34, 1, 0, 0],
      [0.34, 0.56, 0, 0.78, 0, 1],
      [0, 0.34, 0, 0.56, 1, 0.78],
      [0, 0, 1, 0.34, 0.78, 0.56],
    ]);
  });
});
