import type { WorkspaceStateBucket } from "@getpaseo/protocol/messages";
import { CircleAlert } from "lucide-react-native";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StatusRing } from "@/components/status-ring";
import type { Theme } from "@/styles/theme";
import { getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";

const ThemedCircleAlert = withUnistyles(CircleAlert);

const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

/**
 * The sidebar workspace row's status glyphs for one agent: the ring while it works, the alert
 * while it waits, a coloured dot for failed or unseen, a muted dot once seen.
 */
export function BoardAgentStateIndicator({
  bucket,
}: {
  bucket: WorkspaceStateBucket;
}): ReactElement {
  return (
    <View style={styles.slot} testID={`board-agent-state-${bucket}`}>
      <StateGlyph bucket={bucket} />
    </View>
  );
}

function StateGlyph({ bucket }: { bucket: WorkspaceStateBucket }): ReactElement {
  switch (bucket) {
    case "running":
      return <StatusRing />;
    case "needs_input":
      return (
        <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputColorMapping} />
      );
    case "failed":
      return <View style={[styles.dot, styles.dotFailed]} />;
    case "attention":
      return <View style={[styles.dot, styles.dotAttention]} />;
    case "done":
      return <View style={[styles.dot, styles.dotIdle]} />;
  }
}

/** Child-state colours for the subagent pill, from the same status band as the glyphs. */
export function BoardAgentStateDot({ bucket }: { bucket: WorkspaceStateBucket }): ReactElement {
  return <View style={[styles.dot, dotColorStyle(bucket)]} />;
}

function dotColorStyle(bucket: WorkspaceStateBucket) {
  switch (bucket) {
    case "running":
      return styles.dotRunning;
    case "needs_input":
      return styles.dotNeedsInput;
    case "failed":
      return styles.dotFailed;
    case "attention":
      return styles.dotAttention;
    case "done":
      return styles.dotIdle;
  }
}

const styles = StyleSheet.create((theme) => ({
  slot: {
    width: STATUS_INDICATOR_ALERT_SIZE + 2,
    height: STATUS_INDICATOR_ALERT_SIZE + 2,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  dotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
  },
  dotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
  },
  dotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  dotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  dotIdle: {
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
}));
