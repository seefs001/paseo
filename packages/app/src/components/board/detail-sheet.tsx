import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard } from "@/board/columns";
import type { BoardItem } from "@/board/items";
import {
  AdaptiveModalSheet,
  SheetHeaderIconButton,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { useDetailKeys } from "@/components/board/detail-keys";
import {
  BoardDetailBody,
  BoardDetailMenu,
  BoardDetailProperties,
  BoardDetailState,
  BoardDetailSummary,
  boardItemTitle,
} from "@/components/board/detail-panel";
import { useIsCompactFormFactor } from "@/constants/layout";

interface BoardDetailSheetProps {
  item: BoardItem | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onEditTask: (card: BoardCard) => void;
}

/**
 * The selected item's detail as a modal: a centred card on wide layouts, a bottom sheet on compact
 * ones. It keeps the last item while the close animation runs, so it does not empty as it leaves.
 */
export function BoardDetailSheet({
  item,
  onClose,
  onPrevious,
  onNext,
  onEditTask,
}: BoardDetailSheetProps): ReactElement | null {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [shown, setShown] = useState<BoardItem | null>(item);
  if (item !== null && item !== shown) setShown(item);
  const current = item ?? shown;
  const visible = item !== null;
  const dismiss = useCallback(() => setShown(null), []);
  useDetailKeys({ enabled: visible && !isCompact, onPrevious, onNext });

  const header = useMemo<SheetHeader | null>(() => {
    if (!current) return null;
    return {
      title: boardItemTitle(current),
      subtitle: <BoardDetailState item={current} />,
      actions: (
        <>
          <BoardDetailMenu item={current} onEditTask={onEditTask} />
          {onPrevious || onNext ? (
            <>
              {onPrevious ? (
                <SheetHeaderIconButton
                  icon={ChevronUp}
                  accessibilityLabel={t("board.detail.previous")}
                  onPress={onPrevious}
                  testID="board-detail-sheet-previous"
                />
              ) : null}
              {onNext ? (
                <SheetHeaderIconButton
                  icon={ChevronDown}
                  accessibilityLabel={t("board.detail.next")}
                  onPress={onNext}
                  testID="board-detail-sheet-next"
                />
              ) : null}
            </>
          ) : null}
        </>
      ),
    };
  }, [current, onEditTask, onNext, onPrevious, t]);

  if (!current || !header) return null;
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={dismiss}
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={DESKTOP_MAX_WIDTH}
      testID="board-detail-sheet"
    >
      {isCompact ? (
        <View style={styles.content}>
          <BoardDetailSummary item={current} onEditTask={onEditTask} />
          <BoardDetailBody item={current} onEditTask={onEditTask} />
        </View>
      ) : (
        // Wide layouts read like an issue: what happened on the left, its properties on the right.
        <View style={styles.columns}>
          <View style={styles.main}>
            <BoardDetailSummary item={current} onEditTask={onEditTask} />
            <BoardDetailBody item={current} onEditTask={onEditTask} showProperties={false} />
          </View>
          <View style={styles.side} testID="board-detail-properties">
            <BoardDetailProperties item={current} onEditTask={onEditTask} />
          </View>
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

const SNAP_POINTS = ["65%", "95%"];
const DESKTOP_MAX_WIDTH = 880;
const SIDE_WIDTH = 300;

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[6],
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[4],
  },
  side: {
    width: SIDE_WIDTH,
    paddingLeft: theme.spacing[6],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
}));
