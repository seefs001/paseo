import { useCallback, useMemo, useState } from "react";

export interface PressModifiers {
  /** Cmd on macOS, Ctrl elsewhere: toggle one row. */
  toggle: boolean;
  /** Shift: extend from the anchor row. */
  range: boolean;
}

export const NO_MODIFIERS: PressModifiers = { toggle: false, range: false };

/**
 * File-manager style selection over an ordered list of ids. Ids that leave the list drop out of
 * the selection, so a removed or filtered-out artifact is never acted on.
 */
export function useMultiSelect(orderedIds: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [mode, setMode] = useState(false);

  const selected = useMemo(() => {
    const visible = new Set(orderedIds);
    return new Set([...picked].filter((id) => visible.has(id)));
  }, [orderedIds, picked]);
  const active = mode || selected.size > 0;

  const clear = useCallback(() => {
    setPicked(new Set());
    setAnchor(null);
    setMode(false);
  }, []);
  const selectAll = useCallback(() => {
    setPicked(new Set(orderedIds));
    setMode(true);
  }, [orderedIds]);
  const toggleMode = useCallback(() => {
    if (active) clear();
    else setMode(true);
  }, [active, clear]);

  /** Returns true when the press changed the selection instead of opening the row. */
  const press = useCallback(
    (id: string, modifiers: PressModifiers): boolean => {
      if (modifiers.range && anchor !== null) {
        const from = orderedIds.indexOf(anchor);
        const to = orderedIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          setPicked((current) => new Set([...current, ...orderedIds.slice(start, end + 1)]));
          return true;
        }
      }
      if (!modifiers.toggle && !modifiers.range && !active) return false;
      setPicked((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
      return true;
    },
    [active, anchor, orderedIds],
  );

  return { selected, active, press, clear, selectAll, toggleMode };
}
