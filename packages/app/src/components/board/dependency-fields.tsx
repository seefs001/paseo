import type { BoardTask } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field } from "@/components/ui/form-field";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  SelectField,
  SelectFieldTrigger,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";

/** A task picked in the form, with the title captured when it was picked. */
export interface BoardTaskRef {
  id: string;
  title: string;
}

export function toBoardTaskRef(
  tasks: ReadonlyMap<string, BoardTask>,
  taskId: string | null,
): BoardTaskRef | null {
  if (taskId === null) return null;
  return { id: taskId, title: tasks.get(taskId)?.title ?? taskId };
}

function sortByTitle(tasks: Iterable<BoardTask>): BoardTask[] {
  return [...tasks].sort((a, b) => a.title.localeCompare(b.title));
}

/** The task and every task split from it, at any depth. */
function collectSubtree(tasks: ReadonlyMap<string, BoardTask>, rootId: string): Set<string> {
  const subtree = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks.values()) {
      if (task.parentId !== null && subtree.has(task.parentId) && !subtree.has(task.id)) {
        subtree.add(task.id);
        grew = true;
      }
    }
  }
  return subtree;
}

interface ParentFieldProps {
  tasks: ReadonlyMap<string, BoardTask>;
  /** The task being edited; null while creating. */
  taskId: string | null;
  value: BoardTaskRef | null;
  onChange: (parent: BoardTaskRef | null) => void;
  size: FieldControlSize;
}

/** A task cannot sit under itself or under one of its own subtasks. */
export function BoardTaskParentField({
  tasks,
  taskId,
  value,
  onChange,
  size,
}: ParentFieldProps): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const excluded = taskId === null ? new Set<string>() : collectSubtree(tasks, taskId);
    const candidates = sortByTitle(tasks.values()).filter((task) => !excluded.has(task.id));
    return [
      { id: "none", value: "", label: t("board.plan.noParent") },
      ...candidates.map((task) => ({ id: task.id, value: task.id, label: task.title })),
    ];
  }, [t, taskId, tasks]);
  const display = useMemo<SelectFieldDisplay | null>(
    () => (value ? { label: value.title } : null),
    [value],
  );
  const select = useCallback(
    (id: string, selected: SelectFieldDisplay) => {
      onChange(id ? { id, title: selected.label } : null);
    },
    [onChange],
  );
  return (
    <SelectField
      label={t("board.plan.parent")}
      value={value?.id ?? ""}
      selectedDisplay={display}
      options={options}
      onChange={select}
      placeholder={t("board.plan.noParent")}
      emptyText={t("board.plan.noTasks")}
      searchable
      searchPlaceholder={t("board.plan.searchTasks")}
      title={t("board.plan.parent")}
      size={size}
      triggerTestID="board-task-parent"
    />
  );
}

interface BlockersFieldProps {
  tasks: ReadonlyMap<string, BoardTask>;
  taskId: string | null;
  value: readonly BoardTaskRef[];
  onChange: (blockers: BoardTaskRef[]) => void;
  size: FieldControlSize;
}

/** Only unfinished tasks are offered; a blocker that finished later stays selected. */
export function BoardTaskBlockersField({
  tasks,
  taskId,
  value,
  onChange,
  size,
}: BlockersFieldProps): ReactElement {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(value.map((blocker) => blocker.id)), [value]);
  const options = useMemo<ComboboxOption[]>(
    () =>
      sortByTitle(tasks.values())
        .filter((task) => task.id !== taskId && task.completedAt === null)
        .map((task) => ({ id: task.id, label: task.title })),
    [taskId, tasks],
  );
  const toggle = useCallback(
    (id: string) => {
      if (selectedIds.has(id)) {
        onChange(value.filter((blocker) => blocker.id !== id));
        return;
      }
      const task = tasks.get(id);
      if (task) onChange([...value, { id, title: task.title }]);
    },
    [onChange, selectedIds, tasks, value],
  );
  const togglePicker = useCallback(() => setOpen((current) => !current), []);
  const renderOption = useCallback(
    ({
      option,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      active: boolean;
      onPress: () => void;
    }) => (
      <ComboboxItem
        key={option.id}
        testID={`board-task-blocker-option-${option.id}`}
        label={option.label}
        selected={selectedIds.has(option.id)}
        active={active}
        onPress={onPress}
      />
    ),
    [selectedIds],
  );
  const label = value.length > 0 ? value.map((blocker) => blocker.title).join(", ") : undefined;

  return (
    <Field label={t("board.plan.blockedBy")}>
      <View ref={anchorRef} collapsable={false}>
        <PressHighlight
          onPress={togglePicker}
          accessibilityRole="button"
          accessibilityLabel={t("board.plan.blockedBy")}
          testID="board-task-blocked-by"
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              label={label}
              isPlaceholder={label === undefined}
              placeholder={t("board.plan.noBlockers")}
              hovered={Boolean(hovered)}
              active={pressed || open}
              size={size}
            />
          )}
        </PressHighlight>
      </View>
      <Combobox
        options={options}
        value=""
        onSelect={toggle}
        searchable
        searchPlaceholder={t("board.plan.searchTasks")}
        title={t("board.plan.blockedBy")}
        emptyText={t("board.plan.noTasks")}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        keepOpenOnSelect
        renderOption={renderOption}
      />
    </Field>
  );
}

interface DependenciesProps {
  tasks: ReadonlyMap<string, BoardTask>;
  taskId: string | null;
  expanded: boolean;
  onToggle: () => void;
  parent: BoardTaskRef | null;
  onParentChange: (parent: BoardTaskRef | null) => void;
  blockers: readonly BoardTaskRef[];
  onBlockersChange: (blockers: BoardTaskRef[]) => void;
  size: FieldControlSize;
}

/** Parent and blockers sit behind a disclosure so a plain task stays a short form. */
export function BoardTaskDependencies({
  tasks,
  taskId,
  expanded,
  onToggle,
  parent,
  onParentChange,
  blockers,
  onBlockersChange,
  size,
}: DependenciesProps): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.disclosure}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={expanded ? ChevronDown : ChevronRight}
        onPress={onToggle}
        style={styles.disclosureButton}
        testID="board-task-dependencies-toggle"
      >
        {t("board.plan.dependencies")}
      </Button>
      {expanded ? (
        <View style={styles.fields}>
          <BoardTaskParentField
            tasks={tasks}
            taskId={taskId}
            value={parent}
            onChange={onParentChange}
            size={size}
          />
          <BoardTaskBlockersField
            tasks={tasks}
            taskId={taskId}
            value={blockers}
            onChange={onBlockersChange}
            size={size}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  disclosure: {
    gap: theme.spacing[3],
  },
  disclosureButton: {
    alignSelf: "flex-start",
  },
  fields: {
    gap: theme.spacing[4],
  },
}));
