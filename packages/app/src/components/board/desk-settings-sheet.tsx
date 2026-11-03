import { BOARD_CHECKPOINT_KINDS, type BoardDeskSettings } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useReducer, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDeskPrefs, type DeskPrefs } from "@/board/desk-prefs";
import { setBoardDeskSettings, useBoardTasks } from "@/board/tasks";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { ControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { toErrorMessage } from "@/utils/error-messages";
import { DeskSettingsZones, type DeskZone } from "./desk-settings-zones";

type CheckpointKind = (typeof BOARD_CHECKPOINT_KINDS)[number];
type Grouping = BoardDeskSettings["grouping"];
type CardField = keyof DeskPrefs["fields"];

const GROUPINGS: readonly Grouping[] = ["goal", "project", "host", "agent"];
const CARD_FIELDS: readonly CardField[] = [
  "model",
  "branch",
  "labels",
  "pullRequest",
  "timer",
  "context",
];
const MAX_RETENTION_DAYS = 365;

type Submission =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string };

interface FormState {
  zones: DeskZone[];
  decideKinds: CheckpointKind[];
  grouping: Grouping;
  retention: string;
  notifyKinds: CheckpointKind[];
  submission: Submission;
}

type FormAction =
  | { type: "zones"; zones: DeskZone[] }
  | { type: "decideKind"; kind: CheckpointKind; on: boolean }
  | { type: "notifyKind"; kind: CheckpointKind; on: boolean }
  | { type: "grouping"; value: Grouping }
  | { type: "retention"; value: string }
  | { type: "submission"; submission: Submission };

/** Kinds stay in protocol order so saved settings do not churn. */
function toggleKind(kinds: readonly CheckpointKind[], kind: CheckpointKind, on: boolean) {
  return BOARD_CHECKPOINT_KINDS.filter((entry) => (entry === kind ? on : kinds.includes(entry)));
}

function reduceForm(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "zones":
      return { ...state, zones: action.zones };
    case "decideKind":
      return { ...state, decideKinds: toggleKind(state.decideKinds, action.kind, action.on) };
    case "notifyKind":
      return { ...state, notifyKinds: toggleKind(state.notifyKinds, action.kind, action.on) };
    case "grouping":
      return { ...state, grouping: action.value };
    case "retention":
      return { ...state, retention: action.value };
    case "submission":
      return { ...state, submission: action.submission };
  }
}

function openForm(settings: BoardDeskSettings): FormState {
  return {
    zones: settings.zones,
    decideKinds: settings.decideKinds,
    grouping: settings.grouping,
    retention: String(settings.landedRetentionDays),
    notifyKinds: settings.notifyKinds,
    submission: { status: "idle" },
  };
}

function parseRetention(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed >= 1 && parsed <= MAX_RETENTION_DAYS ? parsed : null;
}

interface DeskSettingsSheetProps {
  serverId: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Desk settings. How the Desk works is saved on the host and every device follows it; how it
 * looks is this device's own and applies right away.
 */
export function DeskSettingsSheet({
  serverId,
  visible,
  onClose,
}: DeskSettingsSheetProps): ReactElement {
  const { t } = useTranslation();
  const settings = useBoardTasks((store) => {
    const host = store.hosts[serverId];
    return host?.status === "ready" ? host.settings : null;
  });
  const header = useMemo<SheetHeader>(() => ({ title: t("board.plan2.settings.title") }), [t]);
  // Each open reseeds the form from what the host holds now; closing keeps it for the animation.
  const [opens, setOpens] = useState({ visible, count: 0 });
  if (opens.visible !== visible) {
    setOpens({ visible, count: visible ? opens.count + 1 : opens.count });
  }
  if (!settings) {
    return (
      <AdaptiveModalSheet
        header={header}
        visible={visible}
        onClose={onClose}
        testID="desk-settings-sheet"
      >
        <Text style={styles.unavailable}>{t("board.plan2.settings.unavailable")}</Text>
      </AdaptiveModalSheet>
    );
  }
  return (
    <DeskSettingsForm
      key={opens.count}
      serverId={serverId}
      settings={settings}
      visible={visible}
      onClose={onClose}
      header={header}
    />
  );
}

function DeskSettingsForm({
  serverId,
  settings,
  visible,
  onClose,
  header,
}: DeskSettingsSheetProps & { settings: BoardDeskSettings; header: SheetHeader }): ReactElement {
  const { t } = useTranslation();
  const controlSize: ControlSize = "md";
  const [state, dispatch] = useReducer(reduceForm, settings, openForm);
  const retention = parseRetention(state.retention);
  const isSubmitting = state.submission.status === "submitting";
  const canSave = retention !== null && !isSubmitting;

  const changeZones = useCallback((zones: DeskZone[]) => dispatch({ type: "zones", zones }), []);
  const changeDecideKind = useCallback(
    (kind: CheckpointKind, on: boolean) => dispatch({ type: "decideKind", kind, on }),
    [],
  );
  const changeNotifyKind = useCallback(
    (kind: CheckpointKind, on: boolean) => dispatch({ type: "notifyKind", kind, on }),
    [],
  );
  const changeGrouping = useCallback(
    (value: Grouping) => dispatch({ type: "grouping", value }),
    [],
  );
  const changeRetention = useCallback(
    (value: string) => dispatch({ type: "retention", value }),
    [],
  );
  const groupingOptions = useMemo<SelectFieldOption<Grouping>[]>(
    () =>
      GROUPINGS.map((grouping) => ({
        id: grouping,
        value: grouping,
        label: t(`board.plan2.grouping.${grouping}`),
      })),
    [t],
  );
  const groupingDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: t(`board.plan2.grouping.${state.grouping}`) }),
    [state.grouping, t],
  );

  const save = useCallback(async () => {
    if (!canSave || retention === null) return;
    dispatch({ type: "submission", submission: { status: "submitting" } });
    try {
      await setBoardDeskSettings(serverId, {
        zones: state.zones,
        decideKinds: state.decideKinds,
        grouping: state.grouping,
        landedRetentionDays: retention,
        notifyKinds: state.notifyKinds,
      });
      dispatch({ type: "submission", submission: { status: "idle" } });
      onClose();
    } catch (error) {
      dispatch({
        type: "submission",
        submission: { status: "failed", message: toErrorMessage(error) },
      });
    }
  }, [canSave, onClose, retention, serverId, state]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSubmitting}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={savePress}
          disabled={!canSave}
          loading={isSubmitting}
          testID="desk-settings-save"
        >
          {t("board.plan2.settings.save")}
        </Button>
      </View>
    ),
    [canSave, isSubmitting, onClose, savePress, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      dismissible={!isSubmitting}
      footer={footer}
      testID="desk-settings-sheet"
    >
      <View style={styles.body}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("board.plan2.settings.hostSection")}</Text>
          <Text style={styles.muted}>{t("board.plan2.settings.hostHint")}</Text>
          <Field label={t("board.plan2.settings.zones")}>
            <DeskSettingsZones zones={state.zones} onChange={changeZones} size={controlSize} />
          </Field>
          <KindToggles
            label={t("board.plan2.settings.decideKinds")}
            hint={t("board.plan2.settings.decideKindsHint")}
            value={state.decideKinds}
            onChange={changeDecideKind}
            testID="desk-settings-decide"
          />
          <SelectField
            label={t("board.plan2.settings.grouping")}
            value={state.grouping}
            selectedDisplay={groupingDisplay}
            options={groupingOptions}
            onChange={changeGrouping}
            placeholder={t("board.plan2.grouping.goal")}
            emptyText={t("board.plan2.grouping.goal")}
            title={t("board.plan2.settings.grouping")}
            size={controlSize}
            triggerTestID="desk-settings-grouping"
          />
          <Field
            label={t("board.plan2.settings.retention")}
            error={
              retention === null
                ? t("board.plan2.settings.retentionRange", { max: MAX_RETENTION_DAYS })
                : null
            }
          >
            <FormTextInput
              size={controlSize}
              initialValue={state.retention}
              onChangeText={changeRetention}
              accessibilityLabel={t("board.plan2.settings.retention")}
              keyboardType="number-pad"
              testID="desk-settings-retention"
            />
          </Field>
          <KindToggles
            label={t("board.plan2.settings.notifyKinds")}
            hint={t("board.plan2.settings.notifyKindsHint")}
            value={state.notifyKinds}
            onChange={changeNotifyKind}
            testID="desk-settings-notify"
          />
          {state.submission.status === "failed" ? (
            <Text style={styles.error}>{state.submission.message}</Text>
          ) : null}
        </View>
        <DeskDeviceSettings size={controlSize} />
      </View>
    </AdaptiveModalSheet>
  );
}

function KindToggles({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint: string;
  value: readonly CheckpointKind[];
  onChange: (kind: CheckpointKind, on: boolean) => void;
  testID: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={hint} testID={testID}>
      <View style={styles.toggles}>
        {BOARD_CHECKPOINT_KINDS.map((kind) => (
          <ToggleRow
            key={kind}
            id={kind}
            label={t(`board.plan2.kinds.${kind}`)}
            value={value.includes(kind)}
            onChange={onChange}
            testID={`${testID}-${kind}`}
          />
        ))}
      </View>
    </Field>
  );
}

function ToggleRow<T extends string>({
  id,
  label,
  value,
  onChange,
  testID,
}: {
  id: T;
  label: string;
  value: boolean;
  onChange: (id: T, value: boolean) => void;
  testID: string;
}): ReactElement {
  const change = useCallback((next: boolean) => onChange(id, next), [id, onChange]);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={change} accessibilityLabel={label} testID={testID} />
    </View>
  );
}

/** This device's look; changes apply at once and never reach the host. */
function DeskDeviceSettings({ size }: { size: ControlSize }): ReactElement {
  const { t } = useTranslation();
  const { prefs, update } = useDeskPrefs();
  const densityOptions = useMemo<SegmentedControlOption<DeskPrefs["density"]>[]>(
    () => [
      { value: "comfortable", label: t("board.plan2.settings.comfortable") },
      { value: "compact", label: t("board.plan2.settings.compact") },
    ],
    [t],
  );
  const changeDensity = useCallback(
    (density: DeskPrefs["density"]) => update({ density }),
    [update],
  );
  const changeField = useCallback(
    (field: CardField, on: boolean) => update({ fields: { ...prefs.fields, [field]: on } }),
    [prefs.fields, update],
  );
  const resetWidths = useCallback(() => update({ zoneWidths: {} }), [update]);
  const hasCustomWidths = Object.keys(prefs.zoneWidths).length > 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("board.plan2.settings.deviceSection")}</Text>
      <Text style={styles.muted}>{t("board.plan2.settings.deviceHint")}</Text>
      <Field label={t("board.plan2.settings.density")}>
        <SegmentedControl
          options={densityOptions}
          value={prefs.density}
          onValueChange={changeDensity}
          size={size}
          testID="desk-settings-density"
        />
      </Field>
      <Field label={t("board.plan2.settings.cardFields")}>
        <View style={styles.toggles}>
          {CARD_FIELDS.map((field) => (
            <ToggleRow
              key={field}
              id={field}
              label={t(`board.plan2.fields.${field}`)}
              value={prefs.fields[field]}
              onChange={changeField}
              testID={`desk-settings-field-${field}`}
            />
          ))}
        </View>
      </Field>
      <Button
        variant="outline"
        size={size}
        onPress={resetWidths}
        disabled={!hasCustomWidths}
        style={styles.resetButton}
        testID="desk-settings-reset-widths"
      >
        {t("board.plan2.settings.resetWidths")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[6],
  },
  section: {
    gap: theme.spacing[4],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  unavailable: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  muted: {
    marginTop: -theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  toggles: {
    gap: theme.spacing[2],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  toggleLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  resetButton: {
    alignSelf: "flex-start",
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
