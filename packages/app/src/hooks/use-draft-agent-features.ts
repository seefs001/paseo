import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentProvider, AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import { FAST_MODE_FEATURE_ID } from "@/agent-controls/policy";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { mergeProviderPreferences, useFormPreferences } from "./use-form-preferences";
import {
  applyFeatureValues,
  omitSharedPiFastMode,
  pruneFeatureValues,
  resolveFeatureValues,
} from "./feature-preferences";

type DraftFeatureConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId"
>;

export function useDraftAgentFeatures(input: {
  serverId: string | null | undefined;
  provider: AgentProvider | null;
  cwd: string | null | undefined;
  modeId: string | null | undefined;
  modelId: string | null | undefined;
  thinkingOptionId: string | null | undefined;
  initialFeatureValues?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const { serverId, provider, cwd, modeId, modelId, thinkingOptionId, initialFeatureValues } =
    input;
  const [localFeatureValues, setLocalFeatureValues] = useState<Record<string, unknown>>(
    () => initialFeatureValues ?? {},
  );
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const { preferences, updatePreferences } = useFormPreferences();
  const normalizedCwd = cwd?.trim() || "";
  const normalizedProvider = provider ?? null;
  const previousProviderRef = useRef<AgentProvider | null>(normalizedProvider);
  const persistedFeatureValues = useMemo(
    () =>
      omitSharedPiFastMode(
        provider,
        provider ? (preferences.providerPreferences?.[provider]?.featureValues ?? {}) : {},
      ),
    [preferences.providerPreferences, provider],
  );
  const fastModeByModelRef = useRef<Record<string, boolean>>({});
  const modelIdRef = useRef(modelId);

  const draftConfig = useMemo<DraftFeatureConfig | null>(() => {
    if (!normalizedProvider || !normalizedCwd) {
      return null;
    }

    return {
      provider: normalizedProvider,
      cwd: normalizedCwd,
      ...(modeId ? { modeId } : {}),
      ...(modelId ? { model: modelId } : {}),
      ...(thinkingOptionId ? { thinkingOptionId } : {}),
    };
  }, [modeId, modelId, normalizedCwd, normalizedProvider, thinkingOptionId]);

  const featuresQuery = useQuery({
    queryKey: [
      "providerFeatures",
      serverId ?? null,
      normalizedProvider,
      normalizedCwd || null,
      modeId ?? null,
      modelId ?? null,
      thinkingOptionId ?? null,
    ],
    enabled: Boolean(serverId && client && isConnected && draftConfig),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!client || !draftConfig) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const payload = await client.listProviderFeatures(draftConfig);
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.features ?? [];
    },
  });
  const availableFeaturesRaw = featuresQuery.data;
  const availableFeatures = useMemo(() => availableFeaturesRaw ?? [], [availableFeaturesRaw]);
  const featureValues = useMemo(
    () =>
      resolveFeatureValues({
        features: availableFeaturesRaw,
        persistedFeatureValues,
        localFeatureValues,
      }),
    [availableFeaturesRaw, localFeatureValues, persistedFeatureValues],
  );

  const features = useMemo(() => {
    return applyFeatureValues(availableFeatures, featureValues);
  }, [availableFeatures, featureValues]);

  useEffect(() => {
    const previousProvider = previousProviderRef.current;
    previousProviderRef.current = normalizedProvider;
    if (previousProvider === null) {
      return;
    }
    if (previousProvider !== normalizedProvider) {
      setLocalFeatureValues({});
    }
  }, [normalizedProvider]);

  useEffect(() => {
    if (availableFeaturesRaw === undefined) {
      return;
    }
    const next = pruneFeatureValues(localFeatureValues, availableFeatures);
    if (next !== localFeatureValues) {
      setLocalFeatureValues(next);
    }
  }, [availableFeatures, availableFeaturesRaw, localFeatureValues]);

  const effectiveFeatureValues = Object.keys(featureValues).length > 0 ? featureValues : undefined;
  useEffect(() => {
    const previousModelId = modelIdRef.current;
    if (previousModelId === modelId) return;
    modelIdRef.current = modelId;
    if (provider !== "pi" || !previousModelId) return;
    setLocalFeatureValues((current) => {
      const previousValue = current[FAST_MODE_FEATURE_ID];
      if (previousModelId && typeof previousValue === "boolean") {
        fastModeByModelRef.current[previousModelId] = previousValue;
      }
      const remembered = modelId ? fastModeByModelRef.current[modelId] : undefined;
      if (remembered === undefined) {
        if (!Object.prototype.hasOwnProperty.call(current, FAST_MODE_FEATURE_ID)) return current;
        const next = { ...current };
        delete next[FAST_MODE_FEATURE_ID];
        return next;
      }
      if (current[FAST_MODE_FEATURE_ID] === remembered) return current;
      return { ...current, [FAST_MODE_FEATURE_ID]: remembered };
    });
  }, [modelId, provider]);

  const setFeatureValue = useCallback(
    (featureId: string, value: unknown) => {
      if (
        provider === "pi" &&
        featureId === FAST_MODE_FEATURE_ID &&
        modelId &&
        typeof value === "boolean"
      ) {
        fastModeByModelRef.current[modelId] = value;
      }
      setLocalFeatureValues((current) => {
        if (Object.is(current[featureId], value)) {
          return current;
        }

        return { ...current, [featureId]: value };
      });
      if (!provider || (provider === "pi" && featureId === FAST_MODE_FEATURE_ID)) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[useDraftAgentFeatures] persist feature preference failed", error);
      });
    },
    [modelId, provider, updatePreferences],
  );

  const applyProfileFeatureValues = useCallback(
    (profile: MaterializedAgentProfile) => {
      const previousProvider = previousProviderRef.current;
      const previousModelId = modelIdRef.current;
      const previousFastMode = localFeatureValues[FAST_MODE_FEATURE_ID];
      if (previousProvider === "pi" && previousModelId && typeof previousFastMode === "boolean") {
        fastModeByModelRef.current[previousModelId] = previousFastMode;
      }
      const sameProvider = profile.provider === previousProvider;
      const targetModelId = profile.modelId || (sameProvider ? previousModelId : null);
      const fastMode = profile.featureValues[FAST_MODE_FEATURE_ID];
      if (profile.provider === "pi" && targetModelId && typeof fastMode === "boolean") {
        fastModeByModelRef.current[targetModelId] = fastMode;
      }
      // The profile changes selection and features together. Selection cleanup must
      // not treat its values as choices made on the previous provider or model.
      previousProviderRef.current = profile.provider;
      modelIdRef.current = targetModelId;
      setLocalFeatureValues(profile.featureValues);
    },
    [localFeatureValues],
  );

  return {
    features,
    featureValues: effectiveFeatureValues,
    isLoading: featuresQuery.isLoading,
    setFeatureValue,
    applyProfileFeatureValues,
  };
}
