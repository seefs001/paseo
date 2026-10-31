import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Search } from "lucide-react-native";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { formatMessageTimestamp } from "@/utils/time";
import { literalNmemMarkdown } from "./markdown";

const ThemedSearch = withUnistyles(Search);

const PREVIEW_LINES = 4;
const PREVIEW_CHARACTERS = 240;
// A clamped preview never shows more than this, so a long thread message is not laid out in full.
const PREVIEW_SOURCE_LIMIT = 1200;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatScore(value: number): string {
  return value.toFixed(2);
}

export function formatInstant(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatMessageTimestamp(date);
}

export interface SummaryBadge {
  key: string;
  label: string;
}

interface ResultSummaryProps {
  label: string;
  query?: string | null;
  title?: string | null;
  /** How many items this call actually returned. */
  returned?: number;
  /** The total nmem reports, which can exceed what this call returned. */
  total?: number | null;
  badges?: SummaryBadge[];
  children?: ReactNode;
}

export function ResultSummary({
  label,
  query,
  title,
  returned,
  total,
  badges,
  children,
}: ResultSummaryProps) {
  const { t } = useTranslation();
  const hasCounts = returned !== undefined || (total !== undefined && total !== null);
  const hasBadges = hasCounts || (badges !== undefined && badges.length > 0);
  return (
    <View style={styles.summary} testID="nmem-summary">
      <Text style={styles.summaryLabel}>{label}</Text>
      {query ? (
        <View style={styles.queryRow} testID="nmem-query">
          <ThemedSearch size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />
          <Text selectable style={styles.summaryTitle}>
            {query}
          </Text>
        </View>
      ) : null}
      {title ? (
        <Text selectable style={styles.summaryTitle}>
          {title}
        </Text>
      ) : null}
      {hasBadges ? (
        <View style={styles.pills}>
          {returned === undefined ? null : (
            <View testID="nmem-returned-count">
              <StatusBadge size="xs" label={t("nmem.counts.returned", { value: returned })} />
            </View>
          )}
          {total === undefined || total === null ? null : (
            <View testID="nmem-total-count">
              <StatusBadge size="xs" label={t("nmem.counts.total", { value: total })} />
            </View>
          )}
          {badges?.map((badge) => (
            <StatusBadge key={badge.key} size="xs" label={badge.label} />
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function SummaryHint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function ResultCard({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <View style={settingsStyles.card} testID={testID}>
      {children}
    </View>
  );
}

interface ResultRowProps {
  first: boolean;
  testID?: string;
  children: ReactNode;
}

export function ResultRow({ first, testID, children }: ResultRowProps) {
  return (
    <View style={[styles.row, !first && settingsStyles.rowBorder]} testID={testID}>
      {children}
    </View>
  );
}

export function RowTitle({ children }: { children: string }) {
  return (
    <Text selectable style={styles.rowTitle}>
      {children}
    </Text>
  );
}

export function IdentifierText({ children }: { children: string }) {
  return (
    <Text selectable style={styles.identifier}>
      {children}
    </Text>
  );
}

export function EmptyResult({ label }: { label: string }) {
  return (
    <View style={settingsStyles.card} testID="nmem-empty-result">
      <Text style={styles.empty}>{label}</Text>
    </View>
  );
}

export interface MetaItem {
  key: string;
  /** Names a value whose meaning the value alone does not carry, such as a score. */
  label?: string;
  value: string | null | undefined;
}

export function MetaLine({ items }: { items: MetaItem[] }) {
  const shown = items.filter((item) => item.value);
  if (shown.length === 0) return null;
  return (
    <Text selectable style={styles.meta}>
      {shown.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? " · " : null}
          {item.label ? `${item.label} ` : null}
          <Text style={item.label ? styles.metaValue : null}>{item.value}</Text>
        </Fragment>
      ))}
    </Text>
  );
}

export function LabelList({ labels }: { labels: readonly string[] | null | undefined }) {
  const unique = useMemo(() => [...new Set(labels ?? [])], [labels]);
  if (unique.length === 0) return null;
  return (
    <View style={styles.pills} testID="nmem-labels">
      {unique.map((label) => (
        <StatusBadge key={label} size="xs" label={label} />
      ))}
    </View>
  );
}

interface DisclosureButtonProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  testID?: string;
}

export function DisclosureButton({ label, expanded, onToggle, testID }: DisclosureButtonProps) {
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={expanded ? ChevronDown : ChevronRight}
      onPress={onToggle}
      accessibilityState={accessibilityState}
      aria-expanded={expanded}
      style={styles.disclosure}
      testID={testID}
    >
      {label}
    </Button>
  );
}

interface ExpandableTextProps {
  text: string;
  muted?: boolean;
}

/** Long text starts as a clamped plain preview; expanding it renders the full text as Markdown. */
export function ExpandableText({ text, muted = false }: ExpandableTextProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const isLong = text.length > PREVIEW_CHARACTERS || text.split("\n").length > PREVIEW_LINES;
  return (
    <View style={styles.expandable}>
      {expanded ? (
        <FullText text={text} muted={muted} />
      ) : (
        <Text
          selectable
          style={muted ? styles.mutedBody : styles.body}
          numberOfLines={isLong ? PREVIEW_LINES : undefined}
          testID="nmem-text"
        >
          {isLong ? text.slice(0, PREVIEW_SOURCE_LIMIT) : text}
        </Text>
      )}
      {isLong ? (
        <DisclosureButton
          label={expanded ? t("nmem.showLess") : t("nmem.showMore")}
          expanded={expanded}
          onToggle={toggle}
          testID="nmem-expand-toggle"
        />
      ) : null}
    </View>
  );
}

export function FullText({ text, muted = false }: ExpandableTextProps) {
  return (
    <View testID="nmem-text">
      <MarkdownBody text={text} muted={muted} />
    </View>
  );
}

export function MarkdownBody({ text, muted = false }: ExpandableTextProps) {
  const markdown = useMemo(() => literalNmemMarkdown(text), [text]);
  return <MarkdownRenderer text={markdown} compact muted={muted} />;
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    gap: theme.spacing[2],
  },
  summaryLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summaryTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  hint: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  row: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  identifier: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  metaValue: {
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  expandable: {
    gap: theme.spacing[1],
  },
  body: {
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  mutedBody: {
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    color: theme.colors.foregroundMuted,
  },
  // Optical: hangs the ghost button's padding outside the column so its chevron sits on the text rail.
  disclosure: {
    alignSelf: "flex-start",
    marginLeft: -theme.spacing[3],
  },
}));
