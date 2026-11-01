import { useCallback, type ReactElement } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getWorkspaceProjectId, openBoardTaskSheet } from "@/board/sheet";
import { createBoardTask } from "@/board/tasks";
import type { ToastApi } from "@/components/toast-host";
import { i18n } from "@/i18n/i18next";
import { toErrorMessage } from "@/utils/error-messages";
import { buildBoardRoute } from "@/utils/host-routes";

/** `/task <title>` adds a Backlog task without leaving the chat; `/task` alone opens the form. */
export async function runBoardTaskSlashCommand(input: {
  serverId: string;
  workspaceId: string | null | undefined;
  title: string;
  toast: ToastApi;
}): Promise<void> {
  const { serverId, title, toast } = input;
  const projectId = getWorkspaceProjectId(serverId, input.workspaceId);
  if (!title) {
    openBoardTaskSheet({ mode: "create", serverId, projectId });
    return;
  }
  try {
    await createBoardTask(serverId, { title, projectId });
  } catch (error) {
    toast.error(i18n.t("board.capture.addFailed", { message: toErrorMessage(error) }));
    return;
  }
  toast.show(<BoardTaskAddedToast />, { variant: "success" });
}

function BoardTaskAddedToast(): ReactElement {
  const { t } = useTranslation();
  const openBoard = useCallback(() => {
    router.push(buildBoardRoute());
  }, []);
  return (
    <Text style={styles.message}>
      {t("board.capture.added")}{" "}
      <Text style={styles.link} accessibilityRole="link" onPress={openBoard}>
        {t("board.capture.openBoard")}
      </Text>
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  link: {
    color: theme.colors.accent,
    fontWeight: theme.fontWeight.medium,
  },
}));
