import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

const FADE_IN_MS = 160;
const HOLD_MS = 1300;
const FADE_OUT_MS = 600;

// With reduce motion the highlight shows without fading for this long.
const REDUCED_MOTION_SHOW_MS = 2000;

/**
 * Short accent wash over the row a quote jump landed on. It is an absolute overlay, so the row
 * keeps its layout, text selection and pointer events. With reduce motion it shows without
 * fading. `onDone` runs once it is gone.
 */
export function QuoteJumpHighlight({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      const timer = setTimeout(onDone, REDUCED_MOTION_SHOW_MS);
      return () => clearTimeout(timer);
    }
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS, reduceMotion: ReduceMotion.Never }),
      withDelay(
        HOLD_MS,
        withTiming(
          0,
          {
            duration: FADE_OUT_MS,
            easing: Easing.out(Easing.quad),
            reduceMotion: ReduceMotion.Never,
          },
          // Removal follows the fade itself, so a busy first frame after navigation cannot cut
          // the highlight short.
          (finished) => {
            if (finished) runOnJS(onDone)();
          },
        ),
      ),
    );
    return undefined;
  }, [onDone, opacity, reduceMotion]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      testID="quote-jump-highlight"
      style={[styles.overlay, animatedStyle]}
    >
      <View style={styles.fill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: -theme.spacing[1],
    bottom: -theme.spacing[1],
    left: 0,
    right: 0,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    overflow: "hidden",
  },
  fill: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    opacity: 0.1,
  },
}));
