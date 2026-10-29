import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { useAgentProfiles } from "@/agent-profiles";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type {
  AgentAutocompleteInputSnapshot,
  AgentAutocompleteKeyPressEvent,
  UseAgentAutocompleteInput,
} from "@/hooks/use-agent-autocomplete";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import {
  findActiveProfileMention,
  rankAgentProfileMentions,
  type AgentProfileMention,
  type SessionMentionRange,
} from "@/utils/session-mention-autocomplete";
import { profileReferenceLabel, type ProfileReferenceRange } from "./model";

export interface ProfileReferenceSelection {
  /** The live text the mention range indexes into. */
  text: string;
  mention: SessionMentionRange;
  profile: AgentProfile;
}

const NO_RANGES: readonly ProfileReferenceRange[] = [];
const NO_PROFILES: readonly AgentProfile[] = [];

export function findProfileReferenceMention(input: {
  text: string;
  cursorIndex: number;
  boundRanges: readonly ProfileReferenceRange[];
}): SessionMentionRange | null {
  const mention = findActiveProfileMention(input);
  if (!mention) return null;
  // A caret inside or at the end of a bound reference sees its `#`; that token is already chosen.
  const isBound = input.boundRanges.some(
    (range) => mention.start >= range.start && mention.start < range.end,
  );
  return isBound ? null : mention;
}

function profileOption(profile: AgentProfileMention): AutocompleteOption {
  const model = profile.model?.trim();
  const notes = profile.notes?.trim().split("\n")[0]?.trim();
  return {
    id: profile.id,
    label: profileReferenceLabel(profile),
    detail: model ? `${profile.provider} · ${model}` : profile.provider,
    ...(notes ? { description: notes } : {}),
    kind: "agent",
  };
}

export function useProfileReferenceAutocomplete(input: UseAgentAutocompleteInput) {
  const { t } = useTranslation();
  const { profiles, isSupported } = useAgentProfiles(input.serverId);
  const retainedPanelActive = useRetainedPanelActive();
  const boundRanges = input.boundReferenceRanges ?? NO_RANGES;
  const onSelected = input.onProfileReferenceSelected;
  const available = profiles ?? NO_PROFILES;
  const canReference = onSelected !== undefined && isSupported && available.length > 0;
  const mention = canReference
    ? findProfileReferenceMention({
        text: input.userInput,
        cursorIndex: input.cursorIndex,
        boundRanges,
      })
    : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const inputKey = `${input.cursorIndex}:${input.userInput}`;
  if (dismissed !== null && dismissed !== inputKey) setDismissed(null);
  const isActive = mention !== null;
  const query = mention?.query ?? "";
  const options = useMemo(
    () =>
      isActive
        ? orderAutocompleteOptions(
            rankAgentProfileMentions({ profiles: available, query }).map(profileOption),
          )
        : [],
    [available, isActive, query],
  );
  // `#` is common in prose (headings, colours, tags); with nothing to offer the panel stays shut.
  const isVisible = isActive && options.length > 0 && dismissed !== inputKey && retainedPanelActive;

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      const text = snapshot?.text ?? input.userInput;
      const cursorIndex = snapshot?.selection.start ?? input.cursorIndex;
      const current = findProfileReferenceMention({ text, cursorIndex, boundRanges });
      const profile = available.find((entry) => entry.id === option.id);
      if (!current || !profile || !onSelected) return;
      onSelected({ text, mention: current, profile });
      input.onAutocompleteApplied?.();
    },
    [available, boundRanges, input, onSelected],
  );
  const onEscape = useCallback(() => setDismissed(inputKey), [inputKey]);
  const keyboard = useAutocomplete<AutocompleteOption, AgentAutocompleteKeyPressEvent>({
    isVisible,
    options,
    query,
    onSelectOption: (option, event) => onSelectOption(option, event?.input),
    onEscape,
  });

  return {
    isActive,
    isVisible,
    options,
    selectedIndex: keyboard.selectedIndex,
    isLoading: false,
    errorMessage: undefined,
    loadingText: "",
    emptyText: t("agentAutocomplete.noProfiles"),
    onSelectOption,
    onKeyPress: (event: AgentAutocompleteKeyPressEvent) => {
      // The input publishes text after paint; a second key can precede that publication.
      const current = findProfileReferenceMention({
        text: event.input.text,
        cursorIndex: event.input.selection.start,
        boundRanges,
      });
      if (!current || !isVisible) return false;
      return keyboard.onKeyPress(event);
    },
  };
}
