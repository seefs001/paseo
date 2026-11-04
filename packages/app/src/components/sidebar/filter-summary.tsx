import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useHosts } from "@/runtime/host-runtime";
import { SIDEBAR_UNLABELLED_LABEL_KEY, useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { Theme } from "@/styles/theme";
import { useWorkspaceLabelProjection } from "@/workspace-labels";
import { useSidebarModel } from "./sidebar-model";

const ThemedX = withUnistyles(X);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface FilterSummaryRow {
  key: string;
  facet: string;
  names: string[];
}

export function SidebarFilterSummary(): ReactElement | null {
  const { t } = useTranslation();
  const hosts = useHosts();
  const { allProjects, resolvedProjectFilters } = useSidebarModel();
  const { labels } = useWorkspaceLabelProjection();
  const { hostFilters, labelFilter, clearFilters } = useSidebarViewStore(
    useShallow((state) => ({
      hostFilters: state.hostFilters,
      labelFilter: state.labelFilter,
      clearFilters: state.clearFilters,
    })),
  );
  const labelNames = useMemo(
    () => new Map(labels.map((label) => [workspaceLabelKey(label.name), label.name])),
    [labels],
  );
  const rows: FilterSummaryRow[] = [];
  if (hostFilters.length > 0) {
    rows.push({
      key: "hosts",
      facet: t("sidebar.display.hostFilter.label"),
      names: hostFilters.map((id) => hosts.find((host) => host.serverId === id)?.label || id),
    });
  }
  if (resolvedProjectFilters.length > 0) {
    const included = new Set(resolvedProjectFilters);
    const selectedProjects = allProjects.filter((project) => included.has(project.viewKey));
    rows.push({
      key: "projects",
      facet: t("sidebar.display.projectFilter.label"),
      names: selectedProjects.map((project) => project.projectName),
    });
  }
  if (labelFilter.labels.length > 0) {
    const names = labelFilter.labels.map((key) => {
      if (key === SIDEBAR_UNLABELLED_LABEL_KEY) return t("workspaceLabels.unlabelled");
      return labelNames.get(key) ?? key;
    });
    rows.push({ key: "labels", facet: t("workspaceLabels.filter.matchAny"), names });
  }
  if (rows.length === 0) return null;

  return (
    <View style={styles.container} testID="sidebar-filter-summary">
      <View style={styles.facets}>
        {rows.map((row) => (
          <Text key={row.key} style={styles.text} testID={`sidebar-filter-summary-${row.key}`}>
            {t("sidebar.filters.summary", { facet: row.facet, values: row.names.join(", ") })}
          </Text>
        ))}
      </View>
      <ToolbarButton
        label={t("sidebar.filterEmpty.clear")}
        onPress={clearFilters}
        testID="sidebar-filter-summary-clear"
      >
        <ThemedX size={14} uniProps={mutedIconMapping} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  facets: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[1],
  },
}));
