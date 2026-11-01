import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardDeskSettings } from "@getpaseo/protocol/messages";
import { DESK_ZONES_TEST_ID, countDeskZone, type DeskZoneId } from "@/components/board/board-desk";
import {
  DeskZoneBody,
  DeskZoneHeader,
  DeskZoneIcon,
  deskZoneLabel,
  type DeskZoneContext,
} from "@/components/board/board-zones";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useBlockMobilePanelOpenGestures } from "@/mobile-panels/provider";

type DeskZoneSetting = BoardDeskSettings["zones"][number];

interface BoardCompactPagerProps {
  zones: readonly DeskZoneSetting[];
  activeZone: DeskZoneId;
  onChangeZone: (zone: DeskZoneId) => void;
  context: DeskZoneContext;
}

/** Phones show one zone at a time: a row of zone tabs with counts over swipeable pages. */
export function BoardCompactPager({
  zones,
  activeZone,
  onChangeZone,
  context,
}: BoardCompactPagerProps): ReactElement {
  const { t } = useTranslation();
  const [pageWidth, setPageWidth] = useState(0);
  const pageWidthRef = useRef(0);
  const pagerRef = useRef<ScrollView>(null);
  const tabsRef = useRef<ScrollView>(null);
  const tabOffsets = useRef(new Map<DeskZoneId, number>());
  // The page the scroll position shows, so a tab press only scrolls when it has to.
  const shownIndex = useRef(-1);
  const activeIndex = Math.max(
    0,
    zones.findIndex((zone) => zone.id === activeZone),
  );

  // Swiping right from the first zone still opens the sidebar; past it, the swipe pages back.
  useBlockMobilePanelOpenGestures(activeIndex > 0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width === pageWidthRef.current) return;
    // A new width moves every page, so the shown page has to be scrolled to again.
    pageWidthRef.current = width;
    shownIndex.current = -1;
    setPageWidth(width);
  }, []);

  useEffect(() => {
    if (pageWidth === 0 || shownIndex.current === activeIndex) return;
    const animated = shownIndex.current !== -1;
    shownIndex.current = activeIndex;
    pagerRef.current?.scrollTo({ x: activeIndex * pageWidth, animated });
  }, [activeIndex, pageWidth]);

  useEffect(() => {
    const offset = tabOffsets.current.get(activeZone);
    if (offset !== undefined) tabsRef.current?.scrollTo({ x: Math.max(0, offset - 24) });
  }, [activeZone]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth === 0) return;
      const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      const zone = zones[index];
      if (!zone || index === shownIndex.current) return;
      shownIndex.current = index;
      onChangeZone(zone.id);
    },
    [onChangeZone, pageWidth, zones],
  );

  return (
    <View style={styles.container}>
      <ScrollView
        ref={tabsRef}
        horizontal
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
        showsHorizontalScrollIndicator={false}
        testID="board-zone-tabs"
      >
        {zones.map((zone) => (
          <BoardZoneTab
            key={zone.id}
            zone={zone.id}
            label={deskZoneLabel(zone, t)}
            count={countDeskZone(context.model, zone.id)}
            selected={zone.id === activeZone}
            onSelect={onChangeZone}
            onMeasure={tabOffsets.current}
          />
        ))}
      </ScrollView>
      <View style={styles.pager} onLayout={handleLayout}>
        {pageWidth > 0 ? (
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            testID={DESK_ZONES_TEST_ID}
          >
            {zones.map((zone) => (
              <View
                key={zone.id}
                style={[styles.page, { width: pageWidth }]}
                testID={`board-zone-${zone.id}`}
              >
                <DeskZoneHeader
                  zone={zone.id}
                  label={deskZoneLabel(zone, t)}
                  count={countDeskZone(context.model, zone.id)}
                  snoozedCount={zone.id === "decide" ? context.model.snoozed.length : undefined}
                />
                <ScrollView
                  style={styles.pageScroll}
                  contentContainerStyle={styles.cardList}
                  showsVerticalScrollIndicator={false}
                >
                  <DeskZoneBody zone={zone.id} context={context} />
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const SELECTED_STATE = { selected: true };
const UNSELECTED_STATE = { selected: false };

function BoardZoneTab({
  zone,
  label,
  count,
  selected,
  onSelect,
  onMeasure,
}: {
  zone: DeskZoneId;
  label: string;
  count: number;
  selected: boolean;
  onSelect: (zone: DeskZoneId) => void;
  onMeasure: Map<DeskZoneId, number>;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(zone), [zone, onSelect]);
  const measure = useCallback(
    (event: LayoutChangeEvent) => onMeasure.set(zone, event.nativeEvent.layout.x),
    [zone, onMeasure],
  );
  return (
    <PressHighlight
      onPress={select}
      onLayout={measure}
      accessibilityRole="tab"
      accessibilityState={selected ? SELECTED_STATE : UNSELECTED_STATE}
      accessibilityLabel={t("board.desk.zoneTab", { zone: label, count })}
      style={[styles.tab, selected && styles.tabSelected]}
      highlightStyle={styles.tabPressed}
      testID={`board-zone-tab-${zone}`}
    >
      <DeskZoneIcon zone={zone} />
      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={zone === "decide" && count > 0 ? styles.tabCountDecide : styles.tabCount}>
        {count}
      </Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabs: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 32,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  tabSelected: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  tabPressed: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  tabLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
  },
  tabCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  tabCountDecide: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  pager: {
    flex: 1,
    minHeight: 0,
  },
  page: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  pageScroll: {
    flex: 1,
    minHeight: 0,
  },
  cardList: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[6],
  },
}));
