import type { BoardGoal, BoardTaskCriterion } from "@getpaseo/protocol/messages";
import { Circle, CircleCheck, Copy } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { useBoardTasks } from "@/board/tasks";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { toErrorMessage } from "@/utils/error-messages";

const ThemedMet = withUnistyles(CircleCheck);
const ThemedUnmet = withUnistyles(Circle);
const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotSuccess });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** A titled block of the detail panel. `trailing` sits on the title line. */
export function DetailSection({
  title,
  trailing,
  children,
  testID,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/** Label on the left rail, value on the right; a press makes the value a link. */
export function DetailProperty({
  label,
  value,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.property} testID={testID}>
      <Text style={styles.propertyLabel} numberOfLines={1}>
        {label}
      </Text>
      {onPress ? (
        <PressHighlight
          accessibilityRole="link"
          accessibilityLabel={`${label}: ${value}`}
          onPress={onPress}
          style={linkStyle}
          highlightStyle={styles.linkPressed}
        >
          <Text style={styles.propertyLink} numberOfLines={1}>
            {value}
          </Text>
        </PressHighlight>
      ) : (
        <Text style={styles.propertyValue} numberOfLines={2} selectable>
          {value}
        </Text>
      )}
    </View>
  );
}

/**
 * The goal a task serves, or the goal an agent owns when `goalId` is null. Pressing it edits the
 * goal; nothing shows when there is no goal.
 */
export function DetailGoalProperty({
  serverId,
  goalId,
  ownerAgentId,
}: {
  serverId: string;
  goalId: string | null;
  ownerAgentId?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const goal = useBoardTasks((state): BoardGoal | null => {
    const host = state.hosts[serverId];
    if (host?.status !== "ready") return null;
    if (goalId) return host.goals.get(goalId) ?? null;
    if (!ownerAgentId) return null;
    for (const candidate of host.goals.values()) {
      if (candidate.ownerAgentId === ownerAgentId) return candidate;
    }
    return null;
  });
  const edit = useCallback(() => {
    if (goal) openDeskGoalSheet({ mode: "edit", serverId, goal });
  }, [goal, serverId]);
  if (!goal) return null;
  const owns = goalId === null;
  return (
    <DetailProperty
      label={t(owns ? "board.desk.detail.owns" : "board.desk.detail.goal")}
      value={`G-${goal.number} ${goal.title}`}
      onPress={edit}
      testID="board-detail-goal"
    />
  );
}

function linkStyle({ hovered, pressed }: HoverState) {
  return [styles.link, hovered && styles.linkHovered, pressed && styles.linkPressed];
}

/** A pressable line in a list, such as a subagent or a subtask. */
export function DetailListRow({
  leading,
  label,
  trailing,
  onPress,
  testID,
}: {
  leading?: ReactNode;
  label: string;
  trailing?: string;
  onPress: () => void;
  testID?: string;
}): ReactElement {
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={listRowStyle}
      highlightStyle={styles.linkPressed}
      testID={testID}
    >
      {leading ? <View style={styles.listRowLeading}>{leading}</View> : null}
      <Text style={styles.listRowLabel} numberOfLines={1}>
        {label}
      </Text>
      {trailing ? <Text style={styles.muted}>{trailing}</Text> : null}
    </PressHighlight>
  );
}

function listRowStyle({ hovered, pressed }: HoverState) {
  return [styles.listRow, hovered && styles.linkHovered, pressed && styles.linkPressed];
}

/** The full checklist, read-only: the agent ticks it, review compares it with the summary. */
export function DetailCriteria({
  criteria,
}: {
  criteria: readonly BoardTaskCriterion[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.criteria}>
      {criteria.map((criterion, index) => (
        // Criteria have no ids and only change as a whole list.
        // eslint-disable-next-line react/no-array-index-key
        <View key={index} style={styles.criterion}>
          {criterion.met ? (
            <ThemedMet size={14} uniProps={successColorMapping} />
          ) : (
            <ThemedUnmet size={14} uniProps={mutedColorMapping} />
          )}
          <Text
            style={styles.criterionText}
            accessibilityLabel={
              criterion.met
                ? t("board.review.criterionMet", { text: criterion.text })
                : t("board.review.criterionUnmet", { text: criterion.text })
            }
          >
            {criterion.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Markdown text with a copy action on its section title. */
export function DetailMarkdown({
  title,
  text,
  testID,
}: {
  title: string;
  text: string;
  testID?: string;
}): ReactElement {
  const copy = useMemo(() => <CopyButton text={text} label={title} />, [text, title]);
  return (
    <DetailSection title={title} trailing={copy} testID={testID}>
      <MarkdownRenderer text={text} compact />
    </DetailSection>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = useCallback(() => {
    copyToClipboard(text).then(
      () => toast.copied(label),
      (error: unknown) =>
        toast.error(`${t("common.errors.unableToCopy")}: ${toErrorMessage(error)}`),
    );
  }, [label, t, text, toast]);
  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={Copy}
      onPress={copy}
      accessibilityLabel={t("board.detail.copy", { label })}
    />
  );
}

/** Placeholder lines in the box the loaded text will take, so the panel does not jump. */
export function DetailSkeleton({ lines = 3 }: { lines?: number }): ReactElement {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: lines }, (_, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <View
          key={index}
          style={index === lines - 1 ? styles.skeletonLineShort : styles.skeletonLine}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minHeight: 28,
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  property: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 24,
  },
  propertyLabel: {
    width: 96,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  propertyValue: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  propertyLink: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  link: {
    flexShrink: 1,
    minWidth: 0,
    borderRadius: theme.borderRadius.base,
  },
  linkHovered: {
    backgroundColor: theme.colors.surface2,
  },
  linkPressed: {
    backgroundColor: theme.colors.surface3,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  listRowLeading: {
    width: 14,
    alignItems: "center",
  },
  listRowLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  criteria: {
    gap: theme.spacing[1.5],
  },
  criterion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  criterionText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  skeleton: {
    gap: theme.spacing[2],
  },
  skeletonLine: {
    height: 12,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface3,
  },
  skeletonLineShort: {
    width: "60%",
    height: 12,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface3,
  },
}));
