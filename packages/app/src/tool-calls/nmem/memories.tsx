import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  EmptyResult,
  ExpandableText,
  FullText,
  IdentifierText,
  LabelList,
  MetaLine,
  ResultCard,
  ResultRow,
  ResultSummary,
  RowTitle,
  SummaryHint,
  formatInstant,
  formatScore,
} from "./parts";
import type { NmemMemories, NmemMemory, NmemMemoryTable, NmemMemoryTableRow } from "./result";

export function MemoriesView({ memories }: { memories: NmemMemories }) {
  const { t } = useTranslation();
  const isSearch = typeof memories.query === "string";
  const badges = memories.search_mode ? [{ key: "mode", label: memories.search_mode }] : undefined;
  return (
    <View style={styles.view} testID="nmem-result-memories">
      <ResultSummary
        label={isSearch ? t("nmem.kinds.memorySearch") : t("nmem.kinds.memoryList")}
        query={memories.query}
        returned={memories.memories.length}
        total={memories.total}
        badges={badges}
      />
      {memories.memories.length === 0 ? (
        <EmptyResult label={t("nmem.emptyMemories")} />
      ) : (
        <ResultCard>
          {memories.memories.map((memory, index) => (
            <MemoryRow key={memory.id} memory={memory} first={index === 0} detailed={false} />
          ))}
        </ResultCard>
      )}
    </View>
  );
}

export function MemoryView({ memory }: { memory: NmemMemory }) {
  const { t } = useTranslation();
  return (
    <View style={styles.view} testID="nmem-result-memory">
      <ResultSummary label={t("nmem.kinds.memory")} />
      <ResultCard>
        <MemoryRow memory={memory} first detailed />
      </ResultCard>
    </View>
  );
}

interface MemoryRowProps {
  memory: NmemMemory;
  first: boolean;
  /** A memory read on its own shows its id and its whole content. */
  detailed: boolean;
}

function MemoryRow({ memory, first, detailed }: MemoryRowProps) {
  const { t } = useTranslation();
  const score = typeof memory.score === "number" ? formatScore(memory.score) : null;
  const importance = typeof memory.importance === "number" ? formatScore(memory.importance) : null;
  const createdAt = memory.created_at ? formatInstant(memory.created_at) : null;
  return (
    <ResultRow first={first} testID="nmem-memory-item">
      <RowTitle>{memory.title || memory.id}</RowTitle>
      <MetaLine
        items={[
          { key: "relevance", label: t("nmem.fields.relevance"), value: score },
          { key: "importance", label: t("nmem.fields.importance"), value: importance },
          { key: "type", value: memory.unit_type },
          { key: "date", value: createdAt },
          { key: "source", value: memory.source },
        ]}
      />
      {detailed && memory.id ? <IdentifierText>{memory.id}</IdentifierText> : null}
      <LabelList labels={memory.labels} />
      {memory.content && detailed ? <FullText text={memory.content} /> : null}
      {memory.content && !detailed ? <ExpandableText text={memory.content} muted /> : null}
    </ResultRow>
  );
}

export function MemoryTableView({ table }: { table: NmemMemoryTable }) {
  const { t } = useTranslation();
  return (
    <View style={styles.view} testID="nmem-result-memory-table">
      <ResultSummary
        label={t("nmem.kinds.memorySearch")}
        query={table.query}
        returned={table.rows.length}
      >
        <SummaryHint>{t("nmem.textTableHint")}</SummaryHint>
      </ResultSummary>
      {table.rows.length === 0 ? (
        <EmptyResult label={t("nmem.emptyMemories")} />
      ) : (
        <ResultCard>
          {table.rows.map((row, index) => (
            <MemoryTableRow key={row.id} row={row} first={index === 0} />
          ))}
        </ResultCard>
      )}
    </View>
  );
}

function MemoryTableRow({ row, first }: { row: NmemMemoryTableRow; first: boolean }) {
  const { t } = useTranslation();
  return (
    <ResultRow first={first} testID="nmem-memory-item">
      <RowTitle>{row.title || row.id}</RowTitle>
      <MetaLine
        items={[
          { key: "relevance", label: t("nmem.fields.relevance"), value: row.score },
          { key: "importance", label: t("nmem.fields.importance"), value: row.importance },
          { key: "type", value: row.type },
          { key: "age", value: row.age },
          { key: "source", value: row.source },
        ]}
      />
      <IdentifierText>{row.id}</IdentifierText>
    </ResultRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[4],
  },
}));
