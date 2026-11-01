import { useEffect, useRef } from "react";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";

type DetailKeysInput = Parameters<typeof useDetailKeys>[0];

const STEP_BY_KEY: Record<string, (input: DetailKeysInput) => (() => void) | undefined> = {
  j: (input) => input.onNext,
  k: (input) => input.onPrevious,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

/**
 * J and K step to the next and previous item while the detail is open, as they do on the Desk
 * behind it. Keys typed into a field are left alone.
 */
export function useDetailKeys(input: {
  enabled: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const { enabled } = input;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.shiftKey || isImeComposingKeyboardEvent(event) || isTypingTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const step = STEP_BY_KEY[key]?.(latest.current);
      if (!step) return;
      event.preventDefault();
      step();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
