import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentProvider, AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import { PI_DISABLED_TOOLS_FEATURE_ID } from "@getpaseo/protocol/pi-disabled-tools";
import { FAST_MODE_FEATURE_ID } from "@/agent-controls/policy";
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

function readDraftDisabledTools(
  localFeatureValues: Record<string, unknown>,
  persistedFeatureValues: Record<string, unknown>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(localFeatureValues, PI_DISABLED_TOOLS_FEATURE_ID)) {
    return localFeatureValues[PI_DISABLED_TOOLS_FEATURE_ID];
  }
  if (Object.prototype.hasOwnProperty.call(persistedFeatureValues, PI_DISABLED_TOOLS_FEATURE_ID)) {
    return persistedFeatureValues[PI_DISABLED_TOOLS_FEATURE_ID];
  }
  return undefined;
}

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
        features: availableFeatures,
        persistedFeatureValues,
        localFeatureValues,
      }),
    [availableFeatures, localFeatureValues, persistedFeatureValues],
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

  const disabledToolsValue = readDraftDisabledTools(localFeatureValues, persistedFeatureValues);
  const featureValuesWithTools =
    disabledToolsValue === undefined
      ? featureValues
      : { ...featureValues, [PI_DISABLED_TOOLS_FEATURE_ID]: disabledToolsValue };
  const effectiveFeatureValues =
    Object.keys(featureValuesWithTools).length > 0 ? featureValuesWithTools : undefined;
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

  const applyProfileFeatureValues = useCallback((values: Record<string, unknown>) => {
    setLocalFeatureValues(values);
  }, []);

  return {
    features,
    featureValues: effectiveFeatureValues,
    isLoading: featuresQuery.isLoading,
    setFeatureValue,
    applyProfileFeatureValues,
  };
}
