import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Brain } from "lucide-react-native";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { useAssistantFileLinkEnvironmentBridge } from "@/assistant-file-links";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { isWeb } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { EntriesView, FileView } from "./files";
import { MemoriesView, MemoryTableView, MemoryView } from "./memories";
import { formatNmemOutput, type NmemCall } from "./model";
import { DisclosureButton, ResultCard, ResultSummary, SummaryHint } from "./parts";
import { parseNmemResult, type NmemResult, type NmemStats } from "./result";
import { ThreadsView, ThreadView } from "./threads";

const ThemedBrain = withUnistyles(Brain);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const SHEET_HEADER: SheetHeader = {
  title: "nmem",
  leading: <ThemedBrain size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
};

interface NmemDetailsProps {
  call: NmemCall;
  detail: Extract<ToolCallDetail, { type: "shell" }>;
  metadata?: Record<string, unknown>;
  errorText?: string;
  running: boolean;
  visible: boolean;
  onClose: () => void;
  onOpenFilePath?: (path: string) => void;
}

export function NmemDetails({ visible, onClose, ...body }: NmemDetailsProps) {
  const active = useRetainedPanelActive();
  const fileLinkBridge = useAssistantFileLinkEnvironmentBridge();
  return (
    <AdaptiveModalSheet
      header={SHEET_HEADER}
      visible={visible && active}
      onClose={onClose}
      desktopMaxWidth={800}
      testID="nmem-details"
      contentStyle={styles.content}
      contextBridge={fileLinkBridge}
    >
      <NmemDetailsBody {...body} onClose={onClose} />
    </AdaptiveModalSheet>
  );
}

type NmemDetailsBodyProps = Omit<NmemDetailsProps, "visible">;

// Mounted only while the sheet shows, so rows that are never opened do not parse their output.
function NmemDetailsBody({
  call,
  detail,
  metadata,
  errorText,
  running,
  onClose,
  onOpenFilePath,
}: NmemDetailsBodyProps) {
  const output = detail.output;
  const result = useMemo(() => (output ? parseNmemResult(output) : null), [output]);
  const isUnrecognized = result === null && Boolean(output?.trim());
  const sharedOutput =
    typeof metadata?.codemodeOutput === "string" ? metadata.codemodeOutput : null;
  const fullOutputPath =
    typeof metadata?.codemodeFullOutputPath === "string" ? metadata.codemodeFullOutputPath : null;
  const canOpenFullOutput = fullOutputPath !== null && onOpenFilePath !== undefined;
  const showSharedOutput = output === undefined && (sharedOutput !== null || canOpenFullOutput);

  const openFullOutput = useCallback(() => {
    if (!fullOutputPath || !onOpenFilePath) return;
    onClose();
    onOpenFilePath(fullOutputPath);
  }, [fullOutputPath, onClose, onOpenFilePath]);

  return (
    <>
      {errorText ? <ErrorNotice text={errorText} /> : null}
      <OutputSection output={output} result={result} running={running} />
      {showSharedOutput ? (
        <SharedOutput
          output={sharedOutput}
          onOpenFullOutput={canOpenFullOutput ? openFullOutput : undefined}
        />
      ) : null}
      <RawSection
        key={isUnrecognized ? "unrecognized" : "recognized"}
        command={call.command}
        output={output}
        defaultExpanded={isUnrecognized}
      />
    </>
  );
}

interface OutputSectionProps {
  output: string | undefined;
  result: NmemResult | null;
  running: boolean;
}

function OutputSection({ output, result, running }: OutputSectionProps) {
  const { t } = useTranslation();
  if (output === undefined) {
    return (
      <View style={styles.status} testID="nmem-output-missing">
        {running ? <ThemedLoadingSpinner uniProps={mutedIconColorMapping} /> : null}
        <SummaryHint>{running ? t("nmem.pending") : t("nmem.unavailable")}</SummaryHint>
      </View>
    );
  }
  if (!output.trim()) {
    return (
      <View style={styles.status} testID="nmem-output-empty">
        <SummaryHint>{t("nmem.empty")}</SummaryHint>
      </View>
    );
  }
  if (!result) {
    return (
      <View style={styles.status} testID="nmem-unrecognized">
        <SummaryHint>{t("nmem.unrecognized")}</SummaryHint>
      </View>
    );
  }
  return <ResultView result={result} />;
}

function ResultView({ result }: { result: NmemResult }) {
  switch (result.kind) {
    case "memories":
      return <MemoriesView memories={result.memories} />;
    case "memory":
      return <MemoryView memory={result.memory} />;
    case "memoryTable":
      return <MemoryTableView table={result.table} />;
    case "threads":
      return <ThreadsView threads={result.threads} />;
    case "thread":
      return <ThreadView thread={result.thread} />;
    case "entries":
      return <EntriesView entries={result.entries} />;
    case "file":
      return <FileView file={result.file} />;
    case "stats":
      return <StatsView stats={result.stats} />;
  }
}

interface StatRow {
  key: keyof NmemStats;
  label: string;
}

function StatsView({ stats }: { stats: NmemStats }) {
  const { t } = useTranslation();
  const rows: StatRow[] = [
    { key: "memories", label: t("nmem.stats.memories") },
    { key: "threads", label: t("nmem.stats.threads") },
    { key: "entities", label: t("nmem.stats.entities") },
    { key: "labels", label: t("nmem.stats.labels") },
    { key: "communities", label: t("nmem.stats.communities") },
  ];
  return (
    <View style={styles.view} testID="nmem-result-stats">
      <ResultSummary label={t("nmem.kinds.stats")} />
      <ResultCard>
        {rows.map((row, index) => (
          <View
            key={row.key}
            style={[styles.statRow, index > 0 && settingsStyles.rowBorder]}
            testID={`nmem-stat-${row.key}`}
          >
            <Text style={styles.statLabel}>{row.label}</Text>
            <Text selectable style={styles.statValue}>
              {String(stats[row.key])}
            </Text>
          </View>
        ))}
      </ResultCard>
    </View>
  );
}

function ErrorNotice({ text }: { text: string }) {
  const { t } = useTranslation();
  const description = useMemo(
    () => (
      <Text selectable style={styles.errorText}>
        {text}
      </Text>
    ),
    [text],
  );
  return (
    <Alert
      variant="error"
      size="sm"
      title={t("toolCallDetails.error")}
      description={description}
      testID="nmem-error"
    />
  );
}

interface SharedOutputProps {
  output: string | null;
  onOpenFullOutput?: () => void;
}

/** Restored codemode calls only have the whole script's output, which is not this call's result. */
function SharedOutput({ output, onOpenFullOutput }: SharedOutputProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.section} testID="nmem-shared-output">
      <Alert
        variant="info"
        size="sm"
        title={t("nmem.sharedOutput")}
        description={t("nmem.sharedOutputHint")}
      >
        {onOpenFullOutput ? (
          <Button
            variant="outline"
            size="sm"
            onPress={onOpenFullOutput}
            testID="nmem-open-full-output"
          >
            {t("nmem.openFullOutput")}
          </Button>
        ) : null}
      </Alert>
      {output ? (
        <ScrollableCodeSurface horizontal={false} textStyle={styles.wrappedCode}>
          {output}
        </ScrollableCodeSurface>
      ) : null}
    </View>
  );
}

interface RawSectionProps {
  command: string;
  output: string | undefined;
  defaultExpanded: boolean;
}

function RawSection({ command, output, defaultExpanded }: RawSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const formattedOutput = useMemo(
    () => (expanded && output?.trim() ? formatNmemOutput(output) : null),
    [expanded, output],
  );
  return (
    <View style={styles.section} testID="nmem-raw-section">
      <DisclosureButton
        label={t("nmem.rawData")}
        expanded={expanded}
        onToggle={toggle}
        testID="nmem-raw-toggle"
      />
      {expanded ? (
        <View style={styles.section}>
          <Text style={styles.rawLabel}>{t("nmem.command")}</Text>
          <ScrollableCodeSurface
            horizontal={false}
            textStyle={styles.wrappedCode}
            testID="nmem-command"
          >
            {command}
          </ScrollableCodeSurface>
          {formattedOutput ? (
            <>
              <Text style={styles.rawLabel}>{t("nmem.returnedData")}</Text>
              <ScrollableCodeSurface
                horizontal={false}
                textStyle={styles.wrappedCode}
                testID="nmem-raw-output"
              >
                {formattedOutput}
              </ScrollableCodeSurface>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[6],
    paddingVertical: theme.spacing[4],
  },
  view: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  statLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  statValue: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  rawLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  wrappedCode: {
    lineHeight: 18,
    ...(isWeb ? { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const } : null),
  },
}));
