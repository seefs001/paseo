import { AlarmClockOff, ChevronDown, ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DeskCheckpoint } from "@/board/desk";
import { snoozeCheckpoint } from "@/board/snooze";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { formatMessageTimestamp } from "@/utils/time";
import { useCheckpointHeadline } from "./desk-brief-parts";

/**
 * Snoozed checkpoints, collapsed to a count. Each waits here until its wake time puts it back in
 * Decide; Wake now does that early.
 */
export function DeskLaterTray({
  checkpoints,
}: {
  checkpoints: DeskCheckpoint[];
}): ReactElement | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  if (checkpoints.length === 0) return null;
  return (
    <View style={styles.container} testID="desk-later-tray">
      <Button
        size="xs"
        variant="ghost"
        leftIcon={expanded ? ChevronDown : ChevronRight}
        onPress={toggle}
        style={styles.toggle}
        accessibilityState={accessibilityState}
        testID="desk-later-toggle"
      >
        {t("board.brief.later.title", { count: checkpoints.length })}
      </Button>
      {expanded
        ? checkpoints.map((checkpoint) => <LaterRow key={checkpoint.key} checkpoint={checkpoint} />)
        : null}
    </View>
  );
}

function LaterRow({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const headline = useCheckpointHeadline(checkpoint);
  const [waking, setWaking] = useState(false);
  const wake = useCallback(async () => {
    setWaking(true);
    try {
      await snoozeCheckpoint(checkpoint, null);
    } catch (error) {
      toast.error(t("board.brief.later.wakeFailed", { message: toErrorMessage(error) }));
      setWaking(false);
    }
  }, [checkpoint, t, toast]);
  const wakePress = useCallback(() => {
    void wake();
  }, [wake]);
  const wakesAt = checkpoint.snoozedUntil
    ? formatMessageTimestamp(new Date(checkpoint.snoozedUntil))
    : null;
  return (
    <View style={styles.row} testID={`desk-later-${checkpoint.key}`}>
      <View style={styles.text}>
        <Text style={styles.headline} numberOfLines={1}>
          {headline}
        </Text>
        {wakesAt ? (
          <Text style={styles.wakes} numberOfLines={1}>
            {t("board.brief.later.wakes", { time: wakesAt })}
          </Text>
        ) : null}
      </View>
      <Button
        size="xs"
        variant="ghost"
        leftIcon={AlarmClockOff}
        onPress={wakePress}
        loading={waking}
        disabled={waking}
        testID={`desk-later-wake-${checkpoint.key}`}
      >
        {waking ? t("board.brief.later.waking") : t("board.brief.later.wakeNow")}
      </Button>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  wakes: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
