import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";
import { Bot, ChevronRight, Plug, RefreshCw, SlidersHorizontal, Tag } from "lucide-react-native";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { McpCallRecord } from "@getpaseo/protocol/messages";
import { CONFIGURABLE_PASEO_AGENT_TOOLS } from "@getpaseo/protocol/paseo-agent-tools";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MenuHeader } from "@/components/headers/menu-header";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID, type HostPickerHost } from "@/components/hosts/host-picker";
import { useProviderIcon } from "@/components/provider-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { foregroundIconColorMapping, mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useFetchQueries } from "@/data/query";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useHostFeatureAvailabilityMap } from "@/runtime/host-features";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHostRuntimeIsConnected,
  useHosts,
} from "@/runtime/host-runtime";
import { deriveIdentityColorName } from "@/styles/identity-colors";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { WorkspaceLabelChip } from "@/workspace-labels/chip";

type McpCallView = "tools" | "all";
type McpCallStatus = "all" | "failed" | "succeeded";

interface ListedMcpCall extends McpCallRecord {
  serverId: string;
  hostLabel: string;
}

interface McpCallEntry {
  call: ListedMcpCall;
  callerTitle: string;
  callerProvider: string | null;
  /** Lowercased text the search box matches against. */
  searchText: string;
}

interface CallerAgent {
  title: string | null;
  provider: string;
}

interface LabelOption {
  label: string;
  count: number;
}

type HoverState = PressableStateCallbackType & { hovered?: boolean };

/** The daemon keeps this many calls in memory, so asking for more returns nothing extra. */
const CALL_LIMIT = 200;
const POLL_INTERVAL_MS = 5000;
const SHORT_AGENT_ID_LENGTH = 7;
const ARGUMENTS_PREVIEW_LIMIT = 240;
const EMPTY_CALLS: McpCallRecord[] = [];

const ThemedChevron = withUnistyles(ChevronRight);
const ThemedPlug = withUnistyles(Plug);
const ThemedBot = withUnistyles(Bot);
const ThemedTag = withUnistyles(Tag);

const externalCallerGlyph = <ThemedPlug size={ICON_SIZE.xs} uniProps={mutedIconColorMapping} />;
const unknownAgentGlyph = <ThemedBot size={ICON_SIZE.xs} uniProps={mutedIconColorMapping} />;
const labelFilterLeading = <ThemedTag size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />;

export function McpCallsScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) return <View style={styles.container} />;
  return <McpCallsScreenContent />;
}

function McpCallsScreenContent(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const logAvailability = useHostFeatureAvailabilityMap(serverIds, "mcpCallLog");
  const allowlistAvailability = useHostFeatureAvailabilityMap(serverIds, "mcpToolAllowlist");
  const queries = useFetchQueries<McpCallRecord[]>(
    hosts.map((host) => ({
      queryKey: ["mcp-calls", host.serverId],
      enabled:
        logAvailability.get(host.serverId) === true &&
        connectionStatuses.get(host.serverId) === "online",
      dataShape: "value",
      staleTimeMs: 0,
      refetchInterval: POLL_INTERVAL_MS,
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client) throw new Error(t("common.errors.daemonClientDisconnected"));
        return client.listMcpCalls(CALL_LIMIT);
      },
    })),
  );
  const calls = useMemo(() => {
    const merged: ListedMcpCall[] = [];
    for (const [index, host] of hosts.entries()) {
      for (const call of queries[index].data ?? EMPTY_CALLS) {
        merged.push({ ...call, serverId: host.serverId, hostLabel: host.label });
      }
    }
    return merged.sort((left, right) => right.at.localeCompare(left.at));
  }, [hosts, queries]);

  const { agents } = useAggregatedAgents({ includeArchived: true });
  const agentsByKey = useMemo(() => {
    const map = new Map<string, CallerAgent>();
    for (const agent of agents) {
      map.set(`${agent.serverId}:${agent.id}`, { title: agent.title, provider: agent.provider });
    }
    return map;
  }, [agents]);

  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [view, setView] = useState<McpCallView>("tools");
  const [status, setStatus] = useState<McpCallStatus>("all");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [isMethodsOpen, setIsMethodsOpen] = useState(false);
  const hostFilter = hosts.some((host) => host.serverId === selectedHost)
    ? selectedHost
    : ALL_HOSTS_OPTION_ID;
  const scopedHosts = hosts.filter(
    (host) => hostFilter === ALL_HOSTS_OPTION_ID || host.serverId === hostFilter,
  );
  const configurableHosts = scopedHosts.filter(
    (host) => allowlistAvailability.get(host.serverId) === true,
  );
  const activeQueries = queries.filter(
    (_query, index) =>
      (hostFilter === ALL_HOSTS_OPTION_ID || hosts[index].serverId === hostFilter) &&
      logAvailability.get(hosts[index].serverId) === true &&
      connectionStatuses.get(hosts[index].serverId) === "online",
  );
  const issues = scopedHosts.flatMap((host) => {
    if (connectionStatuses.get(host.serverId) !== "online") {
      return [t("settings.host.mcpCalls.hostOffline", { host: host.label })];
    }
    if (logAvailability.get(host.serverId) === false) {
      return [t("settings.host.mcpCalls.hostUnsupported", { host: host.label })];
    }
    const query = queries[hosts.indexOf(host)];
    if (query.isError) {
      return [t("settings.host.mcpCalls.hostLoadFailed", { host: host.label })];
    }
    return [];
  });
  const waitingForFeatures = scopedHosts.some(
    (host) =>
      connectionStatuses.get(host.serverId) === "online" &&
      logAvailability.get(host.serverId) == null,
  );
  const waiting = waitingForFeatures || activeQueries.some((query) => query.isPending);
  const refreshing = activeQueries.some((query) => query.isFetching);
  const refresh = useCallback(() => {
    for (const query of activeQueries) void query.refetch();
  }, [activeQueries]);

  const entries = useMemo<McpCallEntry[]>(
    () =>
      calls.map((call) => {
        const agent = call.callerAgentId
          ? agentsByKey.get(`${call.serverId}:${call.callerAgentId}`)
          : undefined;
        let callerTitle = t("settings.host.mcpCalls.external");
        if (call.callerAgentId) {
          callerTitle =
            agent?.title?.trim() ||
            t("settings.host.mcpCalls.unknownAgent", {
              id: call.callerAgentId.slice(0, SHORT_AGENT_ID_LENGTH),
            });
        }
        const searchText = [
          call.id,
          call.tool,
          call.method,
          callerTitle,
          call.callerAgentId,
          call.hostLabel,
          call.error,
          call.arguments,
          ...(call.labels ?? []),
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        return { call, callerTitle, callerProvider: agent?.provider ?? null, searchText };
      }),
    [agentsByKey, calls, t],
  );
  const hostEntries = useMemo(
    () =>
      entries.filter(
        ({ call }) => hostFilter === ALL_HOSTS_OPTION_ID || call.serverId === hostFilter,
      ),
    [entries, hostFilter],
  );
  const matchingEntries = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return hostEntries.filter(({ call, searchText }) => {
      if (view === "tools" && call.method !== "tools/call") return false;
      if (status === "failed" && call.ok) return false;
      if (status === "succeeded" && !call.ok) return false;
      return tokens.every((token) => searchText.includes(token));
    });
  }, [hostEntries, search, status, view]);
  const labelOptions = useMemo<LabelOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { call } of matchingEntries) {
      for (const label of call.labels ?? []) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }, [matchingEntries]);
  const visibleEntries = useMemo(
    () =>
      matchingEntries.filter(
        ({ call }) => selectedLabel === null || call.labels?.includes(selectedLabel),
      ),
    [matchingEntries, selectedLabel],
  );
  const failedCount = visibleEntries.filter(({ call }) => !call.ok).length;

  const clearFilters = useCallback(() => {
    setSearch("");
    setSearchResetKey((key) => key + 1);
    setSelectedLabel(null);
    setSelectedHost(ALL_HOSTS_OPTION_ID);
    setView("tools");
    setStatus("all");
  }, []);
  const openMethods = useCallback(() => setIsMethodsOpen(true), []);
  const closeMethods = useCallback(() => setIsMethodsOpen(false), []);

  let body: ReactElement;
  if (hosts.length === 0) {
    body = <CenteredMessage text={t("settings.host.mcpCalls.noHosts")} />;
  } else if (hostEntries.length === 0 && waiting) {
    body = (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else if (hostEntries.length === 0 && issues.length > 0) {
    body = <CenteredMessage text={t("settings.host.mcpCalls.loadFailed")} />;
  } else if (hostEntries.length === 0) {
    body = (
      <CenteredMessage
        text={t("settings.host.mcpCalls.empty")}
        hint={t("settings.host.mcpCalls.labelsHint")}
      />
    );
  } else if (visibleEntries.length === 0) {
    body = (
      <View style={styles.centered} testID="mcp-calls-no-matches">
        <Text style={styles.message}>{t("settings.host.mcpCalls.noMatches")}</Text>
        <Button variant="ghost" onPress={clearFilters} testID="mcp-calls-clear-filters">
          {t("settings.host.mcpCalls.clearFilters")}
        </Button>
      </View>
    );
  } else {
    body = <McpCallList entries={visibleEntries} showHost={scopedHosts.length > 1} />;
  }

  return (
    <View style={styles.container} testID="mcp-calls-screen">
      <MenuHeader title={t("sidebar.sections.mcpCalls")} />
      {hosts.length > 0 ? (
        <View style={styles.rail}>
          <Text style={styles.footnote}>
            {t("settings.host.mcpCalls.hint", { limit: CALL_LIMIT })}
          </Text>
          <McpCallsFilterRail
            hosts={hosts}
            selectedHost={hostFilter}
            onSelectHost={setSelectedHost}
            view={view}
            onViewChange={setView}
            status={status}
            onStatusChange={setStatus}
            labelOptions={labelOptions}
            selectedLabel={selectedLabel}
            onSelectLabel={setSelectedLabel}
            search={search}
            searchResetKey={searchResetKey}
            onSearchChange={setSearch}
            canConfigureMethods={configurableHosts.length > 0}
            onOpenMethods={openMethods}
          />
          <View style={styles.railRow}>
            <Text style={styles.summary} testID="mcp-calls-summary">
              {t("settings.host.mcpCalls.summary", {
                visible: visibleEntries.length,
                total: hostEntries.length,
                failed: failedCount,
              })}
            </Text>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={RefreshCw}
              onPress={refresh}
              disabled={refreshing || activeQueries.length === 0}
              testID="mcp-calls-refresh"
            >
              {t("settings.host.mcpCalls.refresh")}
            </Button>
          </View>
          {issues.length > 0 ? (
            <Alert
              variant="warning"
              size="sm"
              title={t("settings.host.mcpCalls.incomplete")}
              description={issues.join("\n")}
              testID="mcp-calls-incomplete"
            />
          ) : null}
        </View>
      ) : null}
      {body}
      <McpMethodsSheet visible={isMethodsOpen} onClose={closeMethods} hosts={configurableHosts} />
    </View>
  );
}

function CenteredMessage({ text, hint }: { text: string; hint?: string }): ReactElement {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
      {hint ? <Text style={styles.centeredHint}>{hint}</Text> : null}
    </View>
  );
}

interface McpCallsFilterRailProps {
  hosts: HostPickerHost[];
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  view: McpCallView;
  onViewChange: (view: McpCallView) => void;
  status: McpCallStatus;
  onStatusChange: (status: McpCallStatus) => void;
  labelOptions: LabelOption[];
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  search: string;
  /** Bumped to empty the search box from outside, since the field only reads its first value. */
  searchResetKey: number;
  onSearchChange: (value: string) => void;
  canConfigureMethods: boolean;
  onOpenMethods: () => void;
}

function McpCallsFilterRail({
  hosts,
  selectedHost,
  onSelectHost,
  view,
  onViewChange,
  status,
  onStatusChange,
  labelOptions,
  selectedLabel,
  onSelectLabel,
  search,
  searchResetKey,
  onSearchChange,
  canConfigureMethods,
  onOpenMethods,
}: McpCallsFilterRailProps): ReactElement {
  const { t } = useTranslation();
  const viewOptions = useMemo<SegmentedControlOption<McpCallView>[]>(
    () => [
      {
        value: "tools",
        label: t("settings.host.mcpCalls.viewTools"),
        testID: "mcp-calls-view-tools",
      },
      { value: "all", label: t("settings.host.mcpCalls.viewAll"), testID: "mcp-calls-view-all" },
    ],
    [t],
  );
  const showLabelFilter = labelOptions.length > 0 || selectedLabel !== null;

  return (
    <View style={styles.filters}>
      <View style={styles.railRow}>
        <SearchField
          key={searchResetKey}
          value={search}
          onChangeText={onSearchChange}
          placeholder={t("settings.host.mcpCalls.searchPlaceholder")}
          clearAccessibilityLabel={t("settings.host.mcpCalls.clearSearch")}
          testID="mcp-calls-search"
          clearTestID="mcp-calls-search-clear"
        />
        {hosts.length > 1 ? (
          <HostFilter
            hosts={hosts}
            selectedHost={selectedHost}
            onSelectHost={onSelectHost}
            triggerTestID="mcp-calls-host-filter"
          />
        ) : null}
      </View>
      <View style={styles.railRow}>
        <View style={styles.railControls}>
          <SegmentedControl
            size="sm"
            value={view}
            onValueChange={onViewChange}
            options={viewOptions}
            testID="mcp-calls-view"
          />
          <CallStatusFilter status={status} onSelect={onStatusChange} />
          {showLabelFilter ? (
            <LabelFilter options={labelOptions} selected={selectedLabel} onSelect={onSelectLabel} />
          ) : null}
        </View>
        {canConfigureMethods ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={SlidersHorizontal}
            onPress={onOpenMethods}
            testID="mcp-calls-allowed-methods"
          >
            {t("settings.host.mcpCalls.allowedTitle")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function CallStatusFilter({
  status,
  onSelect,
}: {
  status: McpCallStatus;
  onSelect: (status: McpCallStatus) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selectAll = useCallback(() => onSelect("all"), [onSelect]);
  const selectFailed = useCallback(() => onSelect("failed"), [onSelect]);
  const selectSucceeded = useCallback(() => onSelect("succeeded"), [onSelect]);
  const labels: Record<McpCallStatus, string> = {
    all: t("settings.host.mcpCalls.allStatuses"),
    failed: t("settings.host.mcpCalls.failed"),
    succeeded: t("settings.host.mcpCalls.succeeded"),
  };

  return (
    <DropdownMenu>
      <DropdownTrigger
        size="sm"
        accessibilityLabel={t("settings.host.mcpCalls.statusFilter")}
        testID="mcp-calls-status-filter"
      >
        {labels[status]}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="start">
        <DropdownMenuItem selected={status === "all"} showSelectedCheck onSelect={selectAll}>
          {labels.all}
        </DropdownMenuItem>
        <DropdownMenuItem
          selected={status === "failed"}
          showSelectedCheck
          onSelect={selectFailed}
          testID="mcp-calls-view-failed"
        >
          {labels.failed}
        </DropdownMenuItem>
        <DropdownMenuItem
          selected={status === "succeeded"}
          showSelectedCheck
          onSelect={selectSucceeded}
          testID="mcp-calls-view-succeeded"
        >
          {labels.succeeded}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelFilter({
  options,
  selected,
  onSelect,
}: {
  options: LabelOption[];
  selected: string | null;
  onSelect: (label: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selectAll = useCallback(() => onSelect(null), [onSelect]);
  return (
    <DropdownMenu>
      <DropdownTrigger
        size="sm"
        leading={labelFilterLeading}
        accessibilityLabel={t("settings.host.mcpCalls.labelFilter")}
        testID="mcp-calls-label-filter"
      >
        {selected ?? t("settings.host.mcpCalls.allLabels")}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="start" width={280}>
        <DropdownMenuItem selected={selected === null} showSelectedCheck onSelect={selectAll}>
          {t("settings.host.mcpCalls.allLabels")}
        </DropdownMenuItem>
        {options.map((option) => (
          <LabelFilterItem
            key={option.label}
            option={option}
            selected={option.label === selected}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelFilterItem({
  option,
  selected,
  onSelect,
}: {
  option: LabelOption;
  selected: boolean;
  onSelect: (label: string) => void;
}): ReactElement {
  const select = useCallback(() => onSelect(option.label), [onSelect, option.label]);
  const count = useMemo(() => <Text style={styles.menuCount}>{option.count}</Text>, [option.count]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      trailing={count}
      onSelect={select}
      testID={`mcp-calls-label-${option.label}`}
    >
      {option.label}
    </DropdownMenuItem>
  );
}

function McpCallList({
  entries,
  showHost,
}: {
  entries: McpCallEntry[];
  showHost: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      testID="mcp-calls-list"
    >
      <View style={settingsStyles.card}>
        {entries.map((entry, index) => (
          <McpCallRow
            key={`${entry.call.serverId}:${entry.call.id}`}
            call={entry.call}
            callerTitle={entry.callerTitle}
            callerProvider={entry.callerProvider}
            showHost={showHost}
            isFirst={index === 0}
          />
        ))}
      </View>
      <Text style={styles.footnote}>{t("settings.host.mcpCalls.labelsHint")}</Text>
    </ScrollView>
  );
}

interface McpCallRowProps {
  call: ListedMcpCall;
  callerTitle: string;
  callerProvider: string | null;
  showHost: boolean;
  isFirst: boolean;
}

/**
 * One call: what ran and how it went on the first line, who asked on the second, the input below.
 * Pressing the row opens the full input, the exact time and the caller's agent ID.
 */
const McpCallRow = memo(function McpCallRow({
  call,
  callerTitle,
  callerProvider,
  showHost,
  isFirst,
}: McpCallRowProps): ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      styles.row,
      !isFirst && settingsStyles.rowBorder,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );
  const labels = useMemo<WorkspaceLabelDefinition[]>(
    () =>
      (call.labels ?? []).map((label) => ({ name: label, color: deriveIdentityColorName(label) })),
    [call.labels],
  );
  const toolName = call.method === "tools/call" ? call.tool : null;
  const name = toolName ?? call.method;
  const caller = showHost ? `${callerTitle} · ${call.hostLabel}` : callerTitle;

  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={accessibilityState}
      onPress={toggle}
      style={rowStyle}
      highlightStyle={styles.rowPressed}
      testID={`mcp-call-${call.id}`}
    >
      {({ hovered }: HoverState) => (
        <>
          <View style={styles.rowHeading}>
            <Text style={toolName ? styles.name : styles.protocolName} numberOfLines={1}>
              {name}
            </Text>
            {call.ok ? null : (
              <StatusBadge size="xs" variant="error" label={t("settings.host.mcpCalls.failed")} />
            )}
            <CallTiming at={call.at} durationMs={call.durationMs} />
            <View style={isOpen ? styles.chevronOpen : styles.chevron}>
              <ThemedChevron
                size={ICON_SIZE.sm}
                uniProps={hovered ? foregroundIconColorMapping : mutedIconColorMapping}
              />
            </View>
          </View>
          <View style={styles.metaLine}>
            <CallerGlyph call={call} provider={callerProvider} />
            <Text style={styles.meta} numberOfLines={1}>
              {caller}
            </Text>
            {labels.map((label) => (
              <WorkspaceLabelChip key={label.name} label={label} />
            ))}
          </View>
          {call.error ? (
            <Text selectable={isOpen} style={styles.error} numberOfLines={isOpen ? undefined : 1}>
              {call.error}
            </Text>
          ) : null}
          {isOpen ? (
            <CallDetails call={call} />
          ) : (
            <ArgumentsPreview text={call.arguments ?? null} />
          )}
        </>
      )}
    </PressHighlight>
  );
});

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function CallTiming({ at, durationMs }: { at: string; durationMs: number }): ReactElement {
  const date = useMemo(() => {
    const parsed = new Date(at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [at]);
  const ago = useCompactTimeAgo(date);
  const timing = ago ? `${formatDuration(durationMs)} · ${ago}` : formatDuration(durationMs);
  return (
    <Text style={styles.timing} numberOfLines={1}>
      {timing}
    </Text>
  );
}

function CallerGlyph({
  call,
  provider,
}: {
  call: ListedMcpCall;
  provider: string | null;
}): ReactElement {
  if (!call.callerAgentId) return externalCallerGlyph;
  if (!provider) return unknownAgentGlyph;
  return <ProviderGlyph provider={provider} serverId={call.serverId} />;
}

function ProviderGlyph({ provider, serverId }: { provider: string; serverId: string }) {
  const Icon = useProviderIcon(provider, serverId);
  return <Icon size={ICON_SIZE.xs} color={styles.glyph.color} />;
}

function ArgumentsPreview({ text }: { text: string | null }): ReactElement | null {
  if (!text) return null;
  const preview = text.replace(/\s+/g, " ").slice(0, ARGUMENTS_PREVIEW_LIMIT);
  return (
    <Text style={styles.argumentsPreview} numberOfLines={1}>
      {preview}
    </Text>
  );
}

function CallDetails({ call }: { call: ListedMcpCall }): ReactElement {
  const { t } = useTranslation();
  const time = new Date(call.at);
  const timestamp = Number.isNaN(time.getTime()) ? call.at : time.toLocaleString();
  const facts = call.callerAgentId ? `${timestamp} · ${call.callerAgentId}` : timestamp;
  return (
    <View style={styles.details}>
      {call.arguments ? (
        <View style={styles.codeBlock} accessibilityLabel={t("settings.host.mcpCalls.arguments")}>
          <Text selectable style={styles.code}>
            {call.arguments}
          </Text>
        </View>
      ) : null}
      <Text selectable style={styles.detailFacts}>
        {facts}
      </Text>
      <Text selectable style={styles.detailFacts}>
        {call.hostLabel} · {call.method} · {call.id}
      </Text>
    </View>
  );
}

function McpMethodsSheet({
  visible,
  onClose,
  hosts,
}: {
  visible: boolean;
  onClose: () => void;
  hosts: HostPickerHost[];
}): ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.host.mcpCalls.allowedTitle"),
      search: {
        onChange: setQuery,
        placeholder: t("settings.host.mcpCalls.methodsSearch"),
        // The compact sheet stays mounted while hidden, so the field has to be told to empty.
        resetKey: visible ? "open" : "closed",
        testID: "mcp-methods-search",
      },
    }),
    [t, visible],
  );
  const methods = useMemo<readonly string[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return CONFIGURABLE_PASEO_AGENT_TOOLS;
    return CONFIGURABLE_PASEO_AGENT_TOOLS.filter((name) => name.includes(needle));
  }, [query]);
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={close}
      testID="mcp-methods-sheet"
    >
      <View style={styles.sheetBody}>
        <Text style={styles.sheetHint}>{t("settings.host.mcpCalls.allowedHint")}</Text>
        {methods.length === 0 ? (
          <Text style={styles.message}>{t("settings.host.mcpCalls.noMethods")}</Text>
        ) : (
          hosts.map((host) => (
            <McpMethodAllowlist
              key={host.serverId}
              serverId={host.serverId}
              hostLabel={host.label}
              showHost={hosts.length > 1}
              methods={methods}
            />
          ))
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

interface MethodAvailabilityChange {
  name: string;
  allowed: boolean;
}

function McpMethodAllowlist({
  serverId,
  hostLabel,
  showHost,
  methods,
}: {
  serverId: string;
  hostLabel: string;
  showHost: boolean;
  methods: readonly string[];
}): ReactElement {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const mutation = useMutation({
    mutationFn: async ({ name, allowed }: MethodAvailabilityChange) => {
      const disabled = new Set(config?.mcp.disabledTools ?? []);
      if (allowed) disabled.delete(name);
      else disabled.add(name);
      const result = await patchConfig({ mcp: { disabledTools: [...disabled] } });
      if (!result) throw new Error(t("common.errors.daemonClientDisconnected"));
      return result;
    },
  });
  const { mutate } = mutation;
  const toggle = useCallback(
    (name: string, allowed: boolean) => mutate({ name, allowed }),
    [mutate],
  );
  const switchesDisabled = !isConnected || mutation.isPending;
  const disabledTools = config?.mcp.disabledTools;
  let content: ReactElement;
  if (!isConnected) {
    content = <Text style={styles.error}>{t("workspace.terminal.hostDisconnected")}</Text>;
  } else if (!config && isLoading) {
    content = <Text style={styles.sheetHint}>{t("common.loading")}</Text>;
  } else if (!config) {
    content = <Text style={styles.error}>{t("common.errors.daemonUnavailable")}</Text>;
  } else {
    content = (
      <View style={settingsStyles.card} testID={`mcp-method-allowlist-${serverId}`}>
        {methods.map((name, index) => (
          <MethodSwitch
            key={name}
            name={name}
            allowed={!disabledTools?.includes(name)}
            disabled={switchesDisabled}
            isFirst={index === 0}
            onToggle={toggle}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.methodGroup}>
      {showHost ? <Text style={settingsStyles.sectionHeaderTitle}>{hostLabel}</Text> : null}
      {mutation.isPending ? (
        <Text style={styles.sheetHint}>{t("settings.host.mcpCalls.saving")}</Text>
      ) : null}
      {mutation.isError ? (
        <Alert
          variant="error"
          size="sm"
          title={t("common.errors.unableToSave")}
          description={mutation.error.message}
          testID={`mcp-method-save-error-${serverId}`}
        />
      ) : null}
      {content}
    </View>
  );
}

function MethodSwitch({
  name,
  allowed,
  disabled,
  isFirst,
  onToggle,
}: {
  name: string;
  allowed: boolean;
  disabled: boolean;
  isFirst: boolean;
  onToggle: (name: string, allowed: boolean) => void;
}): ReactElement {
  const change = useCallback((next: boolean) => onToggle(name, next), [name, onToggle]);
  return (
    <View
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
      testID={`mcp-method-${name}`}
    >
      <Text style={styles.methodName}>{name}</Text>
      <Switch
        value={allowed}
        onValueChange={change}
        disabled={disabled}
        accessibilityLabel={name}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  rail: {
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  filters: {
    gap: theme.spacing[3],
  },
  summary: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  railRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  railControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: theme.spacing[2],
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  centeredHint: {
    maxWidth: 420,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  // Static color holder read by the spinner and provider glyphs; keeps the muted token without
  // useUnistyles (banned in new code).
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  glyph: {
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  footnote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  rowHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  protocolName: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  timing: {
    marginLeft: "auto",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  // Optical: the chevron's ink sits about 4px inside its box; this lands it on the card's trailing
  // rail, the same offset settings rows use.
  chevron: {
    marginRight: -theme.spacing[1],
  },
  chevronOpen: {
    marginRight: -theme.spacing[1],
    transform: [{ rotate: "90deg" }],
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1.5],
  },
  meta: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  argumentsPreview: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  details: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  codeBlock: {
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  detailFacts: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  menuCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  sheetBody: {
    gap: theme.spacing[4],
  },
  sheetHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  methodGroup: {
    gap: theme.spacing[2],
  },
  methodName: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
