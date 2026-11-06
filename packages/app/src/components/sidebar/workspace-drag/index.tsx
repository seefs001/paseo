import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  SidebarWorkspaceDragScopeProps,
  SidebarWorkspaceDragSourceProps,
  SidebarWorkspaceDropSectionProps,
} from "./types";

export function SidebarWorkspaceDragScope({ children }: SidebarWorkspaceDragScopeProps) {
  return children;
}

export function SidebarWorkspaceDragSource({
  children,
  isDragging,
  dragHandleProps,
}: SidebarWorkspaceDragSourceProps) {
  return children({ isDragging, dragHandleProps });
}

export function SidebarWorkspaceDropSection({
  section,
  hasItems,
  children,
}: SidebarWorkspaceDropSectionProps) {
  if (!hasItems) return null;
  return (
    <View style={styles.section} testID={`sidebar-${section}-section`}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
}));
