import type { BoardGoal, BoardTask } from "@getpaseo/protocol/messages";

type BoardTaskReadyFor = NonNullable<BoardTask["readyFor"]>;
type BoardTaskStage = NonNullable<BoardTask["stage"]>;

/**
 * One line typed into the Desk capture bar, read as a task.
 * Tokens: `#goal` picks a goal by title, `!` marks it for a human, `~` keeps it as an idea (Fog).
 */
export interface DeskCapture {
  title: string;
  goal: BoardGoal | null;
  /** The `#query` that matched no goal, so the bar can say so instead of dropping it. */
  unmatchedGoal: string | null;
  readyFor: BoardTaskReadyFor | null;
  stage: BoardTaskStage;
}

/** The token being typed at the end of the line, for goal suggestions. */
export interface DeskCaptureGoalQuery {
  query: string;
  start: number;
}

const GOAL_TOKEN = /(^|\s)#(\S+)/g;
const HUMAN_TOKEN = /(^|\s)!(?=\s|$)/g;
const IDEA_TOKEN = /(^|\s)~(?=\s|$)/g;

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** Goal tokens can't hold spaces, so `#auth-rework` and `#auth` both match "Auth rework". */
export function matchCaptureGoal(query: string, goals: readonly BoardGoal[]): BoardGoal | null {
  const wanted = normalize(query).replace(/[-_]/g, " ");
  if (!wanted) return null;
  const open = goals.filter((goal) => goal.landedAt === null);
  return (
    open.find((goal) => normalize(goal.title) === wanted) ??
    open.find((goal) => normalize(goal.title).startsWith(wanted)) ??
    open.find((goal) => normalize(goal.title).includes(wanted)) ??
    null
  );
}

export function parseDeskCapture(text: string, goals: readonly BoardGoal[]): DeskCapture {
  let goal: BoardGoal | null = null;
  let unmatchedGoal: string | null = null;
  let title = text.replace(GOAL_TOKEN, (_match, lead: string, query: string) => {
    const found = matchCaptureGoal(query, goals);
    if (found) goal = found;
    else unmatchedGoal = query;
    return lead;
  });
  const human = HUMAN_TOKEN.test(title);
  title = title.replace(HUMAN_TOKEN, "$1");
  const idea = IDEA_TOKEN.test(title);
  title = title.replace(IDEA_TOKEN, "$1");
  HUMAN_TOKEN.lastIndex = 0;
  IDEA_TOKEN.lastIndex = 0;
  return {
    title: title.replace(/\s+/g, " ").trim(),
    goal,
    unmatchedGoal: goal ? null : unmatchedGoal,
    readyFor: human ? "human" : null,
    stage: idea ? "fog" : "ready",
  };
}

/** The `#query` under the caret when the caret sits at the end of the line. */
export function currentGoalQuery(text: string): DeskCaptureGoalQuery | null {
  const match = /(^|\s)#(\S*)$/.exec(text);
  if (!match) return null;
  return { query: match[2] ?? "", start: match.index + match[1].length };
}

export function suggestCaptureGoals(query: string, goals: readonly BoardGoal[]): BoardGoal[] {
  const wanted = normalize(query).replace(/[-_]/g, " ");
  return goals
    .filter((goal) => goal.landedAt === null)
    .filter((goal) => !wanted || normalize(goal.title).includes(wanted))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);
}

/** Replaces the trailing `#query` with a token for the chosen goal. */
export function completeGoalToken(text: string, goal: BoardGoal): string {
  const current = currentGoalQuery(text);
  if (!current) return text;
  const token = goal.title.trim().replace(/\s+/g, "-");
  return `${text.slice(0, current.start)}#${token} `;
}
