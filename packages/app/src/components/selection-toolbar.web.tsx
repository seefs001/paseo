import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { computePosition, type Rect } from "@/components/ui/anchor";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  getOverlayRoot,
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
export interface AnchoredSelection {
  anchor: Rect;
}

export interface SelectionToolbarAction<Selection extends AnchoredSelection> {
  id: string;
  label: string;
  icon: ComponentProps<typeof Button>["leftIcon"];
  onSelect: (selection: Selection) => void | Promise<void>;
}

interface SelectionToolbarProps<Selection extends AnchoredSelection> {
  readSelection: () => Selection | null;
  actions: readonly SelectionToolbarAction<Selection>[];
  label: string;
  testID: string;
  clearSelectionOnInvoke?: boolean;
}

interface ToolbarPosition {
  x: number;
  y: number;
}

function preserveSelection(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

export function SelectionToolbar<Selection extends AnchoredSelection>({
  readSelection,
  actions,
  label,
  testID,
  clearSelectionOnInvoke = true,
}: SelectionToolbarProps<Selection>) {
  const readCurrentSelection = useStableEvent(readSelection);
  const active = useRetainedPanelActive();
  const layer = useOverlayLayer("floating");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const visible = active && selection !== null;
  const close = useCallback(() => setSelection(null), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      const focused = document.activeElement;
      const editingText =
        focused instanceof HTMLElement &&
        (focused.isContentEditable || focused.matches("input, textarea"));
      if (event.key === "Escape") {
        close();
        // Preserve editor commands such as leaving Vim visual mode.
        if (editingText) return false;
        event.preventDefault();
        return true;
      }
      // Code editors own Tab for indentation/completion while editing a selection.
      const enterToolbar =
        event.key === "Tab" && !event.shiftKey && !editingText && !toolbar?.contains(focused);
      if (enterToolbar) {
        const firstButton = toolbar?.querySelector<HTMLElement>('[role="button"], button');
        if (firstButton) {
          event.preventDefault();
          firstButton.focus();
          return true;
        }
      }
      return false;
    },
    [close],
  );
  const registerOverlay = useWebOverlayRegistration({
    active: visible,
    layer,
    onKeyDown,
    manageFocus: false,
  });
  const setToolbarRef = useCallback(
    (node: HTMLDivElement | null) => {
      toolbarRef.current = node;
      registerOverlay(node);
    },
    [registerOverlay],
  );

  useEffect(() => {
    if (!active) {
      close();
      return;
    }
    const insideToolbar = (target: EventTarget | null) =>
      target instanceof Node && toolbarRef.current?.contains(target) === true;
    const captureSelection = () => {
      setSelection(readCurrentSelection());
      setPosition(null);
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || insideToolbar(event.target)) return;
      captureSelection();
    };
    const pointerDown = (event: PointerEvent) => {
      if (!insideToolbar(event.target)) close();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (insideToolbar(event.target)) return;
      const selectAll = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
      if (event.shiftKey || event.key === "Shift" || selectAll) captureSelection();
    };
    const selectionChanged = () => {
      if (toolbarRef.current?.contains(document.activeElement)) return;
      const current = window.getSelection();
      if (!current || current.isCollapsed) close();
    };
    const scrolled = (event: Event) => {
      if (!insideToolbar(event.target)) close();
    };
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keyup", keyUp);
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keyup", keyUp);
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [active, close, readCurrentSelection]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!visible || !selection || !toolbar) return;
    const place = () => {
      const rect = toolbar.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = computePosition({
        triggerRect: selection.anchor,
        contentSize: { width: rect.width, height: rect.height },
        displayArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        placement: "top",
        alignment: "start",
        offset: 8,
      });
      setPosition({ x: next.x, y: next.y });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [selection, visible]);

  const invoke = useCallback(
    async (action: SelectionToolbarAction<Selection>) => {
      if (!selection || pendingActionId !== null) return;
      setPendingActionId(action.id);
      try {
        const completion = action.onSelect(selection);
        if (clearSelectionOnInvoke) window.getSelection()?.removeAllRanges();
        await completion;
      } finally {
        setPendingActionId(null);
        close();
      }
    },
    [selection, pendingActionId, clearSelectionOnInvoke, close],
  );
  const buttons = useMemo(
    () => actions.map((action) => ({ ...action, onPress: () => void invoke(action) })),
    [actions, invoke],
  );
  const frameStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      left: position?.x ?? -9999,
      top: position?.y ?? -9999,
      visibility: position ? "visible" : "hidden",
      maxWidth: "calc(100vw - 16px)",
      pointerEvents: "auto",
      zIndex: layer,
    }),
    [position, layer],
  );

  if (!visible) return null;
  return createPortal(
    <OverlayLayerProvider layer={layer}>
      <div
        ref={setToolbarRef}
        role="toolbar"
        aria-label={label}
        data-testid={testID}
        onMouseDown={preserveSelection}
        style={frameStyle}
      >
        <View style={styles.toolbar}>
          {buttons.map((action) => (
            <Button
              key={action.id}
              variant="ghost"
              size="xs"
              leftIcon={action.icon}
              testID={action.id}
              loading={pendingActionId === action.id}
              disabled={pendingActionId !== null}
              onPress={action.onPress}
            >
              {action.label}
            </Button>
          ))}
        </View>
      </div>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: theme.spacing[1],
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    ...theme.shadow.md,
  },
}));
