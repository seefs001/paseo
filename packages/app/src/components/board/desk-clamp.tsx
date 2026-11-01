import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";

const FADE_GRADIENT = "linear-gradient(to bottom, black 60%, transparent)";

/**
 * Fades the last lines of folded content on web, so a line cut in half reads as "more below". A
 * mask, not an overlay, so it works over any card background, hovered or not. Typed as a plain
 * object because React Native's style types have no mask.
 */
const FADE_OUT: object | null = isWeb
  ? { maskImage: FADE_GRADIENT, WebkitMaskImage: FADE_GRADIENT }
  : null;

/** Long unbroken text, such as a URL or a path, wraps inside its card on web. */
export const DESK_BREAK_WORDS = isWeb ? { overflowWrap: "anywhere" as const } : null;

/** Content this much past the limit still shows whole: a toggle for one line costs more than it saves. */
const SLACK = 24;

/**
 * Folds long content inside a Desk card to `maxHeight`, with a Show more toggle. The content is
 * measured, so short content never shows the toggle.
 */
export function DeskClamp({
  maxHeight,
  children,
  testID,
}: {
  maxHeight: number;
  children: ReactNode;
  testID?: string;
}): ReactElement {
  const { t } = useTranslation();
  const [contentHeight, setContentHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  }, []);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const overflows = contentHeight > maxHeight + SLACK;
  const clamped = overflows && !expanded;
  const clipStyle = useMemo(
    () => [styles.clip, clamped && { maxHeight }, clamped && FADE_OUT],
    [clamped, maxHeight],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return (
    <View style={styles.container}>
      <View style={clipStyle}>
        <View onLayout={handleLayout}>{children}</View>
      </View>
      {overflows ? (
        <Button
          size="xs"
          variant="ghost"
          leftIcon={expanded ? ChevronUp : ChevronDown}
          onPress={toggle}
          style={styles.toggle}
          accessibilityState={accessibilityState}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          {expanded ? t("board.ui.showLess") : t("board.ui.showMore")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[0.5],
  },
  clip: {
    overflow: "hidden",
  },
  toggle: {
    alignSelf: "flex-start",
    // Optical: the ghost button's padding would push its chevron off the text rail.
    marginLeft: -theme.spacing[2],
  },
}));
