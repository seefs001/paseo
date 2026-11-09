import type { BoardGoal } from "@getpaseo/protocol/messages";
import { CornerDownLeft, Plus } from "lucide-react-native";
import { useCallback, useMemo, useReducer, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputChangeEventData,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  completeGoalToken,
  currentGoalQuery,
  parseDeskCapture,
  suggestCaptureGoals,
} from "@/board/capture";
import { createBoardTask } from "@/board/tasks";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { useToast } from "@/contexts/toast-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { toErrorMessage } from "@/utils/error-messages";

const ThemedPlus = withUnistyles(Plus);
const ThemedEnter = withUnistyles(CornerDownLeft);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type CaptureStatus =
  | { kind: "idle" }
  | { kind: "saving"; serverId: string }
  | { kind: "saved"; serverId: string; title: string }
  | { kind: "failed"; serverId: string; message: string };

const IDLE_CAPTURE_STATUS: CaptureStatus = { kind: "idle" };

interface CaptureContext {
  serverId: string;
  goals: readonly BoardGoal[];
  defaultGoal: BoardGoal | null;
}

interface CaptureSnapshot {
  id: number;
  raw: string;
  title: string;
  context: CaptureContext;
}

interface FailedCapture extends CaptureSnapshot {
  message: string;
}

interface CaptureState {
  text: string;
  restoredContext: CaptureContext | null;
  status: CaptureStatus;
  failures: readonly FailedCapture[];
}

type CaptureAction =
  | { type: "change"; text: string }
  | { type: "saving"; serverId: string }
  | { type: "saved"; serverId: string; title: string }
  | { type: "failed"; failure: FailedCapture; restore: boolean }
  | { type: "restore"; failure: FailedCapture }
  | { type: "dismiss"; failure: FailedCapture };

function captureReducer(state: CaptureState, action: CaptureAction): CaptureState {
  switch (action.type) {
    case "change":
      return {
        ...state,
        text: action.text,
        restoredContext: action.text ? state.restoredContext : null,
        status: state.status.kind === "saving" ? state.status : { kind: "idle" },
      };
    case "saving":
      return { ...state, status: { kind: "saving", serverId: action.serverId } };
    case "saved":
      return {
        ...state,
        status: { kind: "saved", serverId: action.serverId, title: action.title },
      };
    case "failed": {
      const { failure } = action;
      if (!action.restore) {
        return { ...state, status: { kind: "idle" }, failures: [...state.failures, failure] };
      }
      return {
        ...state,
        text: failure.raw,
        restoredContext: failure.context,
        status: {
          kind: "failed",
          serverId: failure.context.serverId,
          message: failure.message,
        },
      };
    }
    case "restore":
      return {
        ...state,
        text: action.failure.raw,
        restoredContext: action.failure.context,
        status: state.status.kind === "saving" ? state.status : { kind: "idle" },
        failures: state.failures.filter((failure) => failure !== action.failure),
      };
    case "dismiss":
      return {
        ...state,
        failures: state.failures.filter((failure) => failure !== action.failure),
      };
  }
}

export interface DeskCaptureBarProps {
  serverId: string;
  goals: readonly BoardGoal[];
  /** The focused goal; a line without `#goal` lands there. */
  defaultGoalId: string | null;
}

/**
 * One line to record a task from anywhere on the Desk. Only the title is required;
 * `#goal`, `!` and `~` set the rest inline, so the full task sheet stays optional.
 */
export function DeskCaptureBar({
  serverId,
  goals,
  defaultGoalId,
}: DeskCaptureBarProps): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const editRevision = useRef(0);
  const liveText = useRef("");
  const pending = useRef(false);
  const [state, dispatch] = useReducer(captureReducer, {
    text: "",
    restoredContext: null,
    status: { kind: "idle" },
    failures: [],
  });
  const { text, restoredContext } = state;
  const [isFocused, setIsFocused] = useState(false);
  const captureGoals = restoredContext?.goals ?? goals;
  const parsed = useMemo(() => parseDeskCapture(text, captureGoals), [captureGoals, text]);
  const defaultGoal = restoredContext
    ? restoredContext.defaultGoal
    : (goals.find((goal) => goal.id === defaultGoalId) ?? null);
  const isOtherHost = restoredContext !== null && restoredContext.serverId !== serverId;
  const draftHostName = restoredContext
    ? (hosts.find((host) => host.serverId === restoredContext.serverId)?.label ??
      restoredContext.serverId)
    : null;
  const status: CaptureStatus =
    state.status.kind !== "idle" && state.status.serverId !== serverId
      ? IDLE_CAPTURE_STATUS
      : state.status;
  const failure = state.failures.find((entry) => entry.context.serverId === serverId);
  const submitDisabled = isOtherHost || state.status.kind === "saving";
  const goal = parsed.goal ?? (parsed.unmatchedGoal ? null : defaultGoal);
  const goalQuery = useMemo(() => currentGoalQuery(text), [text]);
  const suggestions = useMemo(
    () => (goalQuery && isFocused ? suggestCaptureGoals(goalQuery.query, captureGoals) : []),
    [goalQuery, captureGoals, isFocused],
  );

  const replaceInput = useCallback((next: string) => {
    editRevision.current += 1;
    liveText.current = next;
    inputRef.current?.replaceText(next, { start: next.length, end: next.length });
  }, []);
  const replace = useCallback(
    (next: string) => {
      replaceInput(next);
      dispatch({ type: "change", text: next });
    },
    [replaceInput],
  );
  const changeText = useCallback((next: string) => {
    editRevision.current += 1;
    liveText.current = next;
    dispatch({ type: "change", text: next });
  }, []);
  const recordEdit = useCallback((event: NativeSyntheticEvent<TextInputChangeEventData>) => {
    // onChangeText waits for IME commit; even an uncommitted edit owns the line now.
    editRevision.current += 1;
    liveText.current = event.nativeEvent.text;
  }, []);
  const pickGoal = useCallback(
    (picked: BoardGoal) => {
      replace(completeGoalToken(text, picked));
      inputRef.current?.focus();
    },
    [replace, text],
  );

  const recordFailure = useStableEvent((failed: FailedCapture) => {
    const canRestore =
      failed.context.serverId === serverId &&
      editRevision.current === failed.id &&
      liveText.current === "" &&
      inputRef.current !== null;
    if (canRestore) replaceInput(failed.raw);
    dispatch({ type: "failed", failure: failed, restore: canRestore });
  });
  const restoreFailure = useCallback(() => {
    if (!failure || liveText.current !== "") return;
    replaceInput(failure.raw);
    dispatch({ type: "restore", failure });
    inputRef.current?.focus();
  }, [failure, replaceInput]);
  const dismissFailure = useCallback(() => {
    if (failure) dispatch({ type: "dismiss", failure });
  }, [failure]);

  const submit = useCallback(async () => {
    if (!parsed.title || pending.current || isOtherHost) return;
    // Do not submit a partially composed value that React has not observed yet.
    if (liveText.current !== text) return;
    const context = restoredContext ?? { serverId, goals, defaultGoal };
    const raw = text;
    pending.current = true;
    replace("");
    const snapshot: CaptureSnapshot = {
      id: editRevision.current,
      raw,
      title: parsed.title,
      context,
    };
    dispatch({ type: "saving", serverId });
    try {
      await createBoardTask(serverId, {
        title: parsed.title,
        stage: parsed.stage,
        ...(goal ? { goalId: goal.id } : {}),
        ...(parsed.readyFor ? { readyFor: parsed.readyFor } : {}),
      });
      dispatch({ type: "saved", serverId, title: parsed.title });
    } catch (error) {
      recordFailure({ ...snapshot, message: toErrorMessage(error) });
    } finally {
      pending.current = false;
    }
  }, [
    defaultGoal,
    goal,
    goals,
    isOtherHost,
    parsed,
    recordFailure,
    replace,
    restoredContext,
    serverId,
    text,
  ]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = event.nativeEvent.key;
      if (key === "Tab" && suggestions[0]) {
        event.preventDefault();
        pickGoal(suggestions[0]);
      } else if (key === "Escape") {
        if (text) replace("");
        else inputRef.current?.blur();
      }
    },
    [pickGoal, replace, suggestions, text],
  );

  const focus = useCallback(() => setIsFocused(true), []);
  const blur = useCallback(() => setIsFocused(false), []);
  const submitLine = useCallback(() => {
    void submit();
  }, [submit]);

  const hasDraft = parsed.title.length > 0;
  return (
    <View style={styles.wrap} testID="desk-capture">
      <View style={[styles.field, isFocused && styles.fieldFocused]}>
        <ThemedPlus size={14} uniProps={mutedColorMapping} />
        <ThemedTextInput
          ref={inputRef}
          testID="desk-capture-input"
          initialValue=""
          onChange={recordEdit}
          onChangeText={changeText}
          onFocus={focus}
          onBlur={blur}
          onSubmitEditing={submitLine}
          onKeyPress={handleKeyPress}
          submitBehavior="submit"
          placeholder={t("board.desk.capture.placeholder")}
          accessibilityLabel={t("board.desk.capture.label")}
          returnKeyType="done"
          style={styles.input}
        />
        {hasDraft ? (
          <ToolbarButton
            compact
            label={t("board.desk.capture.submit")}
            disabled={submitDisabled}
            onPress={submitLine}
            testID="desk-capture-submit"
          >
            <ThemedEnter size={14} uniProps={mutedColorMapping} />
          </ToolbarButton>
        ) : null}
      </View>
      {suggestions.length > 0 ? (
        <View style={styles.suggestions} testID="desk-capture-goals">
          {suggestions.map((suggestion, index) => (
            <GoalSuggestion
              key={suggestion.id}
              goal={suggestion}
              isFirst={index === 0}
              onPick={pickGoal}
            />
          ))}
        </View>
      ) : null}
      {isOtherHost ? (
        <Text style={styles.hintText}>
          {t("board.desk.capture.draftOtherHost", { host: draftHostName })}
        </Text>
      ) : (
        <CaptureFootnote
          hasDraft={hasDraft}
          isFocused={isFocused}
          goal={goal}
          unmatchedGoal={parsed.unmatchedGoal}
          human={parsed.readyFor === "human"}
          idea={parsed.stage === "fog"}
          status={status}
        />
      )}
      {failure ? (
        <FailedCaptureNotice
          key={failure.id}
          failure={failure}
          canRestore={text === ""}
          onRestore={restoreFailure}
          onDismiss={dismissFailure}
        />
      ) : null}
    </View>
  );
}

function FailedCaptureNotice({
  failure,
  canRestore,
  onRestore,
  onDismiss,
}: {
  failure: FailedCapture;
  canRestore: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied">("idle");
  const copy = useCallback(async () => {
    setCopyStatus("copying");
    try {
      await copyToClipboard(failure.raw);
      setCopyStatus("copied");
    } catch (error) {
      setCopyStatus("idle");
      toast.error(toErrorMessage(error));
    }
  }, [failure.raw, toast]);
  return (
    <View style={styles.recovery} testID="desk-capture-failed">
      <Text style={styles.errorText}>
        {t("board.desk.capture.failedHeld", { title: failure.title, message: failure.message })}
      </Text>
      {!canRestore ? (
        <Text style={styles.hintText}>
          {t("board.desk.capture.failedHeldWait", { title: failure.title })}
        </Text>
      ) : null}
      <View style={styles.chips}>
        <Button variant="ghost" size="sm" onPress={onRestore} disabled={!canRestore}>
          {t("composer.failedSubmission.restore")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={copy}
          loading={copyStatus === "copying"}
          disabled={copyStatus === "copying"}
        >
          {copyStatus === "copied" ? t("common.states.copied") : t("common.actions.copy")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onDismiss}>
          {t("common.actions.dismiss")}
        </Button>
      </View>
    </View>
  );
}

function GoalSuggestion({
  goal,
  isFirst,
  onPick,
}: {
  goal: BoardGoal;
  isFirst: boolean;
  onPick: (goal: BoardGoal) => void;
}): ReactElement {
  const pick = useCallback(() => onPick(goal), [goal, onPick]);
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={goal.title}
      onPress={pick}
      style={styles.suggestion}
      highlightStyle={styles.suggestionActive}
    >
      <Text style={styles.suggestionText} numberOfLines={1}>
        {goal.title}
      </Text>
      {isFirst ? <Text style={styles.hintText}>Tab</Text> : null}
    </PressHighlight>
  );
}

/** What Enter will create, or how the last capture went, or how to use the tokens. */
function CaptureFootnote({
  hasDraft,
  isFocused,
  goal,
  unmatchedGoal,
  human,
  idea,
  status,
}: {
  hasDraft: boolean;
  isFocused: boolean;
  goal: BoardGoal | null;
  unmatchedGoal: string | null;
  human: boolean;
  idea: boolean;
  status: CaptureStatus;
}): ReactElement | null {
  const { t } = useTranslation();
  if (status.kind === "failed") {
    return (
      <Text style={styles.errorText}>
        {t("board.desk.capture.failed", { message: status.message })}
      </Text>
    );
  }
  if (hasDraft) {
    const chips = [
      goal ? t("board.desk.capture.toGoal", { goal: goal.title }) : t("board.desk.capture.noGoal"),
      unmatchedGoal ? t("board.desk.capture.unmatched", { query: unmatchedGoal }) : null,
      idea ? t("board.desk.capture.idea") : t("board.desk.capture.ready"),
      human ? t("board.desk.capture.human") : null,
    ].filter((chip): chip is string => chip !== null);
    return (
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Text key={chip} style={styles.chip}>
            {chip}
          </Text>
        ))}
      </View>
    );
  }
  if (status.kind === "saving")
    return <Text style={styles.hintText}>{t("board.desk.capture.saving")}</Text>;
  if (status.kind === "saved") {
    return (
      <Text style={styles.hintText}>{t("board.desk.capture.saved", { title: status.title })}</Text>
    );
  }
  if (isFocused) return <Text style={styles.hintText}>{t("board.desk.capture.hint")}</Text>;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing[1.5],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
    maxWidth: 720,
    width: "100%",
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fieldFocused: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 20,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  suggestions: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingVertical: theme.spacing[1],
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
  },
  suggestionActive: {
    backgroundColor: theme.colors.surface2,
  },
  suggestionText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  chip: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  recovery: {
    gap: theme.spacing[1],
  },
  hintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
