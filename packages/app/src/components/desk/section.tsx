import type { ReactElement, ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";

/**
 * One Desk layer: a medium label with its count, and its rows in one card. The count is what is
 * known now; rows can also hold last-known entries from offline hosts, so emptiness follows rows.
 */
export function DeskSection({
  title,
  count,
  rowCount,
  note,
  empty,
  children,
  testID,
}: {
  title: string;
  count: number;
  rowCount: number;
  note: string | null;
  empty: string;
  children: ReactNode;
  testID: string;
}): ReactElement {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.count}>{count}</Text>
        {note ? (
          <Text style={styles.note} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>
      <View style={settingsStyles.card}>
        {rowCount > 0 ? children : <Text style={styles.empty}>{empty}</Text>}
      </View>
    </View>
  );
}

/** Rows after the first in a card carry one top border. */
export function DeskRowDivider({ first, children }: { first: boolean; children: ReactNode }) {
  return <View style={first ? null : settingsStyles.rowBorder}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  note: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
}));
