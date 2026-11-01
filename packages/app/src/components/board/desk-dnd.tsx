import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { BoardCard } from "@/board/columns";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import {
  rankAfterReorder,
  setDeskCardRank,
  type DeskDragPayload,
  type DeskDropTargetSpec,
} from "./desk-dnd-drop";
import type { DeskRankListProps } from "./desk-dnd-rank";

export type { DeskDragPayload, DeskDropTargetSpec, DeskRankListProps };

/**
 * Native Desk drag and drop: only long-press reorder inside one Ahead list. Moves across zones,
 * goals and stages go through the card menus, so drags never fight the Desk's scrolling.
 */

export function useDeskDragActive(): DeskDragPayload | null {
  return null;
}

export function DeskDragProvider({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export function DeskDraggable({
  children,
}: {
  payload: DeskDragPayload;
  children: ReactNode;
  disabled?: boolean;
}): ReactNode {
  return children;
}

export function DeskDropTarget({
  children,
  style,
}: {
  target: DeskDropTargetSpec;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  return <View style={style}>{children}</View>;
}

function cardKey(card: BoardCard): string {
  return card.key;
}

/** Keeps the dropped order on screen until the host's rank update arrives. */
interface PendingOrder {
  source: readonly BoardCard[];
  cards: BoardCard[];
}

export function DeskRankList({ cards, renderCard, style }: DeskRankListProps): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const shown = pending?.source === cards ? pending.cards : [...cards];

  const handleDragEnd = useCallback(
    (next: BoardCard[]) => {
      const move = rankAfterReorder(cards, next);
      if (!move) return;
      setPending({ source: cards, cards: next });
      setDeskCardRank(move.card, move.rank).catch((error: unknown) => {
        setPending(null);
        toast.error(t("board.plan2.dnd.moveFailed", { message: toErrorMessage(error) }));
      });
    },
    [cards, t, toast],
  );
  const renderItem = useCallback(
    ({ item, drag, isActive }: DraggableRenderItemInfo<BoardCard>) =>
      renderCard(item, { isActive, drag }),
    [renderCard],
  );

  return (
    <DraggableList
      data={shown}
      keyExtractor={cardKey}
      renderItem={renderItem}
      onDragEnd={handleDragEnd}
      containerStyle={style}
      scrollEnabled={false}
    />
  );
}
