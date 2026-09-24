import { useCallback, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import type {
  AgentAutocompleteInputSnapshot,
  AgentAutocompleteKeyPressEvent,
  UseAgentAutocompleteInput,
} from "@/hooks/use-agent-autocomplete";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { applySkillReplacement, findActiveSkill, rankSkills } from "./autocomplete";

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
  const options = useMemo<AutocompleteOption[]>(
    () =>
      rankSkills(query.data?.skills ?? [], search).map((skill) => ({
        id: skill.path,
        label: `$${skill.name}`,
        description: skill.description || t("skillPicker.noDescription"),
        detail: t("skillPicker.usage", { count: skill.usageCount }),
        kind: "skill",
      })),
    [query.data, search, t],
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
  const keyboard = useAutocomplete<AutocompleteOption, AgentAutocompleteKeyPressEvent>({
    isVisible,
    options,
    query: search,
    // Skills read top to bottom by frequency, including in the above-input popover.
    optionsPosition: "below-input",
    onSelectOption: (option, event) => onSelectOption(option, event?.input),
    onEscape,
  });
  let errorMessage: string | undefined;
  if (!connected) errorMessage = t("workspace.terminal.hostDisconnected");
  else if (!supported) errorMessage = t("skillPicker.updateHost");
  else if (query.error) errorMessage = t("skillPicker.loadFailed");
  const directory = query.data?.directory ?? "~/.agents/skills";
  let emptyText = t("skillPicker.noMatches");
  if (query.data?.skills.length === 0) emptyText = t("skillPicker.empty", { directory });
  return {
    isActive,
    isVisible,
    options: errorMessage ? [] : options,
    selectedIndex: keyboard.selectedIndex,
    isLoading: supported && connected && query.isPending,
    errorMessage,
    loadingText: t("skillPicker.loading"),
    emptyText,
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
