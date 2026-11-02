import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProfile, AgentRole } from "@getpaseo/protocol/messages";
import { AgentProfileAppearanceField } from "@/agent-profiles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { toErrorMessage } from "@/utils/error-messages";
import type { AgentRoleValue } from "../internal/role-form-model";
import { useAgentRoleFormModel, useAgentRoleFormState } from "../internal/use-role-form-model";

export interface AgentRoleEditModalProps {
  visible: boolean;
  mode: "create" | "edit";
  role?: AgentRole;
  profiles: readonly AgentProfile[];
  onClose: () => void;
  onSave: (value: AgentRoleValue) => Promise<void>;
}

const NO_PROFILE = "";

function openKey(props: AgentRoleEditModalProps): string {
  return props.mode === "edit" ? `edit:${props.role?.id ?? ""}` : "create";
}

/**
 * Create and edit never share a mounted instance: the body is keyed on mode plus
 * role id, so every open constructs a form model seeded from that record.
 */
export function AgentRoleEditModal(props: AgentRoleEditModalProps): ReactElement | null {
  const [renderedProps, setRenderedProps] = useState<AgentRoleEditModalProps | null>(() =>
    props.visible ? props : null,
  );
  const [sheetVisible, setSheetVisible] = useState(props.visible);
  const livePropsRef = useRef(props);
  const closeRequestedRef = useRef(false);
  livePropsRef.current = props;

  useEffect(() => {
    if (props.visible) {
      if (closeRequestedRef.current) {
        return;
      }
      setRenderedProps(props);
      setSheetVisible(true);
      return;
    }
    if (renderedProps) {
      setSheetVisible(false);
    }
  }, [props, renderedProps]);

  const requestClose = useCallback(() => {
    closeRequestedRef.current = true;
    setSheetVisible(false);
  }, []);

  const handleDismiss = useCallback(() => {
    const dismissedProps = livePropsRef.current;
    closeRequestedRef.current = false;
    setRenderedProps(null);
    setSheetVisible(false);
    if (dismissedProps.visible) {
      dismissedProps.onClose();
    }
  }, []);

  if (!renderedProps) {
    return null;
  }

  return (
    <OpenAgentRoleEditModal
      key={openKey(renderedProps)}
      {...renderedProps}
      visible={sheetVisible}
      onClose={requestClose}
      onDismiss={handleDismiss}
    />
  );
}

function OpenAgentRoleEditModal({
  visible,
  mode,
  role,
  profiles,
  onClose,
  onDismiss,
  onSave,
}: AgentRoleEditModalProps & { onDismiss: () => void }): ReactElement {
  const { t } = useTranslation();
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const snapshot = useMemo(
    () => ({ mode, profiles, ...(role ? { role } : {}) }),
    [mode, profiles, role],
  );
  const model = useAgentRoleFormModel(snapshot);
  const state = useAgentRoleFormState(model);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title:
        mode === "edit"
          ? t("settings.host.agentRoles.editRoleTitle")
          : t("settings.host.agentRoles.addRoleTitle"),
    }),
    [mode, t],
  );

  const profileOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: "none",
        value: NO_PROFILE,
        label: t("settings.host.agentRoles.noDefaultProfile"),
        testID: "agent-role-default-profile-option-none",
      },
      ...profiles.map((profile) => ({
        id: profile.id,
        value: profile.id,
        label: profile.name,
        testID: `agent-role-default-profile-option-${profile.id}`,
      })),
    ],
    [profiles, t],
  );
  const profileDisplay = useMemo<SelectFieldDisplay>(
    () => state.defaultProfileDisplay ?? { label: t("settings.host.agentRoles.noDefaultProfile") },
    [state.defaultProfileDisplay, t],
  );

  const handleAppearanceChange = useCallback(
    (value: { icon: string; color: string }) => model.setAppearance(value),
    [model],
  );
  const handleDefaultProfileChange = useCallback(
    (value: string, display: SelectFieldDisplay) => model.setDefaultProfile(value, display),
    [model],
  );

  const handleSave = useCallback(async () => {
    const value = model.getState().submitValue;
    if (!value) {
      return;
    }
    model.setSubmitError(null);
    model.setSubmitting(true);
    try {
      await onSave(value);
      onClose();
    } catch (error) {
      model.setSubmitError(toErrorMessage(error));
    } finally {
      model.setSubmitting(false);
    }
  }, [model, onClose, onSave]);

  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const handleCancel = useCallback(() => {
    if (state.isSubmitting) {
      return;
    }
    onClose();
  }, [onClose, state.isSubmitting]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={handleCancel}
      onDismiss={onDismiss}
      desktopMaxWidth={560}
      testID="agent-role-edit-modal"
    >
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <View style={styles.iconField}>
            <AgentProfileAppearanceField
              label={t("settings.host.agentRoles.iconLabel")}
              icon={state.icon}
              color={state.color}
              onChange={handleAppearanceChange}
              disabled={state.isSubmitting}
              size={controlSize}
              testID="agent-role-icon-field"
              triggerTestID="agent-role-icon-trigger"
            />
          </View>
          <View style={styles.nameField}>
            <Field label={t("settings.host.agentRoles.nameLabel")} testID="agent-role-name-field">
              <FormTextInput
                initialValue={role?.name ?? ""}
                onChangeText={model.setName}
                placeholder={t("settings.host.agentRoles.namePlaceholder")}
                autoCorrect={false}
                editable={!state.isSubmitting}
                size={controlSize}
                accessibilityLabel={t("settings.host.agentRoles.nameLabel")}
                testID="agent-role-name-input"
              />
            </Field>
          </View>
        </View>

        <Field
          label={t("settings.host.agentRoles.descriptionLabel")}
          testID="agent-role-description-field"
        >
          <FormTextInput
            initialValue={role?.description ?? ""}
            onChangeText={model.setDescription}
            placeholder={t("settings.host.agentRoles.descriptionPlaceholder")}
            editable={!state.isSubmitting}
            size={controlSize}
            accessibilityLabel={t("settings.host.agentRoles.descriptionLabel")}
            testID="agent-role-description-input"
          />
        </Field>

        <Field
          label={t("settings.host.agentRoles.instructionsLabel")}
          hint={t("settings.host.agentRoles.instructionsHint")}
          testID="agent-role-instructions-field"
        >
          <FormTextInput
            initialValue={role?.instructions ?? ""}
            onChangeText={model.setInstructions}
            placeholder={t("settings.host.agentRoles.instructionsPlaceholder")}
            multiline
            numberOfLines={8}
            style={styles.instructionsInput}
            editable={!state.isSubmitting}
            size={controlSize}
            accessibilityLabel={t("settings.host.agentRoles.instructionsLabel")}
            testID="agent-role-instructions-input"
          />
        </Field>

        <SelectField
          label={t("settings.host.agentRoles.defaultProfileLabel")}
          value={state.defaultProfileId}
          selectedDisplay={profileDisplay}
          options={profileOptions}
          onChange={handleDefaultProfileChange}
          placeholder={t("settings.host.agentRoles.noDefaultProfile")}
          emptyText={t("settings.host.agentRoles.noDefaultProfile")}
          disabled={state.isSubmitting}
          searchable={profileOptions.length > 6}
          title={t("settings.host.agentRoles.defaultProfileLabel")}
          size={controlSize}
          testID="agent-role-default-profile-field"
          triggerTestID="agent-role-default-profile-trigger"
        />

        {state.submitError ? (
          <Text style={styles.submitError} testID="agent-role-submit-error">
            {state.submitError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            variant="secondary"
            style={styles.actionButton}
            onPress={handleCancel}
            disabled={state.isSubmitting}
            testID="agent-role-cancel-button"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            style={styles.actionButton}
            onPress={handleSavePress}
            disabled={!state.canSubmit}
            testID="agent-role-save-button"
          >
            {state.isSubmitting
              ? t("settings.host.agentRoles.saving")
              : t("settings.host.agentRoles.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconField: {
    flexShrink: 0,
  },
  nameField: {
    flex: 1,
  },
  instructionsInput: {
    minHeight: 160,
    textAlignVertical: "top",
  },
  submitError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
