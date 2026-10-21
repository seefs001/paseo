import { describe, expect, it } from "vitest";

import { omitSharedPiFastMode, resolveFeatureValues } from "./feature-preferences";

describe("feature-preferences", () => {
  const features = [
    {
      type: "toggle" as const,
      id: "fast_mode",
      label: "Fast",
      value: false,
    },
    {
      type: "toggle" as const,
      id: "plan_mode",
      label: "Plan",
      value: false,
    },
  ];

  it("restores persisted values for available features", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          unknown_feature: true,
        },
        localFeatureValues: {},
      }),
    ).toEqual({
      fast_mode: true,
    });
  });

  it("preserves explicit toggle and select values while capabilities are unresolved", () => {
    expect(
      resolveFeatureValues({
        features: undefined,
        persistedFeatureValues: {
          fast_mode: true,
          plan_mode: true,
          service_tier: "default",
        },
        localFeatureValues: {
          fast_mode: false,
          service_tier: "priority",
        },
      }),
    ).toEqual({ fast_mode: false, plan_mode: true, service_tier: "priority" });
  });

  it("filters values only after an empty capability list is resolved", () => {
    const localFeatureValues = { fast_mode: true, plan_mode: false };
    const persistedFeatureValues = { service_tier: "priority" };

    expect(
      resolveFeatureValues({ features: undefined, localFeatureValues, persistedFeatureValues }),
    ).toEqual({ fast_mode: true, plan_mode: false, service_tier: "priority" });
    expect(
      resolveFeatureValues({ features: [], localFeatureValues, persistedFeatureValues }),
    ).toEqual({});
    expect(localFeatureValues).toEqual({ fast_mode: true, plan_mode: false });
    expect(persistedFeatureValues).toEqual({ service_tier: "priority" });
  });

  it("drops Pi fast mode from the shared provider preference", () => {
    expect(
      omitSharedPiFastMode("pi", {
        fast_mode: true,
        plan_mode: true,
      }),
    ).toEqual({ plan_mode: true });
    expect(omitSharedPiFastMode("codex", { fast_mode: true })).toEqual({ fast_mode: true });
  });

  it("prefers local values over persisted values", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          plan_mode: false,
        },
        localFeatureValues: {
          fast_mode: false,
        },
      }),
    ).toEqual({
      fast_mode: false,
      plan_mode: false,
    });
  });
});
