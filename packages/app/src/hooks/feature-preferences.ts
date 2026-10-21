import type { AgentFeature, AgentProvider } from "@getpaseo/protocol/agent-types";
import { FAST_MODE_FEATURE_ID } from "@/agent-controls/policy";

export function pruneFeatureValues(
  featureValues: Record<string, unknown>,
  features: AgentFeature[],
): Record<string, unknown> {
  const allowedFeatureIds = new Set(features.map((feature) => feature.id));
  let changed = false;
  const next: Record<string, unknown> = {};

  for (const [featureId, value] of Object.entries(featureValues)) {
    if (!allowedFeatureIds.has(featureId)) {
      changed = true;
      continue;
    }
    next[featureId] = value;
  }

  return changed ? next : featureValues;
}

export function applyFeatureValues(
  features: AgentFeature[],
  featureValues: Record<string, unknown>,
): AgentFeature[] {
  if (Object.keys(featureValues).length === 0) {
    return features;
  }

  return features.map((feature) => {
    if (!Object.prototype.hasOwnProperty.call(featureValues, feature.id)) {
      return feature;
    }

    return {
      ...feature,
      value: featureValues[feature.id],
    } as AgentFeature;
  });
}

export function omitSharedPiFastMode(
  provider: AgentProvider | null | undefined,
  featureValues: Record<string, unknown>,
): Record<string, unknown> {
  if (
    provider !== "pi" ||
    !Object.prototype.hasOwnProperty.call(featureValues, FAST_MODE_FEATURE_ID)
  ) {
    return featureValues;
  }
  const next = { ...featureValues };
  delete next[FAST_MODE_FEATURE_ID];
  return next;
}

export function resolveFeatureValues(args: {
  features: AgentFeature[] | undefined;
  persistedFeatureValues: Record<string, unknown>;
  localFeatureValues: Record<string, unknown>;
}): Record<string, unknown> {
  // An unresolved catalog must not erase explicit values from a submitted draft.
  if (args.features === undefined) {
    return { ...args.persistedFeatureValues, ...args.localFeatureValues };
  }
  const next: Record<string, unknown> = {};

  for (const feature of args.features) {
    if (Object.prototype.hasOwnProperty.call(args.localFeatureValues, feature.id)) {
      next[feature.id] = args.localFeatureValues[feature.id];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args.persistedFeatureValues, feature.id)) {
      next[feature.id] = args.persistedFeatureValues[feature.id];
    }
  }

  return next;
}
