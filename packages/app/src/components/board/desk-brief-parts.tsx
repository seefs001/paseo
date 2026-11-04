import type { BoardGoal, BoardTask } from "@getpaseo/protocol/messages";
import { AlarmClock, Bot, Flag } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DeskCheckpoint } from "@/board/desk";
import type { BoardItem } from "@/board/items";
import { snoozeCheckpoint, snoozePresets, type SnoozePreset } from "@/board/snooze";
import { useBoardTasks, type BoardHostTasks } from "@/board/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useDropdownMenuClose,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { formatMessageTimestamp } from "@/utils/time";

type ReadyHost = Extract<BoardHostTasks, { status: "ready" }>;
type HoverState = PressableStateCallbackType & { hovered?: boolean };

const ThemedAlarm = withUnistyles(AlarmClock);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ICON_SIZE = 14;

/** The host's Desk state while its tasks are loaded. */
export function useReadyBoardHost(serverId: string): ReadyHost | null {
  return useBoardTasks((state) => {
    const host = state.hosts[serverId];
    return host?.status === "ready" ? host : null;
  });
}

/** The task an item carries: its own, or the one riding on an agent. */
export function itemTask(item: BoardItem): BoardTask | null {
  return item.kind === "task" ? item.card.task : (item.task?.task ?? null);
}

/** The goal an item serves: its task's goal, or the goal the agent owns. Same rule as the Desk. */
export function findItemGoal(
  item: BoardItem,
  goals: ReadonlyMap<string, BoardGoal>,
): BoardGoal | null {
  const goalId = itemTask(item)?.goalId;
  if (goalId) return goals.get(goalId) ?? null;
  if (item.kind !== "agent") return null;
  for (const goal of goals.values()) if (goal.ownerAgentId === item.agent.id) return goal;
  return null;
}

export function useItemGoal(item: BoardItem): BoardGoal | null {
  const host = useReadyBoardHost(item.serverId);
  return useMemo(() => (host ? findItemGoal(item, host.goals) : null), [host, item]);
}

/** How an item names itself in a headline: the agent's title, or the task's number. */
export function itemName(item: BoardItem): string {
  if (item.kind === "agent") return item.agent.title?.trim() || item.workspace.name;
  return `T-${item.card.task.number}`;
}

/** The one-line "what happened" of a checkpoint, shared by the brief and the Later tray. */
export function useCheckpointHeadline(checkpoint: DeskCheckpoint): string {
  const { t } = useTranslation();
  const { item, decision, kind } = checkpoint;
  if (decision) return decision.title;
  if (!item) return t(`board.brief.kind.${kind}`);
  const name = itemName(item);
  switch (kind) {
    case "permission":
      return t("board.brief.headline.permission", { name });
    case "question":
      return t("board.brief.headline.question", { name });
    case "failed":
      return t("board.brief.headline.failed", { name });
    default:
      return itemTask(item)
        ? t("board.brief.headline.review", { name })
        : t("board.brief.headline.finished", { name });
  }
}

export function GoalChip({ goal }: { goal: BoardGoal }): ReactElement {
  return (
    <View style={styles.chip} testID={`desk-goal-chip-${goal.id}`}>
      <DensityIcon icon={Flag} size="sm" color="foregroundMuted" />
      <Text style={styles.chipNumber}>{`G-${goal.number}`}</Text>
      <Text style={styles.chipTitle} numberOfLines={1}>
        {goal.title}
      </Text>
    </View>
  );
}

export function TaskChip({ task }: { task: BoardTask }): ReactElement {
  return (
    <View style={styles.chip} testID={`desk-task-chip-${task.id}`}>
      <Text style={styles.chipNumber}>{`T-${task.number}`}</Text>
      <Text style={styles.chipTitle} numberOfLines={1}>
        {task.title}
      </Text>
    </View>
  );
}

export function AgentChip({ title }: { title: string }): ReactElement {
  return (
    <View style={styles.chip}>
      <DensityIcon icon={Bot} size="sm" color="foregroundMuted" />
      <Text style={styles.chipTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

/** Puts a checkpoint off: it leaves Decide and waits in the Later tray until its wake time. */
export function DeskSnoozeMenu({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("board.brief.snooze.menu")}
        testID={`desk-brief-snooze-${checkpoint.key}`}
      >
        {renderAlarmIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={240}>
        {open ? <SnoozeItems checkpoint={checkpoint} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The `MenuSubTrigger` id that opens the snooze presets in a checkpoint's context menu. */
export const DESK_SNOOZE_PAGE_ID = "deskSnooze";

/** The snooze presets as a page for a checkpoint's context menu. */
export function useSnoozePage(checkpoint: DeskCheckpoint): MenuPageDefinition {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      id: DESK_SNOOZE_PAGE_ID,
      title: t("board.brief.snooze.menu"),
      content: <SnoozeItems checkpoint={checkpoint} />,
    }),
    [checkpoint, t],
  );
}

function SnoozeItems({ checkpoint }: { checkpoint: DeskCheckpoint }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const close = useDropdownMenuClose();
  // Computed when the menu opens, so "Later today" counts from now.
  const presets = useMemo(() => snoozePresets(new Date()), []);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const snooze = useCallback(
    async (preset: SnoozePreset) => {
      setPendingId(preset.id);
      try {
        await snoozeCheckpoint(checkpoint, preset.until);
        close();
      } catch (error) {
        toast.error(t("board.brief.snooze.failed", { message: toErrorMessage(error) }));
      } finally {
        setPendingId(null);
      }
    },
    [checkpoint, close, t, toast],
  );
  return (
    <>
      {presets.map((preset) => (
        <SnoozeItem key={preset.id} preset={preset} pendingId={pendingId} onSnooze={snooze} />
      ))}
    </>
  );
}

function SnoozeItem({
  preset,
  pendingId,
  onSnooze,
}: {
  preset: SnoozePreset;
  pendingId: string | null;
  onSnooze: (preset: SnoozePreset) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const select = useCallback(() => {
    void onSnooze(preset);
  }, [onSnooze, preset]);
  return (
    <DropdownMenuItem
      description={formatMessageTimestamp(preset.until)}
      status={pendingId === preset.id ? "pending" : "idle"}
      pendingLabel={t("board.brief.snooze.snoozing")}
      disabled={pendingId !== null && pendingId !== preset.id}
      closeOnSelect={false}
      onSelect={select}
      testID={`desk-brief-snooze-${preset.id}`}
    >
      {t(preset.labelKey)}
    </DropdownMenuItem>
  );
}

function renderAlarmIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedAlarm size={ICON_SIZE} uniProps={hovered ? foregroundColorMapping : mutedColorMapping} />
  );
}

function triggerStyle({ hovered = false }: HoverState) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  chipNumber: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    lineHeight: 18,
  },
  chipTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  trigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface3,
  },
}));
