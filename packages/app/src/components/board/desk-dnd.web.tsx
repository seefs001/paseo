import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { BoardCard } from "@/board/columns";
import type { DeskCheckpoint } from "@/board/desk";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import {
  acceptsDeskDrop,
  deskDropFailureKey,
  runDeskDrop,
  type DeskDragPayload,
  type DeskDropTargetSpec,
} from "./desk-dnd-drop";
import type { DeskRankListProps } from "./desk-dnd-rank";

export type { DeskDragPayload, DeskDropTargetSpec, DeskRankListProps };

/**
 * Web and desktop Desk drag and drop: pointer dragging with a preview, drop targets that light up
 * when the pointer is over one that accepts the payload, edge auto-scroll in whatever zone the
 * pointer is in, and Escape to cancel.
 */

const DeskDragActiveContext = createContext<DeskDragPayload | null>(null);

export function useDeskDragActive(): DeskDragPayload | null {
  return useContext(DeskDragActiveContext);
}

interface DraggableData {
  payload: DeskDragPayload;
}

interface DroppableData {
  target: DeskDropTargetSpec;
}

function readPayload(data: unknown): DeskDragPayload | null {
  return (data as DraggableData | undefined)?.payload ?? null;
}

function readTarget(data: unknown): DeskDropTargetSpec | null {
  return (data as DroppableData | undefined)?.target ?? null;
}

function rectArea(rect: ClientRect | undefined): number {
  return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
}

/** Targets under the pointer that accept the payload; the innermost (smallest) one wins. */
const deskCollision: CollisionDetection = (args) => {
  const payload = readPayload(args.active.data.current);
  if (!payload) return [];
  return pointerWithin(args)
    .filter((collision) => {
      const container = args.droppableContainers.find((entry) => entry.id === collision.id);
      const target = readTarget(container?.data.current);
      return target !== null && acceptsDeskDrop(payload, target);
    })
    .sort(
      (a, b) => rectArea(args.droppableRects.get(a.id)) - rectArea(args.droppableRects.get(b.id)),
    );
};

/** Marks the drag preview so auto-scroll looks past it to what is under the pointer. */
const PREVIEW_CLASS = "desk-drag-preview";

const ACTIVATION = {
  mouse: { distance: 6 },
  touch: { delay: 200, tolerance: 8 },
};

// Droppables in other zones scroll under the pointer while dragging, so re-measure them.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

export function DeskDragProvider({ children }: { children: ReactNode }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const [active, setActive] = useState<DeskDragPayload | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: ACTIVATION.mouse }),
    useSensor(TouchSensor, { activationConstraint: ACTIVATION.touch }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActive(readPayload(event.active.data.current));
  }, []);
  const handleDragCancel = useCallback(() => setActive(null), []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActive(null);
      const payload = readPayload(event.active.data.current);
      const target = readTarget(event.over?.data.current);
      if (!payload || !target || !acceptsDeskDrop(payload, target)) return;
      runDeskDrop(payload, target).catch((error: unknown) => {
        toast.error(t(deskDropFailureKey(target), { message: toErrorMessage(error) }));
      });
    },
    [t, toast],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={deskCollision}
      measuring={MEASURING}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <DeskDragActiveContext value={active}>
        {children}
        <DeskAutoScroll active={active !== null} />
      </DeskDragActiveContext>
      <DragOverlay dropAnimation={null} className={PREVIEW_CLASS}>
        {active ? <DeskDragPreview payload={active} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

const DRAGGABLE_STYLE: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const DRAGGING_STYLE: CSSProperties = { ...DRAGGABLE_STYLE, opacity: 0.4 };

export function DeskDraggable({
  payload,
  children,
  disabled = false,
}: {
  payload: DeskDragPayload;
  children: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const id = useId();
  const data = useMemo<DraggableData>(() => ({ payload }), [payload]);
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, data, disabled });
  // No `attributes`: cards keep their own button role and keyboard handling.
  return (
    <div ref={setNodeRef} {...listeners} style={isDragging ? DRAGGING_STYLE : DRAGGABLE_STYLE}>
      {children}
    </div>
  );
}

function useDeskDroppable(target: DeskDropTargetSpec) {
  const id = useId();
  const active = useDeskDragActive();
  const accepts = active !== null && acceptsDeskDrop(active, target);
  const data = useMemo<DroppableData>(() => ({ target }), [target]);
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled: !accepts });
  return { ref: setNodeRef as unknown as Ref<View>, isOver: accepts && isOver };
}

export function DeskDropTarget({
  target,
  children,
  style,
}: {
  target: DeskDropTargetSpec;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  const { ref, isOver } = useDeskDroppable(target);
  return (
    <View ref={ref} style={[style, styles.target]}>
      {children}
      {isOver ? <View pointerEvents="none" style={styles.targetOver} /> : null}
    </View>
  );
}

/**
 * An Ahead list on web: every card drags, takes a task dropped on it (wait for it), and has an
 * insertion slot above it; the slot below the last card appends.
 */
export function DeskRankList({
  serverId,
  goalId,
  stage,
  cards,
  renderCard,
  style,
}: DeskRankListProps): ReactElement {
  const end = useMemo<DeskDropTargetSpec>(
    () => ({ type: "stage", serverId, goalId, stage, beforeTaskId: null }),
    [goalId, serverId, stage],
  );
  return (
    <View style={style}>
      {cards.map((card) => (
        <DeskRankRow
          key={card.key}
          card={card}
          serverId={serverId}
          goalId={goalId}
          stage={stage}
          renderCard={renderCard}
        />
      ))}
      <DeskRankSlot target={end} last empty={cards.length === 0} />
    </View>
  );
}

function DeskRankRow({
  card,
  serverId,
  goalId,
  stage,
  renderCard,
}: {
  card: BoardCard;
  serverId: string;
  goalId: string | null;
  stage: "fog" | "ready";
  renderCard: DeskRankListProps["renderCard"];
}): ReactElement {
  const slot = useMemo<DeskDropTargetSpec>(
    () => ({ type: "stage", serverId, goalId, stage, beforeTaskId: card.task.id }),
    [card.task.id, goalId, serverId, stage],
  );
  const onto = useMemo<DeskDropTargetSpec>(
    () => ({ type: "task", serverId, task: card.task }),
    [card.task, serverId],
  );
  const payload = useMemo<DeskDragPayload>(
    () => ({ type: "task", serverId, task: card.task }),
    [card.task, serverId],
  );
  return (
    <>
      <DeskRankSlot target={slot} last={false} empty={false} />
      <DeskDraggable payload={payload}>
        <DeskDropTarget target={onto}>{renderCard(card, { isActive: false })}</DeskDropTarget>
      </DeskDraggable>
    </>
  );
}

/** A thin insertion slot that grows while a task is dragged and shows a line when targeted. */
function DeskRankSlot({
  target,
  last,
  empty,
}: {
  target: DeskDropTargetSpec;
  last: boolean;
  empty: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const active = useDeskDragActive();
  const { ref, isOver } = useDeskDroppable(target);
  const dragging = active?.type === "task" && acceptsDeskDrop(active, target);
  return (
    <View
      ref={ref}
      style={[styles.slot, dragging && styles.slotDragging, dragging && last && styles.slotLast]}
    >
      {isOver ? <View style={styles.slotLine} /> : null}
      {dragging && last && empty ? (
        <Text style={styles.slotHint}>{t("board.plan2.dnd.dropHere")}</Text>
      ) : null}
    </View>
  );
}

function checkpointTitle(checkpoint: DeskCheckpoint): string {
  if (checkpoint.decision) return checkpoint.decision.title;
  const item = checkpoint.item;
  if (!item) return "";
  if (item.kind === "task") return item.card.task.title;
  return item.agent.title?.trim() || item.workspace.name;
}

function DeskDragPreview({ payload }: { payload: DeskDragPayload }): ReactElement {
  const label =
    payload.type === "task"
      ? `T-${payload.task.number} ${payload.task.title}`
      : checkpointTitle(payload.checkpoint);
  return (
    <View style={styles.preview}>
      <Text style={styles.previewLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const SCROLL_EDGE_PX = 56;
const SCROLL_MAX_STEP_PX = 18;

function isScrollable(element: HTMLElement, axis: "x" | "y"): boolean {
  const style = window.getComputedStyle(element);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (overflow !== "auto" && overflow !== "scroll") return false;
  return axis === "y"
    ? element.scrollHeight > element.clientHeight
    : element.scrollWidth > element.clientWidth;
}

/** How far to scroll along one axis: faster the closer the pointer is to the edge. */
function edgeStep(position: number, start: number, end: number): number {
  if (position < start + SCROLL_EDGE_PX) {
    return -Math.ceil(((start + SCROLL_EDGE_PX - position) / SCROLL_EDGE_PX) * SCROLL_MAX_STEP_PX);
  }
  if (position > end - SCROLL_EDGE_PX) {
    return Math.ceil(((position - (end - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX) * SCROLL_MAX_STEP_PX);
  }
  return 0;
}

/** Scrolls the innermost scroll container under the pointer that can move toward the edge. */
function scrollUnderPointer(x: number, y: number): void {
  const under = document
    .elementsFromPoint(x, y)
    .find((element) => !element.closest(`.${PREVIEW_CLASS}`));
  let scrolledX = false;
  let scrolledY = false;
  for (let node = under?.parentElement ?? null; node; node = node.parentElement) {
    const rect = node.getBoundingClientRect();
    if (!scrolledY && isScrollable(node, "y")) {
      const step = edgeStep(y, rect.top, rect.bottom);
      const room =
        step < 0 ? node.scrollTop : node.scrollHeight - node.clientHeight - node.scrollTop;
      if (step !== 0 && room > 0) {
        node.scrollTop += step;
        scrolledY = true;
      }
    }
    if (!scrolledX && isScrollable(node, "x")) {
      const step = edgeStep(x, rect.left, rect.right);
      const room =
        step < 0 ? node.scrollLeft : node.scrollWidth - node.clientWidth - node.scrollLeft;
      if (step !== 0 && room > 0) {
        node.scrollLeft += step;
        scrolledX = true;
      }
    }
    if (scrolledX && scrolledY) return;
  }
}

/**
 * dnd-kit only auto-scrolls the dragged card's own containers; a drag from Ahead into Decide must
 * scroll Decide too, so this follows the pointer instead.
 */
function DeskAutoScroll({ active }: { active: boolean }): null {
  const pointerRef = useRef({ x: -1, y: -1 });
  useDndMonitor({
    onDragStart: (event) => {
      const pointer = pointerRef.current;
      const start = event.activatorEvent;
      if (start instanceof MouseEvent)
        Object.assign(pointer, { x: start.clientX, y: start.clientY });
      else if (start instanceof TouchEvent && start.touches[0]) {
        Object.assign(pointer, { x: start.touches[0].clientX, y: start.touches[0].clientY });
      }
    },
  });
  useEffect(() => {
    if (!active) return;
    const pointer = pointerRef.current;
    const onMouse = (event: MouseEvent) =>
      Object.assign(pointer, { x: event.clientX, y: event.clientY });
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) Object.assign(pointer, { x: touch.clientX, y: touch.clientY });
    };
    let frame = 0;
    const tick = () => {
      if (pointer.x >= 0) scrollUnderPointer(pointer.x, pointer.y);
      frame = window.requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("touchmove", onTouch);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      window.cancelAnimationFrame(frame);
    };
  }, [active]);
  return null;
}

const styles = StyleSheet.create((theme) => ({
  target: {
    position: "relative",
  },
  // Drawn over the target so lighting it up never shifts the layout.
  targetOver: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  slot: {
    height: theme.spacing[1.5],
    justifyContent: "center",
  },
  slotDragging: {
    height: theme.spacing[4],
  },
  slotLast: {
    minHeight: theme.spacing[8],
    alignItems: "center",
  },
  slotLine: {
    alignSelf: "stretch",
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.accent,
  },
  slotHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  preview: {
    maxWidth: 280,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.md,
  },
  previewLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
