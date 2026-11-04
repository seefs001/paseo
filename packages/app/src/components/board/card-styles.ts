import { StyleSheet } from "react-native-unistyles";

export const boardCardStyles = StyleSheet.create((theme) => ({
  card: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  hovered: {
    backgroundColor: theme.colors.surface1,
  },
  selected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface1,
  },
  pressed: {
    backgroundColor: theme.colors.surface2,
  },
}));
