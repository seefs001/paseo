import type { BoardGoal } from "@getpaseo/protocol/messages";
import { CornerDownLeft, Plus } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type NativeSyntheticEvent,
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
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import type { Theme } from "@/styles/theme";
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
  | { kind: "saving" }
  | { kind: "saved"; title: string }
  | { kind: "failed"; message: string };

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
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [text, setText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>({ kind: "idle" });

  const parsed = useMemo(() => parseDeskCapture(text, goals), [goals, text]);
  const defaultGoal = useMemo(
    () => goals.find((goal) => goal.id === defaultGoalId) ?? null,
    [defaultGoalId, goals],
  );
  const goal = parsed.goal ?? (parsed.unmatchedGoal ? null : defaultGoal);
  const goalQuery = useMemo(() => currentGoalQuery(text), [text]);
  const suggestions = useMemo(
    () => (goalQuery && isFocused ? suggestCaptureGoals(goalQuery.query, goals) : []),
    [goalQuery, goals, isFocused],
  );

  const replace = useCallback((next: string) => {
    inputRef.current?.replaceText(next, { start: next.length, end: next.length });
    setText(next);
  }, []);
  const changeText = useCallback((next: string) => {
    setText(next);
    setStatus((current) =>
      current.kind === "failed" || current.kind === "saved" ? { kind: "idle" } : current,
    );
  }, []);
  const pickGoal = useCallback(
    (picked: BoardGoal) => {
      replace(completeGoalToken(text, picked));
      inputRef.current?.focus();
    },
    [replace, text],
  );

  const submit = useCallback(async () => {
    if (!parsed.title || status.kind === "saving") return;
    const draft = text;
    // The line clears right away so the next thought can follow; a failure puts it back.
    replace("");
    setStatus({ kind: "saving" });
    try {
      await createBoardTask(serverId, {
        title: parsed.title,
        stage: parsed.stage,
        ...(goal ? { goalId: goal.id } : {}),
        ...(parsed.readyFor ? { readyFor: parsed.readyFor } : {}),
      });
      setStatus({ kind: "saved", title: parsed.title });
    } catch (error) {
      replace(draft);
      setStatus({ kind: "failed", message: toErrorMessage(error) });
    }
  }, [goal, parsed, replace, serverId, status.kind, text]);

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
      <CaptureFootnote
        hasDraft={hasDraft}
        isFocused={isFocused}
        goal={goal}
        unmatchedGoal={parsed.unmatchedGoal}
        human={parsed.readyFor === "human"}
        idea={parsed.stage === "fog"}
        status={status}
      />
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
  hintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
