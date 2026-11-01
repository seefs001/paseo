import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { OverviewSummary } from "./model";

/**
 * Joins the parts with the locale's own list grammar: English puts spaces and a serial comma
 * around "and", Chinese joins with "，并" and no spaces.
 */
function joinSummaryParts(parts: string[], t: TFunction): string {
  if (parts.length === 0) {
    return "";
  }
  let joined = parts[0] ?? "";
  if (parts.length === 2) {
    joined = t("toolCallGroup.listPair", { first: parts[0], second: parts[1] });
  } else if (parts.length > 2) {
    joined = t("toolCallGroup.listLast", {
      rest: parts.slice(0, -1).join(t("toolCallGroup.listSeparator")),
      last: parts.at(-1),
    });
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

/**
 * One sentence of what a stretch of agent work did, such as "Edited 2 files and ran 3 commands".
 * Leading parts come first, for summaries that count more than tool calls.
 */
export function useOverviewSummaryLabel(
  summary: OverviewSummary,
  leadingParts: readonly string[] = [],
): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const parts = [...leadingParts];
    const entries = [
      [summary.editedFileCount, "toolCallGroup.editedFiles"],
      [summary.commandCount, "toolCallGroup.commands"],
      [summary.readFileCount, "toolCallGroup.readFiles"],
      [summary.searchCount, "toolCallGroup.searches"],
      [summary.otherToolCount, "toolCallGroup.otherTools"],
    ] as const;
    for (const [count, key] of entries) {
      if (count > 0) {
        parts.push(t(`${key}.${count === 1 ? "one" : "other"}`, { count }));
      }
    }
    for (const [action, count] of Object.entries(summary.paseoActions)) {
      parts.push(
        count === 1 ? action.toLocaleLowerCase() : `${action.toLocaleLowerCase()} ×${count}`,
      );
    }
    // Reasoning stays in the details; it is not an action in a work summary.
    // Keep a label for a group containing only reasoning.
    if (parts.length === 0 && summary.thoughtCount > 0) return t("toolCallGroup.thought");
    return joinSummaryParts(parts, t);
  }, [leadingParts, summary, t]);
}
