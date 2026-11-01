import { Plus, Settings2, Target } from "lucide-react-native";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { openDeskGoalSheet } from "@/board/goal-sheet";
import { DeskSettingsSheet } from "@/components/board/desk-settings-sheet";
import { Button } from "@/components/ui/button";
import { DensityIcon } from "@/components/ui/density-icon";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";

interface SettingsSheetState {
  openCount: number;
  serverId: string;
  visible: boolean;
}

/** The toolbar's New goal, New task and Desk settings, and the settings sheet they open. */
export function BoardActions({
  createHost,
  onCreateTask,
}: {
  /** The host new work and Desk settings go to; undefined while no host can hold a Desk. */
  createHost: string | undefined;
  onCreateTask: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<SettingsSheetState | null>(null);
  const createGoal = useCallback(() => {
    if (createHost) openDeskGoalSheet({ mode: "create", serverId: createHost });
  }, [createHost]);
  const openSettings = useCallback(() => {
    if (!createHost) return;
    setSheet((previous) => ({
      openCount: (previous?.openCount ?? 0) + 1,
      serverId: createHost,
      visible: true,
    }));
  }, [createHost]);
  const closeSettings = useCallback(() => {
    setSheet((previous) => (previous ? { ...previous, visible: false } : previous));
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Target}
        onPress={createGoal}
        disabled={!createHost}
        testID="board-new-goal"
      >
        {t("board.desk.newGoal")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        leftIcon={Plus}
        onPress={onCreateTask}
        disabled={!createHost}
        testID="board-new-task"
      >
        {t("board.newTask")}
      </Button>
      <ToolbarButton
        label={t("board.desk.settings")}
        onPress={openSettings}
        disabled={!createHost}
        testID="board-desk-settings"
      >
        <DensityIcon icon={Settings2} size="sm" color="foregroundMuted" />
      </ToolbarButton>
      {sheet ? (
        <DeskSettingsSheet
          key={sheet.openCount}
          serverId={sheet.serverId}
          visible={sheet.visible}
          onClose={closeSettings}
        />
      ) : null}
    </>
  );
}
