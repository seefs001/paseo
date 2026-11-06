import { useCallback, useMemo, useState } from "react";
import type { AgentRole } from "@getpaseo/protocol/messages";
import { useAgentProfiles } from "@/agent-profiles";
import { useAgentRoles } from "@/agent-roles";
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
  findActiveRoleMention,
  rankAgentRoleMentions,
  type SessionMentionRange,
} from "@/utils/session-mention-autocomplete";
import { roleReferenceLabel, type ProfileReferenceRange } from "./model";

export interface RoleReferenceSelection {
  /** The live text the mention range indexes into. */
  text: string;
  mention: SessionMentionRange;
  role: AgentRole;
}

const NO_RANGES: readonly ProfileReferenceRange[] = [];
const NO_ROLES: readonly AgentRole[] = [];

export function findRoleReferenceMention(input: {
  text: string;
  cursorIndex: number;
  boundRanges: readonly ProfileReferenceRange[];
}): SessionMentionRange | null {
  const mention = findActiveRoleMention(input);
  if (!mention) return null;
  // A caret inside or at the end of a bound reference sees its `%`; that token is already chosen.
  const isBound = input.boundRanges.some(
    (range) => mention.start >= range.start && mention.start < range.end,
  );
  return isBound ? null : mention;
}

function roleOption(
  role: AgentRole,
  profileNames: ReadonlyMap<string, string>,
): AutocompleteOption {
  const profileName = role.defaultProfileId ? profileNames.get(role.defaultProfileId) : undefined;
  return {
    id: role.id,
    label: roleReferenceLabel(role),
    ...(profileName ? { detail: profileName } : {}),
    ...(role.description ? { description: role.description } : {}),
    kind: "agent",
  };
}

export function useRoleReferenceAutocomplete(input: UseAgentAutocompleteInput) {
  const { roles, isSupported } = useAgentRoles(input.serverId);
  const { profiles } = useAgentProfiles(input.serverId);
  const retainedPanelActive = useRetainedPanelActive();
  const boundRanges = input.boundReferenceRanges ?? NO_RANGES;
  const onSelected = input.onRoleReferenceSelected;
  const available = roles ?? NO_ROLES;
  const canReference = onSelected !== undefined && isSupported && available.length > 0;
  const mention = canReference
    ? findRoleReferenceMention({
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
  const profileNames = useMemo(
    () => new Map((profiles ?? []).map((profile) => [profile.id, profile.name])),
    [profiles],
  );
  const options = useMemo(
    () =>
      isActive
        ? orderAutocompleteOptions(
            rankAgentRoleMentions({ roles: available, query }).map((role) =>
              roleOption(role, profileNames),
            ),
          )
        : [],
    [available, isActive, profileNames, query],
  );
  // `%` also appears in prose and format strings; with nothing to offer the panel stays shut.
  const isVisible = isActive && options.length > 0 && dismissed !== inputKey && retainedPanelActive;

  const onSelectOption = useCallback(
    (option: AutocompleteOption, snapshot?: AgentAutocompleteInputSnapshot) => {
      const text = snapshot?.text ?? input.userInput;
      const cursorIndex = snapshot?.selection.start ?? input.cursorIndex;
      const current = findRoleReferenceMention({ text, cursorIndex, boundRanges });
      const role = available.find((entry) => entry.id === option.id);
      if (!current || !role || !onSelected) return;
      onSelected({ text, mention: current, role });
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
    status: null,
    onSelectOption,
    onKeyPress: (event: AgentAutocompleteKeyPressEvent) => {
      // The input publishes text after paint; a second key can precede that publication.
      const current = findRoleReferenceMention({
        text: event.input.text,
        cursorIndex: event.input.selection.start,
        boundRanges,
      });
      if (!current || !isVisible) return false;
      return keyboard.onKeyPress(event);
    },
  };
}
