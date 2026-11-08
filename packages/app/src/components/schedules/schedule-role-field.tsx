import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAgentRoles } from "@/agent-roles";
import {
  AgentProfileGlyph,
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
} from "@/agent-profiles";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import type { ControlSize } from "@/components/ui/control-geometry";
import type { ScheduleFormModel, ScheduleFormState } from "@/schedules/schedule-form-model";

const NO_ROLE_OPTION_ID = "__no-role__";

interface ScheduleRoleFieldProps {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  size: ControlSize;
}

export function ScheduleRoleField({ model, state, size }: ScheduleRoleFieldProps) {
  const { t } = useTranslation();
  const { roles, isSupported } = useAgentRoles(state.selectedServerId);
  const profileProviders = useMemo(
    () => state.modelSelectorProviders.map((provider) => provider.id),
    [state.modelSelectorProviders],
  );
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({ kind: "draft", controls: { applyProfile: model.applyProfile } }),
    [model],
  );
  const profiles = useAgentProfilePicker({
    serverId: state.selectedServerId,
    availableProviders: profileProviders,
    target: profileTarget,
  });
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: NO_ROLE_OPTION_ID,
        value: NO_ROLE_OPTION_ID,
        label: t("agentControls.role.none"),
        testID: "schedule-role-option-none",
      },
      ...(roles ?? []).map((role) => ({
        id: role.id,
        value: role.id,
        label: role.name,
        description: role.description,
        testID: `schedule-role-option-${role.id}`,
      })),
    ],
    [roles, t],
  );
  const selectedDisplay = useMemo(
    () => ({ label: state.selectedRole?.name ?? t("agentControls.role.none") }),
    [state.selectedRole, t],
  );
  const leading = useMemo(
    () =>
      state.selectedRole ? (
        <AgentProfileGlyph
          icon={state.selectedRole.icon}
          color={state.selectedRole.color}
          size={16}
        />
      ) : null,
    [state.selectedRole],
  );
  const selectRole = useCallback(
    (id: string) => {
      if (id === NO_ROLE_OPTION_ID) {
        model.setRole(null);
        return;
      }
      const role = roles?.find((entry) => entry.id === id);
      if (!role) return;
      model.setRole(role);
      if (role.defaultProfileId) profiles?.applyProfile(role.defaultProfileId);
    },
    [model, profiles, roles],
  );
  const providerUnsupported = state.selectedRole && state.roleProviderSupport === "unsupported";

  if (!isSupported || !state.supportsWorkspaceTargets) return null;

  return (
    <SelectField
      label={t("agentControls.role.title")}
      value={state.selectedRole?.id ?? NO_ROLE_OPTION_ID}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={selectRole}
      placeholder={t("agentControls.role.none")}
      emptyText={t("agentControls.role.none")}
      loading={roles === null}
      disabled={roles === null}
      error={providerUnsupported ? t("agentControls.role.unsupportedProvider") : null}
      searchable={options.length > 6}
      title={t("agentControls.role.title")}
      size={size}
      triggerLeading={leading}
      triggerTestID="schedule-role-trigger"
    />
  );
}
