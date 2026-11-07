import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { useFetchQuery } from "@/data/query";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  useDesktopIpcErrorReporter,
  useDesktopIpcQueryErrorToast,
} from "@/desktop/hooks/desktop-ipc-error";

const KEEP_AWAKE_QUERY_KEY = ["desktop-keep-awake"] as const;

async function loadKeepAwake(): Promise<boolean> {
  return z.boolean().parse(await invokeDesktopCommand<unknown>("get_keep_awake"));
}

async function saveKeepAwake(enabled: boolean): Promise<boolean> {
  return z.boolean().parse(await invokeDesktopCommand<unknown>("set_keep_awake", { enabled }));
}

export function DesktopPowerSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const reportError = useDesktopIpcErrorReporter();
  const {
    data: enabled = true,
    isPending,
    error,
  } = useFetchQuery({
    queryKey: KEEP_AWAKE_QUERY_KEY,
    queryFn: loadKeepAwake,
    dataShape: "value",
    staleTimeMs: 0,
    gcTime: Infinity,
    retry: false,
  });
  useDesktopIpcQueryErrorToast({
    error,
    message: t("desktop.settings.loadFailed"),
    logLabel: "[KeepAwake] Failed to load settings",
  });
  const { mutate, isPending: isSaving } = useMutation({
    mutationFn: saveKeepAwake,
    onSuccess: (saved) => {
      queryClient.setQueryData(KEEP_AWAKE_QUERY_KEY, saved);
    },
    onError: (saveError) => {
      reportError({
        error: saveError,
        message: t("desktop.settings.saveFailed"),
        logLabel: "[KeepAwake] Failed to save settings",
      });
    },
  });
  const isDisabled = isPending || isSaving || error !== null;

  return (
    <SettingsSection title={t("settings.general.power.title")}>
      <SettingsCard>
        <SettingsSwitch
          label={t("settings.general.power.keepAwake")}
          value={enabled}
          onValueChange={mutate}
          disabled={isDisabled}
          testID="desktop-keep-awake"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
