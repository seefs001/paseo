import type { BoardTaskCriterion } from "@getpaseo/protocol/messages";
import { ChevronDown, ChevronRight, CircleCheck, Circle } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";

const ThemedMet = withUnistyles(CircleCheck);
const ThemedUnmet = withUnistyles(Circle);

const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotSuccess });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ICON_SIZE = 12;

/**
 * The task's acceptance criteria on a Review card, collapsed to a met count unless
 * `defaultExpanded`. The agent ticks them; the card only reads them, so review compares them with
 * the summary.
 */
export function BoardReviewCriteria({
  taskId,
  criteria,
  defaultExpanded = false,
}: {
  taskId: string;
  criteria: readonly BoardTaskCriterion[];
  defaultExpanded?: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  if (criteria.length === 0) return null;
  const met = criteria.filter((criterion) => criterion.met).length;
  return (
    <View style={styles.container}>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={expanded ? ChevronDown : ChevronRight}
        onPress={toggle}
        style={styles.toggle}
        accessibilityState={accessibilityState}
        testID={`board-card-criteria-${taskId}`}
      >
        {t("board.review.criteria", { met, total: criteria.length })}
      </Button>
      {expanded
        ? criteria.map((criterion, index) => (
            // Criteria have no ids and only change as a whole list.
            // eslint-disable-next-line react/no-array-index-key
            <View key={index} style={styles.item}>
              {criterion.met ? (
                <ThemedMet size={ICON_SIZE} uniProps={successColorMapping} />
              ) : (
                <ThemedUnmet size={ICON_SIZE} uniProps={mutedColorMapping} />
              )}
              <Text
                style={styles.text}
                accessibilityLabel={
                  criterion.met
                    ? t("board.review.criterionMet", { text: criterion.text })
                    : t("board.review.criterionUnmet", { text: criterion.text })
                }
              >
                {criterion.text}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[1],
  },
  toggle: {
    alignSelf: "flex-start",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
