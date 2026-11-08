import { BOARD_DESK_ZONE_IDS, type BoardDeskSettings } from "@getpaseo/protocol/messages";
import { useIsFocused } from "expo-router";
import { ArrowLeft, Plus, SquareKanban, Target } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BOARD_COLUMNS, type BoardCard } from "@/board/columns";
import { buildDeskModel, type DeskGoalFocus, type DeskHostInput } from "@/board/desk";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { buildBoardItems, hasBoardFilters, type BoardFilters } from "@/board/items";
import { openBoardTaskSheet } from "@/board/sheet";
import { DESK_MODES, modeShowsCapture, zonesForMode, type DeskMode } from "@/board/desk-mode";
import { useBoardTasks } from "@/board/tasks";
import { BoardActions } from "@/components/board/board-actions";
import { BoardCompactPager } from "@/components/board/board-compact-pager";
import {
  buildDeskLanes,
  countDeskGroups,
  countDeskZone,
  type DeskGroupCounts,
  type DeskLanes,
  type DeskZoneId,
} from "@/components/board/board-desk";
import { useBoardKeyboard } from "@/components/board/board-keyboard";
import { useBoardRouteState, type BoardRouteState } from "@/components/board/board-params";
import { useBoardLayoutPrefs } from "@/components/board/board-prefs";
import { useBoardSelection } from "@/components/board/board-selection";
import { BoardToolbar, collectBoardFilterOptions } from "@/components/board/board-toolbar";
import { BoardWideZones, type DeskZoneContext } from "@/components/board/board-zones";
import { DeskCaptureBar, type DeskCaptureBarProps } from "@/components/board/desk-capture";
import { DeskDragProvider, useDeskDragActive } from "@/components/board/desk-dnd";
import { DeskProfileDock } from "@/components/board/desk-profile-dock";
import { BoardDetailSheet } from "@/components/board/detail-sheet";
import { BoardFocusMenu, BoardViewsPane, type DeskPaneHost } from "@/components/board/views-pane";
import { MenuHeader } from "@/components/headers/menu-header";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { useHostDirectories } from "@/stores/session-store-hooks";

const GOALS_PANE_WIDTH = 232;
/** Snoozed checkpoints wake and Landed ages out on this clock. */
const CLOCK_INTERVAL_MS = 30_000;
const EMPTY_COUNTS: ReadonlyMap<string, DeskGroupCounts> = new Map();
const EMPTY_LANES: DeskLanes = { decide: [], flight: [], ahead: [], landed: [] };
/** The Desk lays out every zone in one fixed order; modes pick which of them show. */
const DESK_ZONES: BoardDeskSettings["zones"] = BOARD_DESK_ZONE_IDS.map((id) => ({
  id,
  visible: true,
  name: null,
}));
const NO_ZONES: BoardDeskSettings["zones"] = [];

interface HostNotice {
  serverId: string;
  message: string;
}

interface DeskHost extends DeskHostInput {
  settings: BoardDeskSettings;
}

function useClock(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Hosts whose tasks and directory are both loaded, plus the loading and notice states. */
function useDeskHosts() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const hostTasks = useBoardTasks((state) => state.hosts);
  const directories = useHostDirectories(serverIds);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);

  useEffect(() => {
    const runtime = getHostRuntimeStore();
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [serverIds]);

  const readyHosts = useMemo<DeskHost[]>(
    () =>
      hosts.flatMap((host) => {
        const state = hostTasks[host.serverId];
        const directory = directories.find((entry) => entry.serverId === host.serverId);
        if (state?.status !== "ready" || !directory?.hydrated) return [];
        return [
          {
            serverId: host.serverId,
            serverName: host.label,
            tasks: state.tasks,
            goals: state.goals,
            decisions: state.decisions,
            snoozes: state.snoozes,
            settings: state.settings,
            directory,
          },
        ];
      }),
    [directories, hostTasks, hosts],
  );
  const isLoading =
    readyHosts.length === 0 &&
    hosts.some((host) => {
      const status = hostTasks[host.serverId]?.status;
      // A host the runtime has not connected yet has no task state at all.
      if (status === undefined) {
        const connection = connectionStatuses.get(host.serverId);
        return connection !== "offline" && connection !== "error";
      }
      return status === "loading" || status === "ready";
    });
  const notices = useMemo<HostNotice[]>(
    () =>
      hosts.flatMap((host) => {
        const status = hostTasks[host.serverId]?.status;
        if (status === "unsupported") {
          return [
            { serverId: host.serverId, message: t("board.hostUnsupported", { host: host.label }) },
          ];
        }
        if (status === "error") {
          return [
            { serverId: host.serverId, message: t("board.hostLoadFailed", { host: host.label }) },
          ];
        }
        return [];
      }),
    [hostTasks, hosts, t],
  );
  return { hosts, readyHosts, isLoading, notices };
}

function paneHosts(hosts: readonly DeskHost[]): DeskPaneHost[] {
  return hosts.map((host) => ({
    serverId: host.serverId,
    serverName: host.serverName,
    goals: [...host.goals.values()]
      .filter((goal) => goal.landedAt === null)
      .sort((a, b) => a.rank - b.rank),
  }));
}

/** What the Desk shows under the route's host filter, focus, filters and toggles. */
function useDeskView(input: {
  hosts: readonly { serverId: string }[];
  readyHosts: readonly DeskHost[];
  route: BoardRouteState;
  now: number;
}) {
  const { hosts, readyHosts, route, now } = input;
  const { filters, showSubagents } = route;
  const effectiveHost = hosts.some((host) => host.serverId === route.host)
    ? route.host
    : ALL_HOSTS_OPTION_ID;
  const visibleHosts = useMemo(
    () =>
      effectiveHost === ALL_HOSTS_OPTION_ID
        ? readyHosts
        : readyHosts.filter((host) => host.serverId === effectiveHost),
    [effectiveHost, readyHosts],
  );
  const focus = useMemo<DeskGoalFocus | null>(() => {
    const target = route.focus;
    return target && visibleHosts.some((host) => host.serverId === target.serverId) ? target : null;
  }, [route.focus, visibleHosts]);
  // How the Desk works comes from one host: the focused or filtered one, else the first.
  const settingsHost =
    visibleHosts.find((host) => host.serverId === focus?.serverId) ?? visibleHosts[0];
  const settings = settingsHost?.settings ?? null;
  const showHost = readyHosts.length > 1;
  const createHost = settingsHost?.serverId;

  const desk = useMemo(() => {
    if (!settings) return null;
    const base = { filters, showSubagents, now };
    // The Desk always groups by goal. Goal counts ignore focus, so the pane keeps every
    // goal's numbers while one is focused.
    const deskSettings = { ...settings, grouping: "goal" as const };
    const byGoal = buildDeskModel(visibleHosts, { ...base, settings: deskSettings, focus: null });
    const model =
      focus === null
        ? byGoal
        : buildDeskModel(visibleHosts, { ...base, settings: deskSettings, focus });
    return { model, counts: countDeskGroups(byGoal) };
  }, [filters, focus, now, settings, showSubagents, visibleHosts]);
  const zones = settings ? DESK_ZONES : NO_ZONES;
  const zoneIds = useMemo<DeskZoneId[]>(() => zones.map((zone) => zone.id), [zones]);
  const lanes = useMemo(() => (desk ? buildDeskLanes(desk.model) : null), [desk]);

  const filterOptions = useMemo(() => {
    const columns = buildBoardItems(visibleHosts, { showSubagents, doneWindow: "all", now });
    return collectBoardFilterOptions(
      BOARD_COLUMNS.flatMap((column) => columns[column]),
      showHost,
    );
  }, [now, showHost, showSubagents, visibleHosts]);
  const goalHosts = useMemo(() => paneHosts(visibleHosts), [visibleHosts]);

  return {
    effectiveHost,
    focus,
    settings,
    showHost,
    createHost,
    desk,
    zones,
    zoneIds,
    lanes,
    filterOptions,
    goalHosts,
  };
}

interface BoardScreenProps {
  onOpenDesk: () => void;
}

/** The existing task and goal workflow remains available outside the default Desk. */
export function BoardScreen({ onOpenDesk }: BoardScreenProps): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return (
    <DeskDragProvider>
      <BoardScreenContent onOpenDesk={onOpenDesk} />
    </DeskDragProvider>
  );
}

function BoardScreenContent({ onOpenDesk }: BoardScreenProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const now = useClock(CLOCK_INTERVAL_MS);
  const { hosts, readyHosts, isLoading, notices } = useDeskHosts();
  const [route, updateRoute] = useBoardRouteState();
  const { filters, showSubagents } = route;
  const goalsPaneHidden = useBoardLayoutPrefs((state) => state.goalsPaneHidden);
  const toggleGoalsPane = useBoardLayoutPrefs((state) => state.toggleGoalsPane);
  const mode = useBoardLayoutPrefs((state) => state.mode);
  const setMode = useBoardLayoutPrefs((state) => state.setMode);

  const {
    effectiveHost,
    focus,
    settings,
    showHost,
    createHost,
    desk,
    zones: hostZones,
    zoneIds: hostZoneIds,
    lanes,
    filterOptions,
    goalHosts,
  } = useDeskView({ hosts, readyHosts, route, now });
  const zones = useMemo(() => zonesForMode(mode, hostZones), [hostZones, mode]);
  const zoneIds = useMemo(
    () => hostZoneIds.filter((id) => zones.some((zone) => zone.id === id)),
    [hostZoneIds, zones],
  );
  const decideCount = desk ? countDeskZone(desk.model, "decide") : 0;
  const captureGoals = useMemo(
    () => [...(readyHosts.find((host) => host.serverId === createHost)?.goals.values() ?? [])],
    [createHost, readyHosts],
  );

  const openCreate = useCallback(() => {
    if (!createHost) return;
    const goalId = focus?.serverId === createHost ? focus.goalId : undefined;
    openBoardTaskSheet({
      mode: "create",
      serverId: createHost,
      stage: "ready",
      ...(goalId !== undefined ? { goalId } : {}),
    });
  }, [createHost, focus]);
  const openEdit = useCallback((card: BoardCard) => {
    openBoardTaskSheet({ mode: "edit", serverId: card.serverId, task: card.task });
  }, []);
  const changeFilters = useCallback(
    (next: BoardFilters) => updateRoute({ filters: next }),
    [updateRoute],
  );
  const changeShowSubagents = useCallback(
    (next: boolean) => updateRoute({ showSubagents: next }),
    [updateRoute],
  );
  const changeHost = useCallback((host: string) => updateRoute({ host }), [updateRoute]);
  const changeFocus = useCallback(
    (next: DeskGoalFocus | null) => updateRoute({ focus: next }),
    [updateRoute],
  );
  const selection = useBoardSelection({
    lanes: lanes ?? EMPTY_LANES,
    zones: zoneIds,
    isCompact,
    onEditTask: openEdit,
  });
  const keyboardLanes = useMemo(
    () => (lanes ? zoneIds.map((zone) => lanes[zone]) : []),
    [lanes, zoneIds],
  );
  const hasRows = keyboardLanes.some((lane) => lane.length > 0);
  useBoardKeyboard({
    enabled: !isLoading && hasRows,
    lanes: keyboardLanes,
    selectedKey: selection.selectedKey,
    onSelect: selection.selectEntry,
    onOpen: selection.openEntry,
    onToggleDetail: selection.toggleDetail,
    onEscape: selection.escape,
  });

  const context = useMemo<DeskZoneContext | null>(
    () =>
      desk && settings
        ? {
            model: desk.model,
            grouping: "goal",
            groupCounts: desk.counts,
            showHost,
            selectedKey: selection.selectedKey,
            focus,
            onFocus: changeFocus,
            onOpenDetail: selection.openDetail,
            onEditTask: openEdit,
          }
        : null,
    [
      changeFocus,
      desk,
      focus,
      openEdit,
      selection.openDetail,
      selection.selectedKey,
      settings,
      showHost,
    ],
  );

  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button
          variant="ghost"
          leftIcon={ArrowLeft}
          onPress={onOpenDesk}
          testID="tasks-back-to-desk"
        >
          {t("board.title")}
        </Button>
        {isCompact ? (
          <BoardFocusMenu
            hosts={goalHosts}
            showHost={showHost}
            focus={focus}
            onFocus={changeFocus}
          />
        ) : null}
      </View>
    ),
    [changeFocus, focus, goalHosts, isCompact, onOpenDesk, showHost, t],
  );
  const goalsPaneToggle = useMemo(
    () => (isCompact ? null : { hidden: goalsPaneHidden, onToggle: toggleGoalsPane }),
    [goalsPaneHidden, isCompact, toggleGoalsPane],
  );
  const actions = useMemo(
    () => <BoardActions createHost={createHost} onCreateTask={openCreate} />,
    [createHost, openCreate],
  );

  const isEmpty =
    desk !== null &&
    zoneIds.every((zone) => countDeskZone(desk.model, zone) === 0) &&
    desk.model.snoozed.length === 0 &&
    goalHosts.every((host) => host.goals.length === 0) &&
    !hasBoardFilters(filters) &&
    focus === null;
  const zonesView =
    isLoading || !context || isEmpty ? (
      <BoardPlaceholder
        isLoading={isLoading}
        unavailable={readyHosts.length === 0}
        createHost={createHost}
        onCreateTask={openCreate}
      />
    ) : (
      <DeskZonesArea
        isCompact={isCompact}
        zones={zones}
        activeZone={selection.compactZone}
        onChangeZone={selection.setCompactZone}
        context={context}
      />
    );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("desk.tasksAndGoals")} rightContent={headerActions} />
      <BoardToolbar
        filters={filters}
        onFiltersChange={changeFilters}
        options={filterOptions}
        showSubagents={showSubagents}
        onShowSubagentsChange={changeShowSubagents}
        hosts={hosts}
        selectedHost={effectiveHost}
        onSelectHost={changeHost}
        goalsPane={goalsPaneToggle}
        actions={actions}
      />
      <BoardHostNotices notices={notices} />
      <DeskModeBar mode={mode} onChange={setMode} decideCount={decideCount} />
      <DeskCapture
        serverId={isLoading || !modeShowsCapture(mode) ? undefined : createHost}
        goals={captureGoals}
        focus={focus}
      />
      <View style={styles.body}>
        {!isCompact && !goalsPaneHidden ? (
          <ScrollView
            style={styles.goalsPane}
            contentContainerStyle={styles.goalsPaneContent}
            showsVerticalScrollIndicator={false}
          >
            <BoardViewsPane
              hosts={goalHosts}
              showHost={showHost}
              counts={desk?.counts ?? EMPTY_COUNTS}
              focus={focus}
              onFocus={changeFocus}
            />
          </ScrollView>
        ) : null}
        <View style={styles.desk}>
          {zonesView}
          <DeskDragDock />
        </View>
      </View>
      {/* The detail opens over the Desk, so the zones never shift or squeeze to make room. */}
      <BoardDetailSheet
        item={selection.detailItem}
        onClose={selection.closeDetail}
        onPrevious={selection.showPrevious}
        onNext={selection.showNext}
        onEditTask={openEdit}
      />
    </View>
  );
}

/** Handle, Plan and Overview; Handle carries the count of what waits on you. */
function DeskModeBar({
  mode,
  onChange,
  decideCount,
}: {
  mode: DeskMode;
  onChange: (mode: DeskMode) => void;
  decideCount: number;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<DeskMode>[]>(
    () =>
      DESK_MODES.map((value) => ({
        value,
        label:
          value === "handle" && decideCount > 0
            ? t("board.desk.modes.handleCount", { count: decideCount })
            : t(`board.desk.modes.${value}`),
        testID: `desk-mode-${value}`,
      })),
    [decideCount, t],
  );
  return (
    <View style={styles.modeRow}>
      <SegmentedControl
        options={options}
        value={mode}
        onValueChange={onChange}
        size="sm"
        testID="desk-modes"
      />
    </View>
  );
}

/** Phones page through zones one at a time; wide layouts lay them side by side. */
function DeskZonesArea({
  isCompact,
  zones,
  activeZone,
  onChangeZone,
  context,
}: {
  isCompact: boolean;
  zones: BoardDeskSettings["zones"];
  activeZone: DeskZoneId;
  onChangeZone: (zone: DeskZoneId) => void;
  context: DeskZoneContext;
}): ReactElement {
  if (isCompact) {
    return (
      <BoardCompactPager
        zones={zones}
        activeZone={activeZone}
        onChangeZone={onChangeZone}
        context={context}
      />
    );
  }
  return <BoardWideZones zones={zones} context={context} />;
}

function DeskCapture({
  serverId,
  goals,
  focus,
}: {
  serverId: string | undefined;
  goals: DeskCaptureBarProps["goals"];
  focus: DeskGoalFocus | null;
}): ReactElement | null {
  if (!serverId) return null;
  return (
    <DeskCaptureBar
      serverId={serverId}
      goals={goals}
      defaultGoalId={focus?.serverId === serverId ? focus.goalId : null}
    />
  );
}

/** Agent profiles to drop a task on, shown only while a task is being dragged. */
function DeskDragDock(): ReactElement | null {
  const drag = useDeskDragActive();
  if (drag?.type !== "task") return null;
  return (
    <View style={styles.dock} pointerEvents="box-none">
      <DeskProfileDock serverId={drag.serverId} />
    </View>
  );
}

function BoardHostNotices({ notices }: { notices: readonly HostNotice[] }): ReactElement | null {
  if (notices.length === 0) return null;
  return (
    <View style={styles.noticeWrap}>
      <View style={styles.notice} testID="board-host-notices">
        {notices.map((notice) => (
          <Text key={notice.serverId} style={styles.noticeText}>
            {notice.message}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** What the Desk shows before there is anything to lay out in zones. */
function BoardPlaceholder({
  isLoading,
  unavailable,
  createHost,
  onCreateTask,
}: {
  isLoading: boolean;
  unavailable: boolean;
  createHost: string | undefined;
  onCreateTask: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const createGoal = useCallback(() => {
    if (createHost) openDeskGoalSheet({ mode: "create", serverId: createHost });
  }, [createHost]);
  let content: ReactElement;
  if (isLoading) {
    content = <LoadingSpinner size="large" color={styles.spinner.color} />;
  } else if (unavailable) {
    content = <Text style={styles.message}>{t("board.unavailable")}</Text>;
  } else {
    content = (
      <View style={styles.emptyState} testID="board-empty">
        <SquareKanban size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <View style={styles.emptyTextStack}>
          <Text style={styles.emptyTitle}>{t("board.desk.empty.title")}</Text>
          <Text style={styles.emptyDescription}>{t("board.desk.empty.description")}</Text>
        </View>
        <View style={styles.emptyActions}>
          <Button
            variant="outline"
            leftIcon={Target}
            onPress={createGoal}
            testID="board-empty-goal"
          >
            {t("board.desk.newGoal")}
          </Button>
          <Button variant="outline" leftIcon={Plus} onPress={onCreateTask} testID="board-empty-new">
            {t("board.newTask")}
          </Button>
        </View>
      </View>
    );
  }
  return <View style={styles.centered}>{content}</View>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  modeRow: {
    flexDirection: "row",
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
  },
  noticeWrap: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
  },
  notice: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  noticeText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  body: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  goalsPane: {
    width: GOALS_PANE_WIDTH,
    flexGrow: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
  },
  goalsPaneContent: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[6],
    paddingHorizontal: theme.spacing[2],
  },
  desk: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "row",
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.spacing[4],
    alignItems: "center",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[4],
    maxWidth: 420,
    width: "100%",
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  // Static color holders read by non-style props; keeps theme tokens without useUnistyles.
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
