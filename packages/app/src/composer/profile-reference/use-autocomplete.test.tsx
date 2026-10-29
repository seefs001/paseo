/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentAutocompleteKeyPressEvent,
  UseAgentAutocompleteInput,
} from "@/hooks/use-agent-autocomplete";
import { useProfileReferenceAutocomplete } from "./use-autocomplete";

const mocks = vi.hoisted(() => ({
  profiles: [
    { id: "grok", name: "Grok4.7", provider: "grok", model: "grok-4.7" },
    {
      id: "grok-fast",
      name: "Grok4.7Fast",
      provider: "grok",
      model: "grok-4.7-fast",
      notes: "Quick checks\nSecond line",
    },
    { id: "claude", name: "Claude Opus 5.5", provider: "claude", model: "opus-5.5" },
  ],
}));

vi.mock("@/agent-profiles", () => ({
  useAgentProfiles: () => ({ profiles: mocks.profiles, isSupported: true, saveProfiles: vi.fn() }),
}));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function autocompleteInput(
  overrides: Partial<UseAgentAutocompleteInput> & Pick<UseAgentAutocompleteInput, "userInput">,
): UseAgentAutocompleteInput {
  return {
    cursorIndex: overrides.userInput.length,
    setUserInput: vi.fn(),
    serverId: "local",
    agentId: "agent-1",
    customCommands: [],
    onCustomCommandSelected: vi.fn(),
    onProfileReferenceSelected: vi.fn(),
    ...overrides,
  };
}

function pressKey(name: string, text: string): AgentAutocompleteKeyPressEvent {
  return {
    key: name,
    preventDefault: vi.fn(),
    input: { text, selection: { start: text.length, end: text.length } },
  };
}

describe("useProfileReferenceAutocomplete", () => {
  it("selects the closest match by profile id on Enter and hands the live mention to the composer", () => {
    const onProfileReferenceSelected = vi.fn();
    const onAutocompleteApplied = vi.fn();
    const text = "请用 #grok";
    const { result } = renderHook(() =>
      useProfileReferenceAutocomplete(
        autocompleteInput({ userInput: text, onProfileReferenceSelected, onAutocompleteApplied }),
      ),
    );

    expect(result.current.isVisible).toBe(true);
    // The panel opens above the input, so the first match sits last, next to the caret.
    expect(result.current.options).toEqual([
      {
        id: "grok-fast",
        label: "#Grok4.7Fast",
        detail: "grok · grok-4.7-fast",
        description: "Quick checks",
        kind: "agent",
      },
      { id: "grok", label: "#Grok4.7", detail: "grok · grok-4.7", kind: "agent" },
    ]);

    let handled = false;
    act(() => {
      handled = result.current.onKeyPress(pressKey("Enter", text));
    });

    expect(handled).toBe(true);
    expect(onProfileReferenceSelected).toHaveBeenCalledWith({
      text,
      mention: { start: 3, end: 8, query: "grok" },
      profile: mocks.profiles[0],
    });
    expect(onAutocompleteApplied).toHaveBeenCalledOnce();
  });

  it("stays shut inside a bound reference, without matches, and without a draft writer", () => {
    const bound = renderHook(() =>
      useProfileReferenceAutocomplete(
        autocompleteInput({
          userInput: "#Grok4.7 hi",
          cursorIndex: 8,
          boundReferenceRanges: [{ start: 0, end: 8 }],
        }),
      ),
    );
    expect(bound.result.current.isActive).toBe(false);
    expect(bound.result.current.onKeyPress(pressKey("Enter", "#Grok4.7"))).toBe(false);

    const unmatched = renderHook(() =>
      useProfileReferenceAutocomplete(autocompleteInput({ userInput: "colour #fff" })),
    );
    expect(unmatched.result.current.isVisible).toBe(false);
    expect(unmatched.result.current.onKeyPress(pressKey("Enter", "colour #fff"))).toBe(false);

    const readOnly = renderHook(() =>
      useProfileReferenceAutocomplete(
        autocompleteInput({ userInput: "#gr", onProfileReferenceSelected: undefined }),
      ),
    );
    expect(readOnly.result.current.isActive).toBe(false);
  });

  it("keeps an escaped panel closed until the input changes", () => {
    const { result, rerender } = renderHook(
      (props: { userInput: string }) =>
        useProfileReferenceAutocomplete(autocompleteInput({ userInput: props.userInput })),
      { initialProps: { userInput: "#gr" } },
    );
    expect(result.current.isVisible).toBe(true);

    act(() => {
      result.current.onKeyPress(pressKey("Escape", "#gr"));
    });
    rerender({ userInput: "#gr" });
    expect(result.current.isVisible).toBe(false);

    rerender({ userInput: "#gro" });
    expect(result.current.isVisible).toBe(true);
  });
});
