import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";
import type { View as NativeView } from "react-native";
import { STATUS_RING_PERIOD_MS } from "@/components/status-ring/geometry";

const STATUS_RING_KEYFRAMES: PropertyIndexedKeyframes = {
  transform: ["rotate(0deg)", "rotate(360deg)"],
};
const STATUS_RING_TIMING: KeyframeAnimationOptions = {
  duration: STATUS_RING_PERIOD_MS,
  easing: "linear",
  iterations: Number.POSITIVE_INFINITY,
  fill: "both",
};

// A playing Web Animation is sampled at the display refresh rate. Electron then
// presents the whole window, which on a ProMotion panel keeps WindowServer busy
// for as long as any agent is running. The badge only needs a few positions per turn.
const STATUS_RING_TICK_MS = 100;

const animations = new Set<Animation>();
let timer: ReturnType<typeof setTimeout> | null = null;

function paintRings(): void {
  const time = Date.now() % STATUS_RING_PERIOD_MS;
  for (const animation of animations) {
    animation.currentTime = time;
  }
}

function stopClockIfIdle(): void {
  if (animations.size > 0 || timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function tick(): void {
  if (animations.size === 0) {
    timer = null;
    return;
  }
  paintRings();
  timer = setTimeout(tick, STATUS_RING_TICK_MS);
}

function ensureClock(): void {
  if (timer !== null) return;
  paintRings();
  timer = setTimeout(tick, STATUS_RING_TICK_MS);
}

export function useStatusRingAnimationRef(): RefCallback<NativeView> {
  const arcElement = useRef<HTMLElement | null>(null);
  const setArcElement = useCallback((instance: NativeView | null) => {
    arcElement.current = instance instanceof HTMLElement ? instance : null;
  }, []);

  useLayoutEffect(() => {
    const element = arcElement.current;
    if (!element || typeof element.animate !== "function") {
      return;
    }

    const animation = element.animate(STATUS_RING_KEYFRAMES, STATUS_RING_TIMING);
    animation.pause();
    animation.currentTime = Date.now() % STATUS_RING_PERIOD_MS;
    animations.add(animation);
    ensureClock();
    return () => {
      animations.delete(animation);
      animation.cancel();
      stopClockIfIdle();
    };
  }, []);

  return setArcElement;
}
