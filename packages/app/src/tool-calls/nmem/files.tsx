import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";
import {
  DisclosureButton,
  EmptyResult,
  IdentifierText,
  LabelList,
  MarkdownBody,
  MetaLine,
  ResultCard,
  ResultRow,
  ResultSummary,
  RowTitle,
  formatInstant,
  type SummaryBadge,
} from "./parts";
import type { NmemEntries, NmemField, NmemFile } from "./result";

type Entry = NmemEntries["entries"][number];

export function EntriesView({ entries }: { entries: NmemEntries }) {
  const { t } = useTranslation();
  const badges: SummaryBadge[] = [];
  if (typeof entries.total_estimate === "number") {
    badges.push({
      key: "estimate",
      label: t("nmem.counts.totalEstimate", { value: entries.total_estimate }),
    });
  }
  if (entries.next_cursor) {
    badges.push({ key: "more", label: t("nmem.counts.moreAvailable") });
  }
  return (
    <View style={styles.view} testID="nmem-result-entries">
      <ResultSummary
        label={t("nmem.kinds.entries")}
        returned={entries.entries.length}
        badges={badges}
      />
      {entries.entries.length === 0 ? (
        <EmptyResult label={t("nmem.emptyEntries")} />
      ) : (
        <ResultCard>
          {entries.entries.map((entry, index) => (
            <EntryRow key={entry.path} entry={entry} first={index === 0} />
          ))}
        </ResultCard>
      )}
    </View>
  );
}

function EntryRow({ entry, first }: { entry: Entry; first: boolean }) {
  const title = entry.title || entry.name || entry.path;
  return (
    <ResultRow first={first} testID="nmem-entry-item">
      <RowTitle>{title}</RowTitle>
      <MetaLine
        items={[
          { key: "type", value: entry.type },
          { key: "kind", value: entry.kind },
          { key: "date", value: entry.updated_at ? formatInstant(entry.updated_at) : null },
        ]}
      />
      {title === entry.path ? null : <IdentifierText>{entry.path}</IdentifierText>}
    </ResultRow>
  );
}

function isMarkdown(file: NmemFile): boolean {
  return file.contentType === "markdown" || /\.(md|markdown)$/i.test(file.path);
}

export function FileView({ file }: { file: NmemFile }) {
  const { t } = useTranslation();
  const [frontmatterOpen, setFrontmatterOpen] = useState(false);
  const toggleFrontmatter = useCallback(() => setFrontmatterOpen((value) => !value), []);
  const badges: SummaryBadge[] = [];
  if (file.contentType) badges.push({ key: "type", label: file.contentType });
  if (file.range) {
    const { start_line: start, end_line: end, total_lines: total } = file.range;
    const label =
      typeof total === "number"
        ? t("nmem.counts.lines", { start, end, total })
        : t("nmem.counts.linesPartial", { start, end });
    badges.push({ key: "range", label });
  }
  return (
    <View style={styles.view} testID="nmem-result-file">
      <ResultSummary
        label={t("nmem.kinds.file")}
        title={file.title ?? file.path.split("/").pop()}
        badges={badges}
      >
        <IdentifierText>{file.path}</IdentifierText>
        <LabelList labels={file.labels} />
      </ResultSummary>
      <FileBody file={file} />
      {file.frontmatter.length > 0 ? (
        <View style={styles.frontmatter}>
          <DisclosureButton
            label={t("nmem.frontmatter")}
            expanded={frontmatterOpen}
            onToggle={toggleFrontmatter}
            testID="nmem-frontmatter-toggle"
          />
          {frontmatterOpen ? <FrontmatterCard fields={file.frontmatter} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function FileBody({ file }: { file: NmemFile }) {
  if (!file.body.trim()) return null;
  if (isMarkdown(file)) {
    return (
      <View style={[settingsStyles.card, styles.markdown]} testID="nmem-file-body">
        <MarkdownBody text={file.body} />
      </View>
    );
  }
  return (
    <ScrollableCodeSurface
      horizontal={false}
      textStyle={styles.wrappedCode}
      testID="nmem-file-body"
    >
      {file.body}
    </ScrollableCodeSurface>
  );
}

function FrontmatterCard({ fields }: { fields: NmemField[] }) {
  return (
    <ResultCard testID="nmem-frontmatter">
      {fields.map((field, index) => (
        <View
          key={field.key}
          style={[styles.field, index > 0 && settingsStyles.rowBorder]}
          testID="nmem-frontmatter-field"
        >
          <Text style={styles.fieldKey}>{field.key}</Text>
          <Text selectable style={styles.fieldValue}>
            {field.value}
          </Text>
        </View>
      ))}
    </ResultCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[4],
  },
  markdown: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  wrappedCode: {
    lineHeight: 18,
    ...(isWeb ? { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const } : null),
  },
  frontmatter: {
    gap: theme.spacing[2],
  },
  field: {
    gap: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  fieldKey: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
  },
  fieldValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
