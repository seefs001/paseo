import { ListFilter, PanelLeft, X } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { hasBoardFilters, type BoardFilters, type BoardItem } from "@/board/items";
import { HostFilter } from "@/components/hosts/host-filter";
import type { HostPickerHost } from "@/components/hosts/host-picker";
import { Button } from "@/components/ui/button";
import { DensityIcon } from "@/components/ui/density-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/** Long enough that a typed word is one URL update, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

export const BOARD_SEARCH_TEST_ID = "board-search";

export interface BoardFilterOption {
  key: string;
  label: string;
  count: number;
}

/** What the filter menus offer: only values the loaded items actually carry. */
export interface BoardFilterOptions {
  projects: BoardFilterOption[];
  workspaces: BoardFilterOption[];
  providers: BoardFilterOption[];
  labels: BoardFilterOption[];
}

type FilterGroup = "projects" | "workspaces" | "providers" | "labels";

const FILTER_GROUPS: readonly FilterGroup[] = ["projects", "workspaces", "providers", "labels"];

const FILTER_GROUP_LABEL_KEYS: Record<FilterGroup, string> = {
  projects: "board.view.filters.project",
  workspaces: "board.view.filters.workspace",
  providers: "board.view.filters.provider",
  labels: "board.view.filters.label",
};

function bump(options: Map<string, BoardFilterOption>, key: string, label: string): void {
  const existing = options.get(key);
  if (existing) existing.count += 1;
  else options.set(key, { key, label, count: 1 });
}

function sortOptions(options: Map<string, BoardFilterOption>): BoardFilterOption[] {
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function itemContext(item: BoardItem) {
  if (item.kind === "agent") {
    return {
      projectId: item.workspace.projectId,
      workspace: item.workspace,
      project: item.project,
      provider: item.agent.provider,
    };
  }
  const { card } = item;
  return {
    projectId: card.workspace?.projectId ?? card.task.projectId,
    workspace: card.workspace,
    project: card.project,
    provider: null,
  };
}

export function collectBoardFilterOptions(
  items: readonly BoardItem[],
  showHost: boolean,
): BoardFilterOptions {
  const projects = new Map<string, BoardFilterOption>();
  const workspaces = new Map<string, BoardFilterOption>();
  const providers = new Map<string, BoardFilterOption>();
  const labels = new Map<string, BoardFilterOption>();
  for (const item of items) {
    const { projectId, workspace, project, provider } = itemContext(item);
    const suffix = showHost ? ` (${item.serverName})` : "";
    if (projectId && project) {
      bump(
        projects,
        `${item.serverId}:${projectId}`,
        (project.projectCustomName ?? project.projectDisplayName) + suffix,
      );
    }
    if (workspace) {
      bump(
        workspaces,
        `${item.serverId}:${workspace.id}`,
        (workspace.title ?? workspace.name) + suffix,
      );
      for (const label of workspace.labels ?? []) bump(labels, label.toLowerCase(), label);
    }
    if (provider) bump(providers, provider, provider);
  }
  return {
    projects: sortOptions(projects),
    workspaces: sortOptions(workspaces),
    providers: sortOptions(providers),
    labels: sortOptions(labels),
  };
}

function toggleEntry(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

interface BoardToolbarProps {
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  options: BoardFilterOptions;
  showSubagents: boolean;
  onShowSubagentsChange: (show: boolean) => void;
  hosts: HostPickerHost[];
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  /** Wide layouts only. */
  goalsPane: { hidden: boolean; onToggle: () => void } | null;
  /** New task, New goal and Desk settings. */
  actions: ReactNode;
}

export function BoardToolbar({
  filters,
  onFiltersChange,
  options,
  showSubagents,
  onShowSubagentsChange,
  hosts,
  selectedHost,
  onSelectHost,
  goalsPane,
  actions,
}: BoardToolbarProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const changeQuery = useCallback(
    (query: string) => onFiltersChange({ ...filtersRef.current, query }),
    [onFiltersChange],
  );

  const search = <BoardSearch query={filters.query} onQueryChange={changeQuery} />;
  const controls = (
    <>
      <BoardFilterMenu
        filters={filters}
        onFiltersChange={onFiltersChange}
        options={options}
        showSubagents={showSubagents}
        onShowSubagentsChange={onShowSubagentsChange}
      />
      {hosts.length > 1 ? (
        <HostFilter
          hosts={hosts}
          selectedHost={selectedHost}
          onSelectHost={onSelectHost}
          triggerTestID="board-host-filter"
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      {isCompact ? (
        <>
          <View style={styles.row}>{search}</View>
          <View style={styles.wrapRow}>
            {controls}
            <View style={styles.actions}>{actions}</View>
          </View>
        </>
      ) : (
        <View style={styles.row}>
          {goalsPane ? (
            <ToolbarButton
              label={t(goalsPane.hidden ? "board.desk.pane.show" : "board.desk.pane.hide")}
              selected={!goalsPane.hidden}
              onPress={goalsPane.onToggle}
              testID="board-goals-pane-toggle"
            >
              <DensityIcon icon={PanelLeft} size="sm" color="foregroundMuted" />
            </ToolbarButton>
          ) : null}
          <View style={styles.searchSlot}>{search}</View>
          {controls}
          <View style={styles.actions}>{actions}</View>
        </View>
      )}
      <BoardFilterChips filters={filters} options={options} onFiltersChange={onFiltersChange} />
    </View>
  );
}

/**
 * The field keeps its own text so typing stays instant; the debounced value goes to the URL.
 * When the URL changes from elsewhere (a view, a cleared chip), the field takes that value.
 */
function BoardSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [input, setInput] = useState(query);
  const [fieldKey, setFieldKey] = useState(0);
  const debounced = useDebouncedValue(input, SEARCH_DEBOUNCE_MS);
  const queryRef = useRef(query);
  queryRef.current = query;
  const debouncedRef = useRef(debounced);
  debouncedRef.current = debounced;

  useEffect(() => {
    if (debounced !== queryRef.current) onQueryChange(debounced);
  }, [debounced, onQueryChange]);

  useEffect(() => {
    if (query === debouncedRef.current) return;
    setInput(query);
    setFieldKey((previous) => previous + 1);
  }, [query]);

  return (
    <SearchField
      key={fieldKey}
      value={input}
      onChangeText={setInput}
      placeholder={t("board.desk.searchPlaceholder")}
      clearAccessibilityLabel={t("board.view.clearSearch")}
      testID={BOARD_SEARCH_TEST_ID}
      clearTestID="board-search-clear"
    />
  );
}

function BoardFilterMenu({
  filters,
  onFiltersChange,
  options,
  showSubagents,
  onShowSubagentsChange,
}: {
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  options: BoardFilterOptions;
  showSubagents: boolean;
  onShowSubagentsChange: (show: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const activeCount = FILTER_GROUPS.reduce((count, group) => count + filters[group].length, 0);
  const toggleSubagents = useCallback(
    () => onShowSubagentsChange(!showSubagents),
    [onShowSubagentsChange, showSubagents],
  );
  const pages = useMemo<MenuPageDefinition[]>(
    () =>
      FILTER_GROUPS.map((group) => ({
        id: group,
        title: t(FILTER_GROUP_LABEL_KEYS[group]),
        content: (
          <FilterOptionPage
            group={group}
            filters={filters}
            options={options[group]}
            onFiltersChange={onFiltersChange}
          />
        ),
      })),
    [filters, onFiltersChange, options, t],
  );
  const leading = useMemo(
    () => <DensityIcon icon={ListFilter} size="sm" color="foregroundMuted" />,
    [],
  );

  return (
    <DropdownMenu>
      <DropdownTrigger size="sm" leading={leading} testID="board-filter-menu">
        {activeCount > 0
          ? t("board.view.filters.triggerActive", { count: activeCount })
          : t("board.view.filters.trigger")}
      </DropdownTrigger>
      <DropdownMenuContent
        align="start"
        width={260}
        pages={pages}
        sheetTitle={t("board.view.filters.trigger")}
        testID="board-filter-menu-content"
      >
        {FILTER_GROUPS.map((group) => (
          <DropdownMenuSubTrigger
            key={group}
            id={group}
            indicator={filters[group].length > 0}
            disabled={options[group].length === 0 && filters[group].length === 0}
            testID={`board-filter-${group}`}
          >
            {t(FILTER_GROUP_LABEL_KEYS[group])}
          </DropdownMenuSubTrigger>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          selected={showSubagents}
          closeOnSelect={false}
          onSelect={toggleSubagents}
          testID="board-show-subagents"
        >
          {t("board.view.showSubagents")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterOptionPage({
  group,
  filters,
  options,
  onFiltersChange,
}: {
  group: FilterGroup;
  filters: BoardFilters;
  options: readonly BoardFilterOption[];
  onFiltersChange: (filters: BoardFilters) => void;
}): ReactElement {
  const { t } = useTranslation();
  const selected = filters[group];
  const clear = useCallback(
    () => onFiltersChange({ ...filters, [group]: [] }),
    [filters, group, onFiltersChange],
  );
  return (
    <>
      <DropdownMenuItem
        selected={selected.length === 0}
        closeOnSelect={false}
        onSelect={clear}
        testID={`board-filter-${group}-all`}
      >
        {t("board.view.filters.any")}
      </DropdownMenuItem>
      {options.map((option) => (
        <FilterOptionItem
          key={option.key}
          group={group}
          option={option}
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
      ))}
    </>
  );
}

function FilterOptionItem({
  group,
  option,
  filters,
  onFiltersChange,
}: {
  group: FilterGroup;
  option: BoardFilterOption;
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
}): ReactElement {
  const toggle = useCallback(
    () => onFiltersChange({ ...filters, [group]: toggleEntry(filters[group], option.key) }),
    [filters, group, onFiltersChange, option.key],
  );
  return (
    <DropdownMenuItem
      selected={filters[group].includes(option.key)}
      closeOnSelect={false}
      onSelect={toggle}
      testID={`board-filter-${group}-${option.key}`}
    >
      {option.label}
    </DropdownMenuItem>
  );
}

interface FilterChip {
  id: string;
  label: string;
  next: BoardFilters;
}

function BoardFilterChips({
  filters,
  options,
  onFiltersChange,
}: {
  filters: BoardFilters;
  options: BoardFilterOptions;
  onFiltersChange: (filters: BoardFilters) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const chips = useMemo<FilterChip[]>(() => {
    const list: FilterChip[] = [];
    const query = filters.query.trim();
    if (query.length > 0) {
      list.push({
        id: "query",
        label: t("board.view.filters.queryChip", { query }),
        next: { ...filters, query: "" },
      });
    }
    for (const group of FILTER_GROUPS) {
      for (const key of filters[group]) {
        const label = options[group].find((option) => option.key === key)?.label ?? key;
        list.push({
          id: `${group}:${key}`,
          label: `${t(FILTER_GROUP_LABEL_KEYS[group])}: ${label}`,
          next: { ...filters, [group]: filters[group].filter((entry) => entry !== key) },
        });
      }
    }
    return list;
  }, [filters, options, t]);
  const clearAll = useCallback(
    () => onFiltersChange({ query: "", projects: [], workspaces: [], providers: [], labels: [] }),
    [onFiltersChange],
  );

  if (!hasBoardFilters(filters)) return null;
  return (
    <View style={styles.chips} testID="board-filter-chips">
      {chips.map((chip) => (
        <BoardFilterChip key={chip.id} chip={chip} onFiltersChange={onFiltersChange} />
      ))}
      <Button variant="ghost" size="sm" onPress={clearAll} testID="board-filters-clear">
        {t("board.view.filters.clear")}
      </Button>
    </View>
  );
}

function BoardFilterChip({
  chip,
  onFiltersChange,
}: {
  chip: FilterChip;
  onFiltersChange: (filters: BoardFilters) => void;
}): ReactElement {
  const { t } = useTranslation();
  const remove = useCallback(() => onFiltersChange(chip.next), [chip.next, onFiltersChange]);
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={X}
      onPress={remove}
      accessibilityLabel={t("board.view.filters.remove", { filter: chip.label })}
      testID={`board-filter-chip-${chip.id}`}
    >
      {chip.label}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  searchSlot: {
    flex: 1,
    maxWidth: 320,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
