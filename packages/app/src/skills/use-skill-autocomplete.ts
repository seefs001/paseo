import { useCallback, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption, AutocompleteStatus } from "@/components/ui/autocomplete";
import type {
  AgentAutocompleteInputSnapshot,
  AgentAutocompleteKeyPressEvent,
  UseAgentAutocompleteInput,
} from "@/hooks/use-agent-autocomplete";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { applySkillReplacement, filterSkills, findActiveSkill, rankSkills } from "./autocomplete";

function buildSkillAutocompleteMenu(input: {
  options: AutocompleteOption[];
  errorMessage: string | undefined;
  isLoading: boolean;
  loadingText: string;
  emptyText: string;
}): { options: AutocompleteOption[]; status: AutocompleteStatus | null } {
  if (input.errorMessage) {
    return { options: [], status: { kind: "error", title: input.errorMessage } };
  }
  if (input.isLoading) {
    return { options: [], status: { kind: "loading", message: input.loadingText } };
  }
  if (input.options.length === 0) {
    return { options: [], status: { kind: "empty", message: input.emptyText } };
  }
  return { options: input.options, status: null };
}

export function useSkillAutocomplete(input: UseAgentAutocompleteInput) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId);
  const connected = useHostRuntimeIsConnected(input.serverId);
  // COMPAT(skillCatalog): added after v0.9.1, remove gate after 2027-09-24.
  const supported = useHostFeature(input.serverId, "skillCatalog");
  const retainedPanelActive = useRetainedPanelActive();
  const range = findActiveSkill({ text: input.userInput, cursorIndex: input.cursorIndex });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const inputKey = `${input.cursorIndex}:${input.userInput}`;
  if (dismissed !== null && dismissed !== inputKey) setDismissed(null);
  const isActive = range !== null;
  const isVisible = isActive && dismissed !== inputKey && retainedPanelActive;
  const query = useFetchQuery({
    queryKey: ["host", input.serverId, "skill-catalog"],
    queryFn: () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.listSkills();
    },
    enabled: isVisible && supported && connected && client !== null,
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
  });
  const search = range?.query ?? "";
  const rankedSkills = useMemo(
    () => rankSkills(query.data?.skills ?? [], ""),
    [query.data?.skills],
  );
  const options = useMemo<AutocompleteOption[]>(
    () =>
      filterSkills(rankedSkills, search).map((skill) => ({
        id: skill.path,
        label: `$${skill.name}`,
        description: skill.description || t("skillPicker.noDescription"),
        detail: skill.userInvoked
          ? `${t("skillPicker.userInvoked")} · ${t("skillPicker.usage", { count: skill.usageCount })}`
          : t("skillPicker.usage", { count: skill.usageCount }),
        kind: "skill",
      })),
    [rankedSkills, search, t],
  );
  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      const text = snapshot?.text ?? input.userInput;
      const cursorIndex = snapshot?.selection.start ?? input.cursorIndex;
      const current = findActiveSkill({ text, cursorIndex });
      const skill = query.data?.skills.find((entry) => entry.path === option.id);
      if (!current || !skill || !connected || !supported) return;
      input.setUserInput(applySkillReplacement({ text, range: current, skill }));
      input.onAutocompleteApplied?.();
    },
    [input, query.data, connected, supported],
  );
  const onEscape = useCallback(() => setDismissed(inputKey), [inputKey]);
  let errorMessage: string | undefined;
  if (!connected) errorMessage = t("workspace.terminal.hostDisconnected");
  else if (!supported) errorMessage = t("skillPicker.updateHost");
  else if (query.error) errorMessage = t("skillPicker.loadFailed");
  const directory = query.data?.directory ?? "~/.agents/skills";
  let emptyText = t("skillPicker.noMatches");
  if (query.data?.skills.length === 0) emptyText = t("skillPicker.empty", { directory });
  const isLoading = supported && connected && query.isPending;
  const menu = buildSkillAutocompleteMenu({
    options,
    errorMessage,
    isLoading,
    loadingText: t("skillPicker.loading"),
    emptyText,
  });
  const keyboard = useAutocomplete<AutocompleteOption, AgentAutocompleteKeyPressEvent>({
    isVisible,
    options: menu.options,
    query: search,
    // Skills read top to bottom by frequency, including in the above-input popover.
    optionsPosition: "below-input",
    onSelectOption: (option, event) => onSelectOption(option, event?.input),
    onEscape,
  });
  return {
    isActive,
    isVisible,
    ...menu,
    selectedIndex: keyboard.selectedIndex,
    onSelectOption,
    onKeyPress: (event: AgentAutocompleteKeyPressEvent) => {
      // The input publishes text after paint; a second Enter can precede that publication.
      const current = findActiveSkill({
        text: event.input.text,
        cursorIndex: event.input.selection.start,
      });
      if (!current) return false;
      if (keyboard.onKeyPress(event)) return true;
      if (isVisible && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  };
}
