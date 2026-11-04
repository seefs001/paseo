import type { BoardGoalAutopilot } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useReducer, type Dispatch, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAgentProfiles } from "@/agent-profiles";
import { GoalArtifacts } from "@/artifacts/goal-artifacts";
import type { DeskGoalSheetTarget } from "@/board/goal-sheet";
import { createBoardGoal, deleteBoardGoal, updateBoardGoal, useBoardTasks } from "@/board/tasks";
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
import type { Agent } from "@/stores/session-store";
import { useHostDirectories } from "@/stores/session-store-hooks";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";

type AutopilotAgent = BoardGoalAutopilot["agent"];
type Isolation = BoardGoalAutopilot["isolation"];

const MAX_ACTIVE_LIMIT = 20;
const DAILY_START_LIMIT = 200;
const DEFAULT_MAX_ACTIVE = 1;
const DEFAULT_DAILY_START_LIMIT = 10;
const NO_OWNER = "";

/** Which action is running; the sheet stays open and shows its error if it fails. */
type Submission =
  | { status: "idle" }
  | { status: "pending"; action: "save" | "land" | "delete" }
  | { status: "failed"; message: string };

interface FormState {
  /** Set once the goal exists, so a retry after a failed Autopilot save updates it. */
  goalId: string | null;
  title: string;
  notes: string;
  ownerAgentId: string | null;
  enabled: boolean;
  agent: AutopilotAgent | null;
  isolation: Isolation;
  maxActive: string;
  dailyStartLimit: string;
  confirmStarts: boolean;
  submission: Submission;
}

type FormAction =
  | { type: "title"; value: string }
  | { type: "notes"; value: string }
  | { type: "owner"; agentId: string | null }
  | { type: "enabled"; value: boolean }
  | { type: "agent"; agent: AutopilotAgent }
  | { type: "isolation"; value: Isolation }
  | { type: "maxActive"; value: string }
  | { type: "dailyStartLimit"; value: string }
  | { type: "confirmStarts"; value: boolean }
  | { type: "created"; goalId: string }
  | { type: "submission"; submission: Submission };

function reduceForm(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "title":
      return { ...state, title: action.value };
    case "notes":
      return { ...state, notes: action.value };
    case "owner":
      return { ...state, ownerAgentId: action.agentId };
    case "enabled":
      return { ...state, enabled: action.value };
    case "agent":
      return { ...state, agent: action.agent };
    case "isolation":
      return { ...state, isolation: action.value };
    case "maxActive":
      return { ...state, maxActive: action.value };
    case "dailyStartLimit":
      return { ...state, dailyStartLimit: action.value };
    case "confirmStarts":
      return { ...state, confirmStarts: action.value };
    case "created":
      return { ...state, goalId: action.goalId };
    case "submission":
      return { ...state, submission: action.submission };
  }
}

type AutopilotFormFields = Pick<
  FormState,
  "enabled" | "agent" | "isolation" | "maxActive" | "dailyStartLimit" | "confirmStarts"
>;

/** The stored Autopilot, or defaults that ask before each start. */
function seedAutopilot(autopilot: BoardGoalAutopilot | null): AutopilotFormFields {
  return {
    enabled: autopilot?.enabled ?? false,
    agent: autopilot?.agent ?? null,
    isolation: autopilot?.isolation ?? "worktree",
    maxActive: String(autopilot?.maxActive ?? DEFAULT_MAX_ACTIVE),
    dailyStartLimit: String(autopilot?.dailyStartLimit ?? DEFAULT_DAILY_START_LIMIT),
    confirmStarts: autopilot?.confirmStarts ?? true,
  };
}

function openForm(target: DeskGoalSheetTarget): FormState {
  if (target.mode === "create") {
    return {
      goalId: null,
      title: "",
      notes: "",
      ownerAgentId: null,
      ...seedAutopilot(null),
      submission: { status: "idle" },
    };
  }
  const { goal } = target;
  return {
    goalId: goal.id,
    title: goal.title,
    notes: goal.notes,
    ownerAgentId: goal.ownerAgentId,
    ...seedAutopilot(goal.autopilot),
    submission: { status: "idle" },
  };
}

/** A whole number in range, or null when the text is not one. */
function parseLimit(value: string, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return parsed >= 1 && parsed <= max ? parsed : null;
}

function agentKey(agent: AutopilotAgent): string {
  return agent.kind === "profile" ? `profile:${agent.profileId}` : "config";
}

function agentLabel(agent: Agent): string {
  return agent.title?.trim() || `${agent.provider} ${agent.id.slice(0, 8)}`;
}

/** Autopilot settings to save, or null while no agent is chosen (Autopilot stays unset). */
function toAutopilot(
  state: FormState,
  limits: { maxActive: number | null; dailyStartLimit: number | null },
): BoardGoalAutopilot | null {
  if (state.agent === null) return null;
  return {
    enabled: state.enabled,
    agent: state.agent,
    isolation: state.isolation,
    maxActive: limits.maxActive ?? DEFAULT_MAX_ACTIVE,
    dailyStartLimit: limits.dailyStartLimit ?? DEFAULT_DAILY_START_LIMIT,
    confirmStarts: state.confirmStarts,
  };
}

interface DeskGoalSheetProps {
  target: DeskGoalSheetTarget;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

/** Create or edit a goal and its Autopilot. Mount once per open; the host keys it. */
export function DeskGoalSheet({
  target,
  visible,
  onClose,
  onDismiss,
}: DeskGoalSheetProps): ReactElement {
  const { t } = useTranslation();
  const controlSize: ControlSize = "md";
  const [state, dispatch] = useReducer(reduceForm, target, openForm);
  const { serverId } = target;
  const live = useBoardTasks((store) => {
    const host = store.hosts[serverId];
    return host?.status === "ready" && state.goalId ? (host.goals.get(state.goalId) ?? null) : null;
  });
  const maxActive = parseLimit(state.maxActive, MAX_ACTIVE_LIMIT);
  const dailyStartLimit = parseLimit(state.dailyStartLimit, DAILY_START_LIMIT);
  const isPending = state.submission.status === "pending";
  const pendingAction = state.submission.status === "pending" ? state.submission.action : null;
  const autopilotValid =
    state.agent === null ? !state.enabled : maxActive !== null && dailyStartLimit !== null;
  const canSave = state.title.trim().length > 0 && autopilotValid && !isPending;

  const changeTitle = useCallback((value: string) => dispatch({ type: "title", value }), []);
  const changeNotes = useCallback((value: string) => dispatch({ type: "notes", value }), []);

  const fail = useCallback((error: unknown) => {
    dispatch({
      type: "submission",
      submission: { status: "failed", message: toErrorMessage(error) },
    });
  }, []);

  const save = useCallback(async () => {
    if (!canSave) return;
    dispatch({ type: "submission", submission: { status: "pending", action: "save" } });
    const autopilot = toAutopilot(state, { maxActive, dailyStartLimit });
    try {
      let goalId = state.goalId;
      if (goalId === null) {
        const created = await createBoardGoal(serverId, {
          title: state.title.trim(),
          notes: state.notes,
          ownerAgentId: state.ownerAgentId,
        });
        goalId = created.id;
        dispatch({ type: "created", goalId });
        if (autopilot) await updateBoardGoal(serverId, { goalId, autopilot });
      } else {
        await updateBoardGoal(serverId, {
          goalId,
          title: state.title.trim(),
          notes: state.notes,
          ownerAgentId: state.ownerAgentId,
          ...(autopilot ? { autopilot } : {}),
        });
      }
      dispatch({ type: "submission", submission: { status: "idle" } });
      onClose();
    } catch (error) {
      fail(error);
    }
  }, [canSave, dailyStartLimit, fail, maxActive, onClose, serverId, state]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);

  const landed = live ? live.landedAt !== null : false;
  const toggleLanded = useCallback(async () => {
    if (state.goalId === null) return;
    dispatch({ type: "submission", submission: { status: "pending", action: "land" } });
    try {
      await updateBoardGoal(serverId, { goalId: state.goalId, landed: !landed });
      dispatch({ type: "submission", submission: { status: "idle" } });
      onClose();
    } catch (error) {
      fail(error);
    }
  }, [fail, landed, onClose, serverId, state.goalId]);
  const toggleLandedPress = useCallback(() => {
    void toggleLanded();
  }, [toggleLanded]);

  const remove = useCallback(async () => {
    if (state.goalId === null) return;
    const confirmed = await confirmDialog({
      title: t("board.plan2.goal.deleteTitle"),
      message: t("board.plan2.goal.deleteMessage", { title: state.title }),
      confirmLabel: t("board.plan2.goal.delete"),
      destructive: true,
    });
    if (!confirmed) return;
    dispatch({ type: "submission", submission: { status: "pending", action: "delete" } });
    try {
      await deleteBoardGoal(serverId, state.goalId);
      dispatch({ type: "submission", submission: { status: "idle" } });
      onClose();
    } catch (error) {
      fail(error);
    }
  }, [fail, onClose, serverId, state.goalId, state.title, t]);
  const removePress = useCallback(() => {
    void remove();
  }, [remove]);

  const header = useMemo<SheetHeader>(() => {
    if (target.mode === "create") return { title: t("board.plan2.goal.createTitle") };
    return { title: t("board.plan2.goal.editTitle", { number: target.goal.number }) };
  }, [t, target]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isPending}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={savePress}
          disabled={!canSave}
          loading={pendingAction === "save"}
          testID="desk-goal-submit"
        >
          {state.goalId === null ? t("board.plan2.goal.create") : t("board.plan2.goal.save")}
        </Button>
      </View>
    ),
    [canSave, isPending, onClose, pendingAction, savePress, state.goalId, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissible={!isPending}
      footer={footer}
      testID="desk-goal-sheet"
    >
      <View style={styles.body}>
        <Field label={t("board.plan2.goal.title")}>
          <FormTextInput
            size={controlSize}
            initialValue={state.title}
            onChangeText={changeTitle}
            placeholder={t("board.plan2.goal.titlePlaceholder")}
            accessibilityLabel={t("board.plan2.goal.title")}
            maxLength={200}
            testID="desk-goal-title"
          />
        </Field>
        <Field label={t("board.plan2.goal.notes")} hint={t("board.plan2.goal.notesHint")}>
          <FormTextInput
            size={controlSize}
            initialValue={state.notes}
            onChangeText={changeNotes}
            placeholder={t("board.plan2.goal.notesPlaceholder")}
            accessibilityLabel={t("board.plan2.goal.notes")}
            style={styles.notesInput}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            testID="desk-goal-notes"
          />
        </Field>
        <GoalOwnerField
          serverId={serverId}
          value={state.ownerAgentId}
          dispatch={dispatch}
          size={controlSize}
        />
        <GoalAutopilotFields
          serverId={serverId}
          state={state}
          dispatch={dispatch}
          maxActiveValid={maxActive !== null}
          dailyStartLimitValid={dailyStartLimit !== null}
          size={controlSize}
        />
        {live ? (
          <View style={styles.status}>
            <Text style={styles.statusText} testID="desk-goal-starts-today">
              {t("board.plan2.goal.startsToday", {
                count: live.startsToday,
                limit: live.autopilot?.dailyStartLimit ?? DEFAULT_DAILY_START_LIMIT,
              })}
            </Text>
            {live.lastAutopilotError ? (
              <Text style={styles.error} testID="desk-goal-last-error">
                {t("board.plan2.goal.lastError", { message: live.lastAutopilotError })}
              </Text>
            ) : null}
          </View>
        ) : null}
        {state.goalId !== null ? <GoalArtifacts serverId={serverId} goalId={state.goalId} /> : null}
        {state.goalId !== null ? (
          <View style={styles.manage}>
            <Button
              variant="outline"
              size={controlSize}
              onPress={toggleLandedPress}
              disabled={isPending}
              loading={pendingAction === "land"}
              testID="desk-goal-land"
            >
              {landed ? t("board.plan2.goal.reopen") : t("board.plan2.goal.land")}
            </Button>
            <Button
              variant="ghost"
              size={controlSize}
              onPress={removePress}
              disabled={isPending}
              loading={pendingAction === "delete"}
              textStyle={styles.deleteLabel}
              testID="desk-goal-delete"
            >
              {t("board.plan2.goal.delete")}
            </Button>
          </View>
        ) : null}
        {state.submission.status === "failed" ? (
          <Text style={styles.error}>{state.submission.message}</Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

/** The agent that plans the goal, picked from the host's live agents. */
function GoalOwnerField({
  serverId,
  value,
  dispatch,
  size,
}: {
  serverId: string;
  value: string | null;
  dispatch: Dispatch<FormAction>;
  size: ControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const serverIds = useMemo(() => [serverId], [serverId]);
  const [directory] = useHostDirectories(serverIds);
  const agents = directory?.agents;
  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const live = [...(agents?.values() ?? [])]
      .filter((agent) => !agent.archivedAt)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return [
      { id: "none", value: NO_OWNER, label: t("board.plan2.goal.noOwner") },
      ...live.map((agent) => ({
        id: agent.id,
        value: agent.id,
        label: agentLabel(agent),
        description: agent.provider,
      })),
    ];
  }, [agents, t]);
  const display = useMemo<SelectFieldDisplay>(() => {
    if (value === null) return { label: t("board.plan2.goal.noOwner") };
    const agent = agents?.get(value);
    return { label: agent ? agentLabel(agent) : t("board.plan2.goal.ownerUnavailable") };
  }, [agents, t, value]);
  const select = useCallback(
    (agentId: string) => dispatch({ type: "owner", agentId: agentId || null }),
    [dispatch],
  );
  return (
    <SelectField
      label={t("board.plan2.goal.owner")}
      value={value ?? NO_OWNER}
      selectedDisplay={display}
      options={options}
      onChange={select}
      placeholder={t("board.plan2.goal.noOwner")}
      emptyText={t("board.plan2.goal.noAgents")}
      hint={t("board.plan2.goal.ownerHint")}
      searchable
      searchPlaceholder={t("board.plan2.goal.searchAgents")}
      title={t("board.plan2.goal.owner")}
      size={size}
      triggerTestID="desk-goal-owner"
    />
  );
}

interface GoalAutopilotFieldsProps {
  serverId: string;
  state: FormState;
  dispatch: Dispatch<FormAction>;
  maxActiveValid: boolean;
  dailyStartLimitValid: boolean;
  size: ControlSize;
}

/** The goal's Autopilot: which profile starts its Ready tasks, how many, and whether to ask first. */
function GoalAutopilotFields({
  serverId,
  state,
  dispatch,
  maxActiveValid,
  dailyStartLimitValid,
  size,
}: GoalAutopilotFieldsProps): ReactElement {
  const { t } = useTranslation();
  const { profiles, isSupported: supportsProfiles } = useAgentProfiles(serverId);

  const agentOptions = useMemo<SelectFieldOption<AutopilotAgent>[]>(() => {
    const options: SelectFieldOption<AutopilotAgent>[] = (profiles ?? []).map((profile) => ({
      id: profile.id,
      value: { kind: "profile", profileId: profile.id },
      label: profile.name,
    }));
    // Settings written by an agent or the CLI can name a provider directly; keep that choice.
    if (state.agent?.kind === "config") {
      options.unshift({
        id: "config",
        value: state.agent,
        label: t("board.plan2.goal.customAgent"),
      });
    }
    return options;
  }, [profiles, state.agent, t]);
  const agentDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const agent = state.agent;
    if (agent === null) return null;
    if (agent.kind === "config") return { label: t("board.plan2.goal.customAgent") };
    const profile = profiles?.find((candidate) => candidate.id === agent.profileId);
    return { label: profile?.name ?? t("board.plan2.goal.missingProfile") };
  }, [profiles, state.agent, t]);
  const isolationOptions = useMemo<SegmentedControlOption<Isolation>[]>(
    () => [
      { value: "worktree", label: t("board.plan2.goal.isolationWorktree") },
      { value: "local", label: t("board.plan2.goal.isolationLocal") },
    ],
    [t],
  );

  const changeEnabled = useCallback(
    (value: boolean) => dispatch({ type: "enabled", value }),
    [dispatch],
  );
  const selectAgent = useCallback(
    (agent: AutopilotAgent) => dispatch({ type: "agent", agent }),
    [dispatch],
  );
  const selectIsolation = useCallback(
    (value: Isolation) => dispatch({ type: "isolation", value }),
    [dispatch],
  );
  const changeMaxActive = useCallback(
    (value: string) => dispatch({ type: "maxActive", value }),
    [dispatch],
  );
  const changeDailyStartLimit = useCallback(
    (value: string) => dispatch({ type: "dailyStartLimit", value }),
    [dispatch],
  );
  const changeConfirmStarts = useCallback(
    (value: boolean) => dispatch({ type: "confirmStarts", value }),
    [dispatch],
  );

  let agentHint: string | undefined;
  if (!supportsProfiles) agentHint = t("board.plan2.goal.profilesUnsupported");
  else if (profiles?.length === 0) agentHint = t("board.plan2.goal.noProfiles");
  const agentError =
    state.enabled && state.agent === null ? t("board.plan2.goal.agentRequired") : null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("board.plan2.goal.autopilot")}</Text>
      <Field
        label={t("board.plan2.goal.autopilotEnabled")}
        hint={t("board.plan2.goal.autopilotHint")}
      >
        <Switch
          value={state.enabled}
          onValueChange={changeEnabled}
          accessibilityLabel={t("board.plan2.goal.autopilotEnabled")}
          testID="desk-goal-autopilot-enabled"
        />
      </Field>
      <SelectField
        label={t("board.plan2.goal.agent")}
        value={state.agent}
        selectedDisplay={agentDisplay}
        options={agentOptions}
        onChange={selectAgent}
        getValueKey={agentKey}
        placeholder={t("board.plan2.goal.chooseAgent")}
        emptyText={t("board.plan2.goal.noProfiles")}
        loading={supportsProfiles && profiles === null}
        hint={agentHint}
        error={agentError}
        title={t("board.plan2.goal.agent")}
        size={size}
        triggerTestID="desk-goal-autopilot-agent"
      />
      <Field label={t("board.plan2.goal.isolation")} hint={t("board.plan2.goal.isolationHint")}>
        <SegmentedControl
          options={isolationOptions}
          value={state.isolation}
          onValueChange={selectIsolation}
          size={size}
          testID="desk-goal-autopilot-isolation"
        />
      </Field>
      <View style={styles.limits}>
        <View style={styles.limit}>
          <Field
            label={t("board.plan2.goal.maxActive")}
            error={
              maxActiveValid ? null : t("board.plan2.goal.limitRange", { max: MAX_ACTIVE_LIMIT })
            }
          >
            <FormTextInput
              size={size}
              initialValue={state.maxActive}
              onChangeText={changeMaxActive}
              accessibilityLabel={t("board.plan2.goal.maxActive")}
              keyboardType="number-pad"
              testID="desk-goal-autopilot-max-active"
            />
          </Field>
        </View>
        <View style={styles.limit}>
          <Field
            label={t("board.plan2.goal.dailyStartLimit")}
            error={
              dailyStartLimitValid
                ? null
                : t("board.plan2.goal.limitRange", { max: DAILY_START_LIMIT })
            }
          >
            <FormTextInput
              size={size}
              initialValue={state.dailyStartLimit}
              onChangeText={changeDailyStartLimit}
              accessibilityLabel={t("board.plan2.goal.dailyStartLimit")}
              keyboardType="number-pad"
              testID="desk-goal-autopilot-daily-limit"
            />
          </Field>
        </View>
      </View>
      <Field
        label={t("board.plan2.goal.confirmStarts")}
        hint={t("board.plan2.goal.confirmStartsHint")}
      >
        <Switch
          value={state.confirmStarts}
          onValueChange={changeConfirmStarts}
          accessibilityLabel={t("board.plan2.goal.confirmStarts")}
          testID="desk-goal-autopilot-confirm"
        />
      </Field>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  notesInput: {
    minHeight: 128,
  },
  section: {
    gap: theme.spacing[4],
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sectionTitle: {
    paddingTop: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  limits: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  limit: {
    flex: 1,
  },
  status: {
    gap: theme.spacing[1],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  manage: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  deleteLabel: {
    color: theme.colors.destructive,
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
