import type { ReactElement } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { BoardCard } from "@/board/columns";

/** One Ahead list (a group's Ready or Fog cards) whose order the user can change by dragging. */
export interface DeskRankListProps {
  serverId: string;
  /** The group's goal under goal grouping, else null; drops from other groups move here. */
  goalId: string | null;
  stage: "fog" | "ready";
  /** In rank order. */
  cards: readonly BoardCard[];
  /**
   * Native: call `drag` from the card's long press (see `useLongPressDragInteraction`) to lift it;
   * `isActive` is true while lifted. Web drags the whole card, so `drag` is undefined there.
   */
  renderCard: (card: BoardCard, state: { isActive: boolean; drag?: () => void }) => ReactElement;
  style?: StyleProp<ViewStyle>;
}
