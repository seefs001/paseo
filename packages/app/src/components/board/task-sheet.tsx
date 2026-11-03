import type {
  AgentAttachment,
  BoardGoal,
  BoardTask,
  BoardTaskAttachment,
  BoardTaskCriterion,
  ForgeSearchItem,
} from "@getpaseo/protocol/messages";
import { Check, Link, Plus, X } from "lucide-react-native";
import { useCallback, useMemo, useReducer, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import type { BoardTaskSheetTarget } from "@/board/sheet";
import { createBoardTask, updateBoardTask, useBoardTasks } from "@/board/tasks";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import {
  BoardTaskDependencies,
  toBoardTaskRef,
  type BoardTaskRef,
} from "@/components/board/dependency-fields";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import type { ControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { getForgePresentation } from "@/git/forge";
import { useForgeSearchQuery } from "@/git/use-forge-search-query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { ProjectDescriptor } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { openExternalUrl } from "@/utils/open-external-url";
import { buildForgeAttachmentFromSearchItem } from "@/utils/review-attachments";

export interface BoardTaskSheetHost {
  serverId: string;
  label: string;
  projects: readonly ProjectDescriptor[];
}

interface BoardTaskSheetProps {
  target: BoardTaskSheetTarget;
  visible: boolean;
  /** Hosts that can store tasks right now. */
  hosts: readonly BoardTaskSheetHost[];
  onClose: () => void;
  onDismiss: () => void;
}

type Submission =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string };

interface FormState {
  serverId: string;
  projectId: string | null;
  projectDisplay: SelectFieldDisplay | null;
  title: string;
  notes: string;
  criteria: CriterionRow[];
  attachments: BoardTaskAttachment[];
  parent: BoardTaskRef | null;
  blockers: BoardTaskRef[];
  readyFor: ReadyFor;
  stage: Stage;
  goalId: string | null;
  showDependencies: boolean;
  submission: Submission;
}

type FormAction =
  | { type: "host"; serverId: string }
  | { type: "project"; projectId: string | null; display: SelectFieldDisplay }
  | { type: "title"; value: string }
  | { type: "notes"; value: string }
  | { type: "addCriterion" }
  | { type: "criterionText"; key: number; text: string }
  | { type: "removeCriterion"; key: number }
  | { type: "attachments"; attachments: BoardTaskAttachment[] }
  | { type: "parent"; parent: BoardTaskRef | null }
  | { type: "blockers"; blockers: BoardTaskRef[] }
  | { type: "readyFor"; value: ReadyFor }
  | { type: "stage"; value: Stage }
  | { type: "goal"; goalId: string | null }
  | { type: "toggleDependencies" }
  | { type: "submission"; submission: Submission };

function reduceForm(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "host":
      // Projects, goals and task links are host-local, so a new host clears them.
      return {
        ...state,
        serverId: action.serverId,
        projectId: null,
        projectDisplay: null,
        goalId: null,
        parent: null,
        blockers: [],
      };
    case "project":
      return { ...state, projectId: action.projectId, projectDisplay: action.display };
    case "title":
      return { ...state, title: action.value };
    case "notes":
      return { ...state, notes: action.value };
    case "addCriterion":
      return { ...state, criteria: [...state.criteria, toCriterionRow({ text: "", met: false })] };
    case "criterionText":
      return {
        ...state,
        criteria: state.criteria.map((row) =>
          row.key === action.key ? { ...row, text: action.text } : row,
        ),
      };
    case "removeCriterion":
      return { ...state, criteria: state.criteria.filter((row) => row.key !== action.key) };
    case "attachments":
      return { ...state, attachments: action.attachments };
    case "parent":
      return { ...state, parent: action.parent };
    case "blockers":
      return { ...state, blockers: action.blockers };
    case "readyFor":
      return { ...state, readyFor: action.value };
    case "stage":
      return { ...state, stage: action.value };
    case "goal":
      return { ...state, goalId: action.goalId };
    case "toggleDependencies":
      return { ...state, showDependencies: !state.showDependencies };
    case "submission":
      return { ...state, submission: action.submission };
  }
}

const NO_TASKS: ReadonlyMap<string, BoardTask> = new Map();
const NO_GOALS: ReadonlyMap<string, BoardGoal> = new Map();
const NO_GOAL = "";

type ReadyFor = BoardTask["readyFor"];
type Stage = BoardTask["stage"];

/** A checklist row in the form. `key` keeps a row's text input mounted while others change. */
interface CriterionRow extends BoardTaskCriterion {
  key: number;
}

let nextCriterionKey = 0;

function toCriterionRow(criterion: BoardTaskCriterion): CriterionRow {
  nextCriterionKey += 1;
  return { key: nextCriterionKey, text: criterion.text, met: criterion.met };
}

/** Blank rows are dropped; editing a row's text keeps whether it was met. */
function toCriteria(rows: readonly CriterionRow[]): BoardTaskCriterion[] {
  return rows.flatMap((row) => {
    const text = row.text.trim();
    return text ? [{ text, met: row.met }] : [];
  });
}

/** The host's tasks and goals, empty until the host is ready. */
function useHostPlanning(serverId: string): {
  tasks: ReadonlyMap<string, BoardTask>;
  goals: ReadonlyMap<string, BoardGoal>;
} {
  const host = useBoardTasks((store) => store.hosts[serverId]);
  if (host?.status !== "ready") return { tasks: NO_TASKS, goals: NO_GOALS };
  return { tasks: host.tasks, goals: host.goals };
}

function readHostTasks(serverId: string): ReadonlyMap<string, BoardTask> {
  const host = useBoardTasks.getState().hosts[serverId];
  return host?.status === "ready" ? host.tasks : NO_TASKS;
}

function projectLabel(project: ProjectDescriptor): string {
  return project.projectCustomName ?? project.projectDisplayName;
}

function forgeItemOptionId(item: Pick<ForgeSearchItem, "kind" | "number">): string {
  return `${item.kind}:${item.number}`;
}

function attachmentOptionId(attachment: BoardTaskAttachment): string {
  const kind = attachment.type === "forge_issue" ? "issue" : "change_request";
  return forgeItemOptionId({ kind, number: attachment.number });
}

/** Tasks keep only forge references, so other attachment kinds never reach the form. */
function isBoardTaskAttachment(attachment: AgentAttachment): attachment is BoardTaskAttachment {
  return attachment.type === "forge_issue" || attachment.type === "forge_change_request";
}

function toggleForgeAttachment(
  attachments: readonly BoardTaskAttachment[],
  item: ForgeSearchItem,
): BoardTaskAttachment[] {
  const optionId = forgeItemOptionId(item);
  const remaining = attachments.filter((attachment) => attachmentOptionId(attachment) !== optionId);
  if (remaining.length < attachments.length) return remaining;
  const attachment = buildForgeAttachmentFromSearchItem(item);
  return attachment && isBoardTaskAttachment(attachment) ? [...attachments, attachment] : remaining;
}

function findProjectDisplay(input: {
  hosts: readonly BoardTaskSheetHost[];
  serverId: string;
  projectId: string | null;
}): SelectFieldDisplay | null {
  const project = input.hosts
    .find((host) => host.serverId === input.serverId)
    ?.projects.find((candidate) => candidate.projectId === input.projectId);
  return project ? { label: projectLabel(project) } : null;
}

function openForm(input: {
  target: BoardTaskSheetTarget;
  hosts: readonly BoardTaskSheetHost[];
}): FormState {
  const { target, hosts } = input;
  if (target.mode === "create") {
    const preferredHost = hosts.find((host) => host.serverId === target.serverId);
    const serverId = preferredHost?.serverId ?? hosts[0]?.serverId ?? "";
    const projectId = preferredHost ? (target.projectId ?? null) : null;
    const parent = preferredHost
      ? toBoardTaskRef(readHostTasks(serverId), target.parentId ?? null)
      : null;
    return {
      serverId,
      projectId,
      projectDisplay: findProjectDisplay({ hosts, serverId, projectId }),
      title: target.title ?? "",
      notes: target.notes ?? "",
      criteria: [],
      attachments: target.attachments ?? [],
      parent,
      blockers: [],
      readyFor: "agent",
      stage: target.stage ?? "fog",
      goalId: preferredHost ? (target.goalId ?? null) : null,
      showDependencies: parent !== null,
      submission: { status: "idle" },
    };
  }
  const tasks = readHostTasks(target.serverId);
  const blockers = target.task.blockedBy.flatMap((id) => toBoardTaskRef(tasks, id) ?? []);
  return {
    serverId: target.serverId,
    projectId: target.task.projectId,
    projectDisplay: findProjectDisplay({
      hosts,
      serverId: target.serverId,
      projectId: target.task.projectId,
    }),
    title: target.task.title,
    notes: target.task.notes,
    criteria: target.task.acceptanceCriteria.map(toCriterionRow),
    attachments: target.task.attachments,
    parent: toBoardTaskRef(tasks, target.task.parentId),
    blockers,
    readyFor: target.task.readyFor,
    stage: target.task.stage,
    goalId: target.task.goalId,
    showDependencies: target.task.parentId !== null || blockers.length > 0,
    submission: { status: "idle" },
  };
}

/** Stage only orders planned work; started or finished tasks have left planning. */
function isPlanned(target: BoardTaskSheetTarget): boolean {
  return (
    target.mode === "create" ||
    (target.task.workspaceId === null && target.task.completedAt === null)
  );
}

/** Mount once per open; the parent keys it so create and edit never share an instance. */
export function BoardTaskSheet({
  target,
  visible,
  hosts,
  onClose,
  onDismiss,
}: BoardTaskSheetProps): ReactElement {
  const { t } = useTranslation();
  const controlSize: ControlSize = "md";
  const [state, dispatch] = useReducer(reduceForm, { target, hosts }, openForm);
  const isEdit = target.mode === "edit";
  // A started task follows its workspace's project.
  const showProject = !(target.mode === "edit" && target.task.workspaceId !== null);
  const showStage = isPlanned(target);
  const isSubmitting = state.submission.status === "submitting";
  // Hosts can arrive after the sheet opens; until one is chosen, create on the first.
  const serverId = state.serverId || hosts[0]?.serverId || "";
  const canSubmit = state.title.trim().length > 0 && serverId !== "" && !isSubmitting;
  const { tasks, goals } = useHostPlanning(serverId);
  const editingTaskId = target.mode === "edit" ? target.task.id : null;

  const selectedHost = hosts.find((host) => host.serverId === serverId) ?? null;
  const hostOptions = useMemo<SelectFieldOption<string>[]>(
    () => hosts.map((host) => ({ id: host.serverId, value: host.serverId, label: host.label })),
    [hosts],
  );
  const hostDisplay = useMemo<SelectFieldDisplay | null>(
    () => (selectedHost ? { label: selectedHost.label } : null),
    [selectedHost],
  );
  const projectOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const projects = selectedHost?.projects ?? [];
    return [
      { id: "none", value: "", label: t("board.form.noProject") },
      ...projects.map((project) => ({
        id: project.projectId,
        value: project.projectId,
        label: projectLabel(project),
      })),
    ];
  }, [selectedHost, t]);

  const selectHost = useCallback((nextServerId: string) => {
    dispatch({ type: "host", serverId: nextServerId });
  }, []);
  const selectProject = useCallback((projectId: string, display: SelectFieldDisplay) => {
    dispatch({ type: "project", projectId: projectId || null, display });
  }, []);
  const changeTitle = useCallback((value: string) => dispatch({ type: "title", value }), []);
  const changeNotes = useCallback((value: string) => dispatch({ type: "notes", value }), []);
  const addCriterion = useCallback(() => dispatch({ type: "addCriterion" }), []);
  const changeCriterion = useCallback(
    (key: number, text: string) => dispatch({ type: "criterionText", key, text }),
    [],
  );
  const removeCriterion = useCallback(
    (key: number) => dispatch({ type: "removeCriterion", key }),
    [],
  );
  const changeParent = useCallback(
    (parent: BoardTaskRef | null) => dispatch({ type: "parent", parent }),
    [],
  );
  const changeBlockers = useCallback(
    (blockers: BoardTaskRef[]) => dispatch({ type: "blockers", blockers }),
    [],
  );
  const changeReadyFor = useCallback(
    (value: ReadyFor) => dispatch({ type: "readyFor", value }),
    [],
  );
  const readyForOptions = useMemo<SegmentedControlOption<ReadyFor>[]>(
    () => [
      { value: "agent", label: t("board.plan.readyForAgent"), testID: "board-task-ready-agent" },
      { value: "human", label: t("board.plan.readyForHuman"), testID: "board-task-ready-human" },
    ],
    [t],
  );
  const changeStage = useCallback((value: Stage) => dispatch({ type: "stage", value }), []);
  const changeGoal = useCallback((goalId: string | null) => dispatch({ type: "goal", goalId }), []);
  const toggleDependencies = useCallback(() => dispatch({ type: "toggleDependencies" }), []);
  const changeAttachments = useCallback(
    (attachments: BoardTaskAttachment[]) => dispatch({ type: "attachments", attachments }),
    [],
  );
  // Forge search runs in the project's checkout, so attaching needs a project.
  const projectRootPath =
    selectedHost?.projects.find((project) => project.projectId === state.projectId)
      ?.projectRootPath ?? null;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    dispatch({ type: "submission", submission: { status: "submitting" } });
    const planning = {
      acceptanceCriteria: toCriteria(state.criteria),
      parentId: state.parent?.id ?? null,
      blockedBy: state.blockers.map((blocker) => blocker.id),
      readyFor: state.readyFor,
      goalId: state.goalId,
      ...(showStage ? { stage: state.stage } : {}),
    };
    try {
      if (target.mode === "create") {
        await createBoardTask(serverId, {
          title: state.title,
          notes: state.notes,
          projectId: state.projectId,
          attachments: state.attachments,
          ...planning,
        });
      } else {
        await updateBoardTask(target.serverId, {
          taskId: target.task.id,
          title: state.title,
          notes: state.notes,
          attachments: state.attachments,
          ...planning,
          ...(showProject ? { projectId: state.projectId } : {}),
        });
      }
      dispatch({ type: "submission", submission: { status: "idle" } });
      onClose();
    } catch (error) {
      dispatch({
        type: "submission",
        submission: { status: "failed", message: toErrorMessage(error) },
      });
    }
  }, [canSubmit, onClose, serverId, showProject, showStage, state, target]);
  const submitPress = useCallback(() => {
    void submit();
  }, [submit]);

  const header = useMemo<SheetHeader>(
    () => ({ title: isEdit ? t("board.form.editTitle") : t("board.form.createTitle") }),
    [isEdit, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSubmitting}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={submitPress}
          disabled={!canSubmit}
          loading={isSubmitting}
          testID="board-task-submit"
        >
          {isEdit ? t("board.form.save") : t("board.form.create")}
        </Button>
      </View>
    ),
    [canSubmit, isEdit, isSubmitting, onClose, submitPress, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      dismissible={!isSubmitting}
      footer={footer}
      testID="board-task-sheet"
    >
      <View style={styles.body}>
        {!isEdit && hosts.length > 1 ? (
          <SelectField
            label={t("board.form.host")}
            value={serverId}
            selectedDisplay={hostDisplay}
            options={hostOptions}
            onChange={selectHost}
            placeholder={t("board.form.hostPlaceholder")}
            emptyText={t("board.form.noHosts")}
            title={t("board.form.host")}
            size={controlSize}
            triggerTestID="board-task-host"
          />
        ) : null}
        <Field label={t("board.form.title")}>
          <FormTextInput
            size={controlSize}
            initialValue={state.title}
            onChangeText={changeTitle}
            placeholder={t("board.form.titlePlaceholder")}
            accessibilityLabel={t("board.form.title")}
            maxLength={200}
            testID="board-task-title"
          />
        </Field>
        <Field label={t("board.form.notes")}>
          <FormTextInput
            size={controlSize}
            initialValue={state.notes}
            onChangeText={changeNotes}
            placeholder={t("board.form.notesPlaceholder")}
            accessibilityLabel={t("board.form.notes")}
            style={styles.notesInput}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            testID="board-task-notes"
          />
        </Field>
        <BoardTaskCriteria
          rows={state.criteria}
          onAdd={addCriterion}
          onChange={changeCriterion}
          onRemove={removeCriterion}
          size={controlSize}
        />
        {showProject ? (
          <SelectField
            label={t("board.form.project")}
            value={state.projectId ?? ""}
            selectedDisplay={state.projectDisplay}
            options={projectOptions}
            onChange={selectProject}
            placeholder={t("board.form.noProject")}
            emptyText={t("board.form.noProjects")}
            searchable
            searchPlaceholder={t("board.form.searchProjects")}
            title={t("board.form.project")}
            size={controlSize}
            triggerTestID="board-task-project"
          />
        ) : null}
        <BoardTaskAttachments
          serverId={serverId}
          cwd={projectRootPath}
          attachments={state.attachments}
          onChange={changeAttachments}
          size={controlSize}
        />
        <BoardTaskStage
          visible={showStage}
          value={state.stage}
          onChange={changeStage}
          size={controlSize}
        />
        <BoardTaskGoal
          goals={goals}
          value={state.goalId}
          onChange={changeGoal}
          size={controlSize}
        />
        <Field label={t("board.plan.readyFor")}>
          <SegmentedControl
            options={readyForOptions}
            value={state.readyFor}
            onValueChange={changeReadyFor}
            size={controlSize}
            testID="board-task-ready-for"
          />
        </Field>
        <BoardTaskDependencies
          tasks={tasks}
          taskId={editingTaskId}
          expanded={state.showDependencies}
          onToggle={toggleDependencies}
          parent={state.parent}
          onParentChange={changeParent}
          blockers={state.blockers}
          onBlockersChange={changeBlockers}
          size={controlSize}
        />
        {state.submission.status === "failed" ? (
          <Text style={styles.submitError}>{state.submission.message}</Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

/** Fog or Ready; only Ready tasks are on the frontier for agents and goal Autopilot. */
function BoardTaskStage({
  visible,
  value,
  onChange,
  size,
}: {
  visible: boolean;
  value: Stage;
  onChange: (value: Stage) => void;
  size: ControlSize;
}): ReactElement | null {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<Stage>[]>(
    () => [
      { value: "fog", label: t("board.plan2.task.fog"), testID: "board-task-stage-fog" },
      { value: "ready", label: t("board.plan2.task.ready"), testID: "board-task-stage-ready" },
    ],
    [t],
  );
  if (!visible) return null;
  return (
    <Field label={t("board.plan2.task.stage")} hint={t("board.plan2.task.stageHint")}>
      <SegmentedControl
        options={options}
        value={value}
        onValueChange={onChange}
        size={size}
        testID="board-task-stage"
      />
    </Field>
  );
}

function goalLabel(goal: BoardGoal): string {
  return `G-${goal.number} ${goal.title}`;
}

/** The goal the task serves: the host's unlanded goals, plus the current one if it has landed. */
function BoardTaskGoal({
  goals,
  value,
  onChange,
  size,
}: {
  goals: ReadonlyMap<string, BoardGoal>;
  value: string | null;
  onChange: (goalId: string | null) => void;
  size: ControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const offered = [...goals.values()]
      .filter((goal) => goal.landedAt === null || goal.id === value)
      .sort((a, b) => a.rank - b.rank);
    return [
      { id: "none", value: NO_GOAL, label: t("board.plan2.task.noGoal") },
      ...offered.map((goal) => ({ id: goal.id, value: goal.id, label: goalLabel(goal) })),
    ];
  }, [goals, t, value]);
  const display = useMemo<SelectFieldDisplay>(() => {
    const goal = value ? goals.get(value) : undefined;
    return { label: goal ? goalLabel(goal) : t("board.plan2.task.noGoal") };
  }, [goals, t, value]);
  const select = useCallback((goalId: string) => onChange(goalId || null), [onChange]);
  return (
    <SelectField
      label={t("board.plan2.task.goal")}
      value={value ?? NO_GOAL}
      selectedDisplay={display}
      options={options}
      onChange={select}
      placeholder={t("board.plan2.task.noGoal")}
      emptyText={t("board.plan2.task.noGoals")}
      searchable
      searchPlaceholder={t("board.plan2.task.searchGoals")}
      title={t("board.plan2.task.goal")}
      size={size}
      triggerTestID="board-task-goal"
    />
  );
}

interface BoardTaskCriteriaProps {
  rows: readonly CriterionRow[];
  onAdd: () => void;
  onChange: (key: number, text: string) => void;
  onRemove: (key: number) => void;
  size: ControlSize;
}

/** The acceptance checklist. The agent ticks rows when it reports, so the form only edits text. */
function BoardTaskCriteria({
  rows,
  onAdd,
  onChange,
  onRemove,
  size,
}: BoardTaskCriteriaProps): ReactElement {
  const { t } = useTranslation();
  return (
    <Field label={t("board.plan.acceptanceCriteria")}>
      <View style={styles.criteria}>
        {rows.map((row) => (
          <BoardTaskCriterionRow
            key={row.key}
            row={row}
            onChange={onChange}
            onRemove={onRemove}
            size={size}
          />
        ))}
        <Button
          variant="ghost"
          size={size}
          leftIcon={Plus}
          onPress={onAdd}
          style={styles.attachButton}
          testID="board-task-add-criterion"
        >
          {t("board.plan.addCriterion")}
        </Button>
      </View>
    </Field>
  );
}

function BoardTaskCriterionRow({
  row,
  onChange,
  onRemove,
  size,
}: {
  row: CriterionRow;
  onChange: (key: number, text: string) => void;
  onRemove: (key: number) => void;
  size: ControlSize;
}): ReactElement {
  const { t } = useTranslation();
  const change = useCallback((text: string) => onChange(row.key, text), [onChange, row.key]);
  const remove = useCallback(() => onRemove(row.key), [onRemove, row.key]);
  return (
    <View style={styles.criterionRow} testID="board-task-criterion">
      {row.met ? (
        <Check
          size={styles.metIcon.width}
          color={styles.metIcon.color}
          accessibilityLabel={t("board.plan.criterionMet")}
        />
      ) : null}
      <View style={styles.criterionInput}>
        <FormTextInput
          size={size}
          initialValue={row.text}
          onChangeText={change}
          placeholder={t("board.plan.criterionPlaceholder")}
          accessibilityLabel={t("board.plan.acceptanceCriteria")}
          autoFocus={row.text === ""}
          testID="board-task-criterion-text"
        />
      </View>
      <Button
        variant="ghost"
        size={size}
        leftIcon={X}
        onPress={remove}
        accessibilityLabel={t("board.plan.removeCriterion")}
        testID="board-task-remove-criterion"
      />
    </View>
  );
}

interface BoardTaskAttachmentsProps {
  serverId: string;
  /** Checkout the forge search runs in; null until the task has a project. */
  cwd: string | null;
  attachments: BoardTaskAttachment[];
  onChange: (attachments: BoardTaskAttachment[]) => void;
  size: ControlSize;
}

/** Issues and PRs handed to the first prompt, picked with the composer's forge search. */
function BoardTaskAttachments({
  serverId,
  cwd,
  attachments,
  onChange,
  size,
}: BoardTaskAttachmentsProps): ReactElement {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsForgeSearch = useHostFeature(serverId, "forgeSearch");
  const trimmedQuery = query.trim();
  const search = useForgeSearchQuery({
    client,
    serverId,
    cwd: cwd ?? "",
    query: trimmedQuery,
    supportsForgeSearch,
    enabled: open && isConnected && cwd !== null,
  });
  const itemsRaw = search.data?.items;
  const items = useMemo(() => itemsRaw ?? [], [itemsRaw]);
  const options = useMemo<ComboboxOption[]>(
    () =>
      items.map((item) => {
        const presentation = getForgePresentation(item.forge ?? "github");
        const numberPrefix =
          item.kind === "change_request"
            ? presentation.numberPrefix
            : presentation.issueNumberPrefix;
        return {
          id: forgeItemOptionId(item),
          label: `${numberPrefix}${item.number} ${item.title}`,
          // The host already matched the query; repeating it keeps the local filter from hiding results.
          description: trimmedQuery,
        };
      }),
    [items, trimmedQuery],
  );
  const attachedIds = useMemo(() => new Set(attachments.map(attachmentOptionId)), [attachments]);

  const selectItem = useCallback(
    (id: string) => {
      const item = items.find((candidate) => forgeItemOptionId(candidate) === id);
      if (!item) return;
      onChange(toggleForgeAttachment(attachments, item));
      setOpen(false);
      setQuery("");
    },
    [attachments, items, onChange],
  );
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);
  const openPicker = useCallback(() => setOpen(true), []);
  const removeAttachment = useCallback(
    (attachment: BoardTaskAttachment) =>
      onChange(attachments.filter((candidate) => candidate !== attachment)),
    [attachments, onChange],
  );
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
        testID={`board-task-issue-option-${option.id}`}
        label={option.label}
        selected={attachedIds.has(option.id)}
        active={active}
        onPress={onPress}
      />
    ),
    [attachedIds],
  );

  return (
    <Field
      label={t("board.capture.attachments")}
      hint={cwd === null ? t("board.capture.attachNeedsProject") : undefined}
    >
      <View style={styles.attachmentsBody}>
        {attachments.length > 0 ? (
          <View style={styles.attachments}>
            {attachments.map((attachment, index) => (
              <BoardTaskAttachmentPill
                key={attachmentOptionId(attachment) ?? String(index)}
                attachment={attachment}
                onRemove={removeAttachment}
              />
            ))}
          </View>
        ) : null}
        <View ref={anchorRef} collapsable={false} style={styles.attachButton}>
          <Button
            variant="outline"
            size={size}
            leftIcon={Link}
            onPress={openPicker}
            disabled={cwd === null}
            testID="board-task-attach-issue"
          >
            {t("board.capture.attachIssue")}
          </Button>
        </View>
      </View>
      <Combobox
        options={options}
        value=""
        onSelect={selectItem}
        searchable
        searchPlaceholder={t("composer.github.searchPlaceholder")}
        title={t("composer.github.title")}
        open={open}
        onOpenChange={changeOpen}
        onSearchQueryChange={setQuery}
        anchorRef={anchorRef}
        emptyText={
          search.isFetching ? t("composer.github.searching") : t("composer.github.noResults")
        }
        renderOption={renderOption}
      />
    </Field>
  );
}

function BoardTaskAttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: BoardTaskAttachment;
  onRemove: (attachment: BoardTaskAttachment) => void;
}): ReactElement {
  const { t } = useTranslation();
  const content = getAgentAttachmentPillContent(attachment, t);
  const url = "url" in attachment ? attachment.url : null;
  const open = useCallback(() => {
    if (url) void openExternalUrl(url);
  }, [url]);
  const remove = useCallback(() => onRemove(attachment), [attachment, onRemove]);
  return (
    <AttachmentPill
      onOpen={open}
      onRemove={remove}
      openAccessibilityLabel={t("board.capture.openAttachment", { title: content.title })}
      removeAccessibilityLabel={t("board.capture.removeAttachment", { title: content.title })}
      testID="board-task-attachment"
    >
      <AttachmentLabel icon={content.icon} title={content.title} subtitle={content.subtitle} />
    </AttachmentPill>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  attachmentsBody: {
    gap: theme.spacing[2],
  },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  attachButton: {
    alignSelf: "flex-start",
  },
  notesInput: {
    minHeight: 112,
  },
  criteria: {
    gap: theme.spacing[2],
  },
  criterionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  criterionInput: {
    flex: 1,
  },
  // Static color holder read by the icon's props; keeps theme tokens without useUnistyles.
  metIcon: {
    color: theme.colors.palette.green[400],
    width: theme.iconSize.md,
  },
  submitError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
