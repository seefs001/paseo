import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { useHosts } from "@/runtime/host-runtime";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Archive, Square, Unlink } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useProviderIcon } from "@/components/provider-icons";
import { ComposerTrackActions, ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton, paneContentToolbarIconSize } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { Theme } from "@/styles/theme";
import { useAgentFactsLine } from "@/panels/agent-facts-line";
import { getPanelManifest } from "@/panels/panel-manifest";
import { useSheetPanePage } from "@/screens/workspace/sheet-pane";
import type { SheetTab } from "@/stores/workspace-layout-store";
import type { SubagentRow } from "./select";
import type { ArchiveFinishedStatus } from "./use-archive-finished";
import { countStoppableSubagents } from "./stop-subagents";
import { useStopAllSubagents, useStopSubagent, type StopAllStatus } from "./use-stop-subagents";
import {
  buildSubagentPillPresentation,
  buildSubagentRowPresentationData,
  countFinishedSubagents,
} from "./track-presentation";

const ThemedArchive = withUnistyles(Archive);
const ThemedSquare = withUnistyles(Square);
const ThemedUnlink = withUnistyles(Unlink);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const stopIconProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  fill: theme.colors.foregroundMuted,
});
const stopIconActiveProps = (theme: Theme) => ({
  color: theme.colors.foreground,
  fill: theme.colors.foreground,
});

export interface SubagentsTrackProps {
  serverId: string;
  rows: SubagentRow[];
  onOpenSubagent: (address: AgentAddress) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  /**
   * The sheet a row opens, or null when it opens as a tab. A sheet replaces the list in place and
   * Back returns to it; a tab replaces the list's pane, so choosing it ends the list.
   */
  sheetTabFor: (row: SubagentRow) => SheetTab | null;
  onArchiveSubagent: (address: AgentAddress) => void;
  onArchiveFinished?: () => void;
  archiveFinishedStatus?: ArchiveFinishedStatus;
  onDetachSubagent?: (address: AgentAddress) => void;
}

const IDLE_ARCHIVE_FINISHED_STATUS: ArchiveFinishedStatus = { kind: "idle" };

const ROW_ICON_SIZE = 14;

function useRowPresentation(row: SubagentRow, serverId: string): WorkspaceTabPresentation {
  const icon = useProviderIcon(row.provider, serverId);
  const data = buildSubagentRowPresentationData(row);
  return {
    ...data,
    tooltip: data.label,
    modified: false,
    showCloseButton: getPanelManifest(data.kind).showCloseButton,
    icon,
  };
}

export function SubagentsTrack({
  serverId,
  rows,
  onOpenSubagent,
  onOpenProviderSubagent,
  sheetTabFor,
  onArchiveSubagent,
  onArchiveFinished,
  archiveFinishedStatus = IDLE_ARCHIVE_FINISHED_STATUS,
  onDetachSubagent,
}: SubagentsTrackProps): ReactElement | null {
  const { t } = useTranslation();
  const stopAll = useStopAllSubagents(rows);
  const stopSubagent = useStopSubagent();
  const stopAllSubagents = stopAll.stopAll;
  const handleStopAll = useCallback(() => {
    void stopAllSubagents();
  }, [stopAllSubagents]);
  const sheetPanePage = useSheetPanePage();

  const isArchivingFinished = archiveFinishedStatus.kind === "archiving";
  const isArchiveFinishedFailed = archiveFinishedStatus.kind === "failed";
  const isStoppingAll = stopAll.status.kind === "stopping";
  const isStopAllFailed = stopAll.status.kind === "failed";
  if (
    rows.length === 0 &&
    !isArchivingFinished &&
    !isArchiveFinishedFailed &&
    !isStoppingAll &&
    !isStopAllFailed
  ) {
    return null;
  }

  const pill = buildSubagentPillPresentation(t, rows);
  const finishedCount = countFinishedSubagents(rows);
  const showArchiveFinished = finishedCount > 0 || isArchivingFinished || isArchiveFinishedFailed;
  const showStopAll = countStoppableSubagents(rows) > 0 || isStoppingAll || isStopAllFailed;
  const showBulkActions = showStopAll || showArchiveFinished;
  const sheets = rows.map(sheetTabFor);
  const pages = sheets.flatMap((sheet) => (sheet ? [sheetPanePage(sheet)] : []));

  return (
    <ComposerTrackPill
      pages={pages}
      testID="subagents-track-header"
      segments={pill.segments}
      accessibilityLabel={pill.accessibilityLabel}
      panelTitle={t("subagents.title")}
    >
      {showBulkActions ? (
        <ComposerTrackActions divided={rows.length > 0}>
          {showStopAll ? (
            <StopAllRow status={stopAll.status} disabled={isStoppingAll} onPress={handleStopAll} />
          ) : null}
          {showArchiveFinished && onArchiveFinished ? (
            <ArchiveFinishedRow
              status={archiveFinishedStatus}
              disabled={isArchivingFinished}
              onPress={onArchiveFinished}
            />
          ) : null}
        </ComposerTrackActions>
      ) : null}
      {rows.map((row, index) => (
        <SubagentsTrackRow
          key={row.kind === "paseo" ? `${row.address.serverId}:${row.id}` : row.id}
          row={row}
          serverId={serverId}
          onOpenSubagent={onOpenSubagent}
          onOpenProviderSubagent={onOpenProviderSubagent}
          sheetTabId={sheets[index]?.tab.tabId ?? null}
          onArchiveSubagent={onArchiveSubagent}
          onDetachSubagent={onDetachSubagent}
          onStopSubagent={stopSubagent}
        />
      ))}
    </ComposerTrackPill>
  );
}

/**
 * Bulk archive, as a row above the list rather than an icon next to the count. The pill has no
 * header to hang an icon off, and a destructive-ish action reads better with its name attached.
 */
function ArchiveFinishedRow({
  status,
  disabled,
  onPress,
}: {
  status: ArchiveFinishedStatus;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const { t } = useTranslation();

  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <ThemedArchive
          size={ROW_ICON_SIZE}
          uniProps={active ? foregroundColorMapping : foregroundMutedColorMapping}
        />
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t("subagents.archiveFinishedAction")}
        </Text>
        {status.kind === "archiving" ? (
          <Text style={styles.rowTrailing} testID="subagents-track-archive-progress">
            {status.completedCount}/{status.totalCount}
          </Text>
        ) : null}
        {status.kind === "failed" ? (
          <Text style={styles.rowTrailing} testID="subagents-track-archive-failed">
            {t("subagents.archiveFinishedRetry", {
              failed: status.failedCount,
              total: status.totalCount,
            })}
          </Text>
        ) : null}
      </>
    ),
    [status, t],
  );

  return (
    <ComposerTrackRow
      accessibilityLabel={t("subagents.archiveFinishedAction")}
      testID="subagents-track-archive-finished"
      disabled={disabled}
      // Progress and the retry count land on this row, so the panel is where the result of
      // pressing it shows up. Dismissing would hide the thing the press produces.
      closeOnSelect={false}
      onPress={onPress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

/** Same interrupt as the composer stop, for every running Paseo subagent in this panel. */
function StopAllRow({
  status,
  disabled,
  onPress,
}: {
  status: StopAllStatus;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const { t } = useTranslation();

  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <ThemedSquare
          size={ROW_ICON_SIZE}
          uniProps={active ? stopIconActiveProps : stopIconProps}
        />
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t("subagents.stopAllAction")}
        </Text>
        {status.kind === "stopping" ? (
          <Text style={styles.rowTrailing} testID="subagents-track-stop-progress">
            {status.completedCount}/{status.totalCount}
          </Text>
        ) : null}
        {status.kind === "failed" ? (
          <Text style={styles.rowTrailing} testID="subagents-track-stop-failed">
            {t("subagents.stopAllRetry", {
              failed: status.failedCount,
              total: status.totalCount,
            })}
          </Text>
        ) : null}
      </>
    ),
    [status, t],
  );

  return (
    <ComposerTrackRow
      accessibilityLabel={t("subagents.stopAllAction")}
      testID="subagents-track-stop-all"
      disabled={disabled}
      closeOnSelect={false}
      onPress={onPress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

interface SubagentsTrackRowProps {
  serverId: string;
  row: SubagentRow;
  onOpenSubagent: (address: AgentAddress) => void;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
  /** The sheet page the row opens in place of the list, when it opens in a sheet. */
  sheetTabId: string | null;
  onArchiveSubagent: (address: AgentAddress) => void;
  onDetachSubagent?: (address: AgentAddress) => void;
  onStopSubagent: (address: AgentAddress) => void;
}

function SubagentsTrackRow({
  serverId,
  row,
  onOpenSubagent,
  onOpenProviderSubagent,
  sheetTabId,
  onArchiveSubagent,
  onDetachSubagent,
  onStopSubagent,
}: SubagentsTrackRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const rowServerId = row.kind === "paseo" ? row.address.serverId : serverId;
  const hostLabel = useHosts().find((host) => host.serverId === rowServerId)?.label ?? rowServerId;
  const presentation = useRowPresentation(row, rowServerId);
  const displayLabel =
    presentation.titleState === "loading" ? t("common.states.loading") : presentation.label;
  const handlePress = useCallback(() => {
    if (row.kind === "provider") {
      onOpenProviderSubagent(row.parentAgentId, row.id);
    } else {
      onOpenSubagent(row.address);
    }
  }, [onOpenProviderSubagent, onOpenSubagent, row]);
  const handleArchivePress = useCallback(() => {
    if (row.kind === "paseo") onArchiveSubagent(row.address);
  }, [onArchiveSubagent, row]);
  const handleDetachPress = useCallback(() => {
    if (row.kind === "paseo") onDetachSubagent?.(row.address);
  }, [onDetachSubagent, row]);
  const handleStopPress = useCallback(() => {
    if (row.kind === "paseo") onStopSubagent(row.address);
  }, [onStopSubagent, row]);
  const canStop = row.kind === "paseo" && row.turn.phase === "open";
  const stopDisabled = canStop && row.turn.cancellationRequestId !== null;
  const actionsAlwaysVisible = isNative || isCompact;

  const renderRow = useCallback(
    ({ active }: { active: boolean }) => (
      <>
        <WorkspaceTabIcon presentation={presentation} backdrop={active ? "surface2" : "surface1"} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {displayLabel}
          </Text>
          {row.kind === "paseo" ? (
            <>
              <SubagentFacts rowId={row.id} text={rowServerId !== serverId ? hostLabel : ""} />
              <PaseoSubagentFacts serverId={rowServerId} agentId={row.id} />
            </>
          ) : (
            <SubagentFacts rowId={row.id} text={presentation.subtitle} />
          )}
        </View>
        {row.kind === "paseo" ? (
          <SubagentRowActions
            rowId={row.id}
            displayLabel={displayLabel}
            compact={isCompact}
            visible={actionsAlwaysVisible || active}
            onStopPress={canStop ? handleStopPress : undefined}
            stopDisabled={stopDisabled}
            onDetachPress={onDetachSubagent ? handleDetachPress : undefined}
            onArchivePress={handleArchivePress}
          />
        ) : null}
      </>
    ),
    [
      actionsAlwaysVisible,
      canStop,
      displayLabel,
      handleArchivePress,
      handleDetachPress,
      handleStopPress,
      isCompact,
      onDetachSubagent,
      presentation,
      row.kind,
      row.id,
      serverId,
      rowServerId,
      hostLabel,
      stopDisabled,
    ],
  );

  return (
    <ComposerTrackRow
      accessibilityLabel={displayLabel}
      testID={`subagents-track-row-${row.id}`}
      opensPage={sheetTabId ?? undefined}
      onPress={handlePress}
    >
      {renderRow}
    </ComposerTrackRow>
  );
}

/** The same facts line the agent's sheet shows when it opens without its composer. */
function PaseoSubagentFacts({ serverId, agentId }: { serverId: string; agentId: string }) {
  const text = useAgentFactsLine(serverId, agentId);
  return <SubagentFacts rowId={agentId} text={text} />;
}

function SubagentFacts({ rowId, text }: { rowId: string; text: string | null }) {
  if (!text) return null;
  return (
    <Text style={styles.rowFacts} numberOfLines={1} testID={`subagents-track-row-facts-${rowId}`}>
      {text}
    </Text>
  );
}

function SubagentRowActions({
  rowId,
  displayLabel,
  compact,
  visible,
  onStopPress,
  stopDisabled = false,
  onDetachPress,
  onArchivePress,
}: {
  rowId: string;
  displayLabel: string;
  compact: boolean;
  visible: boolean;
  onStopPress?: () => void;
  stopDisabled?: boolean;
  onDetachPress?: () => void;
  onArchivePress: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const iconSize = paneContentToolbarIconSize(compact);
  return (
    <View
      style={visible ? styles.actionClusterVisible : styles.actionClusterHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      {onStopPress ? (
        <SubagentActionButton
          label={t("subagents.stopAction", { label: displayLabel })}
          tooltipLabel={t("subagents.stopTooltip")}
          compact={compact}
          disabled={stopDisabled}
          onPress={onStopPress}
          testID={`subagents-track-stop-${rowId}`}
        >
          <ThemedSquare size={iconSize} uniProps={stopIconProps} />
        </SubagentActionButton>
      ) : null}
      {onDetachPress ? (
        <SubagentActionButton
          label={t("subagents.detachAction", { label: displayLabel })}
          tooltipLabel={t("subagents.detachTooltip")}
          compact={compact}
          onPress={onDetachPress}
          testID={`subagents-track-detach-${rowId}`}
        >
          <ThemedUnlink size={iconSize} uniProps={mutedIconColorMapping} />
        </SubagentActionButton>
      ) : null}
      <SubagentActionButton
        label={t("subagents.archiveAction", { label: displayLabel })}
        tooltipLabel={t("subagents.archiveTooltip")}
        compact={compact}
        onPress={onArchivePress}
        testID={`subagents-track-archive-${rowId}`}
      >
        <ThemedArchive size={iconSize} uniProps={mutedIconColorMapping} />
      </SubagentActionButton>
    </View>
  );
}

/** The standard icon action, with a tooltip that names the action without repeating the row. */
function SubagentActionButton({
  label,
  tooltipLabel,
  compact,
  disabled = false,
  onPress,
  testID,
  children,
}: {
  label: string;
  tooltipLabel: string;
  compact: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}): ReactElement {
  const tooltip = useMemo(
    () => <Text style={styles.tooltipText}>{tooltipLabel}</Text>,
    [tooltipLabel],
  );
  return (
    <ToolbarButton
      label={label}
      tooltip={tooltip}
      tooltipSide="top"
      compact={compact}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      {children}
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  // `flexBasis: "auto"` rather than `flex: 1`: a zero-basis label contributes nothing to the row's
  // intrinsic width, so the panel measures itself at its floor and truncates every label at once.
  rowLabel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  // Title over facts. The facts sit under the title rather than beside it, so a long task name
  // keeps the row's full width and neither line truncates the other.
  rowText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
  },
  rowTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowFacts: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  // Progress on the archive row. It shrinks twice as fast as the label, so a long retry count
  // gives way first instead of squeezing the thing that names the row.
  rowTrailing: {
    flexShrink: 2,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  actionClusterVisible: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 1,
  },
  actionClusterHidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    opacity: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
