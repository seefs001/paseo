import { reportComposerSelection, takeQuoteCaret } from "@/attachments/inline-quote";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { TextReplacement } from "@/composer/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandTarget } from "@/agent-commands";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  buildDraftAgentControls,
  hasDraftContent,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandTarget,
  resolveEffectiveComposerModeId,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftStore, type DraftInput } from "@/stores/draft-store";
import type { AgentInputSubmissionDraft } from "@/composer/submit";
import { AfterPaintPublication } from "@/composer/after-paint-publication";
import { useShallow } from "zustand/shallow";
import type { ComposerTextSource } from "@/composer/text-source";
import { isWeb } from "@/constants/platform";
import {
  applyProfileReferenceEdit,
  isRangedAttachment,
  type ProfileReferenceRange,
} from "@/composer/profile-reference/model";

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  /** The Agent role the draft opens with. Roles are never restored from preferences. */
  initialRoleId?: string;
  isVisible?: boolean;
  lockedWorkingDir?: string;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModeId: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  /** The Agent role id sent as `roleId` on create. */
  roleId: string | null;
  agentControls: DraftAgentControlsProps;
  commandDraft: DraftCommandTarget;
};

export interface AgentInputDraftSubmission extends AgentInputSubmissionDraft<UserComposerAttachment> {
  failures: Readonly<Record<string, DraftInput>> | undefined;
  restore: (id: string) => boolean;
}

export interface AgentInputDraft {
  submission: AgentInputDraftSubmission;
  textSource: ComposerTextSource;
  editText: (text: string, selectionBefore?: ProfileReferenceRange) => void;
  replaceText: (text: string) => void;
  replaceInput: (input: {
    text: string;
    attachments: UserComposerAttachment[];
    selection?: ProfileReferenceRange;
  }) => void;
  textReplacement: TextReplacement;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const workingDir = composerOptions?.lockedWorkingDir?.trim() || "";
  const formState = useAgentFormState({
    workingDir,
    serverId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
    draftKey: resolveDraftKey({
      draftKey: input.draftKey,
      selectedServerId: composerOptions?.initialServerId ?? null,
    }),
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const currentDraftKeyRef = useRef(draftKey);
  currentDraftKeyRef.current = draftKey;
  const editRevisionRef = useRef(0);
  const failedSubmissions = useDraftStore((state) => state.failedSubmissions?.[draftKey]);
  const attachments = useDraftStore(
    useShallow((state) =>
      state.drafts[draftKey]?.lifecycle === "active"
        ? (state.drafts[draftKey].input.attachments ?? [])
        : [],
    ),
  );
  const textSource = useMemo<ComposerTextSource>(
    () => ({
      getSnapshot: () => {
        const record = useDraftStore.getState().drafts[draftKey];
        return record?.lifecycle === "active" ? record.input.text : "";
      },
      subscribe: (listener) =>
        useDraftStore.subscribe((state, previous) => {
          if (
            state.drafts[draftKey]?.input.text !== previous.drafts[draftKey]?.input.text ||
            state.drafts[draftKey]?.lifecycle !== previous.drafts[draftKey]?.lifecycle
          )
            listener();
        }),
      reportSelection: (selection) => reportComposerSelection(draftKey, selection),
    }),
    [draftKey],
  );
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  // A quote added from elsewhere writes the draft text directly; show it with the caret after it.
  const lastFocusRequestRef = useRef(attachmentFocusRequestId);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const isHydrated = hydratedDraftKey === draftKey;
  const textReplacementRevisionRef = useRef(0);
  const [textReplacement, setTextReplacement] = useState<TextReplacement>(() => ({
    kind: "initial",
    key: `${draftKey}:0`,
    text: textSource.getSnapshot(),
  }));

  const publishTextReplacement = useCallback(
    (kind: "hydrated" | "replace", nextText: string, selection?: ProfileReferenceRange) => {
      textReplacementRevisionRef.current += 1;
      setTextReplacement({
        kind,
        key: `${draftKey}:${textReplacementRevisionRef.current}`,
        text: nextText,
        ...(selection ? { selection } : {}),
      });
    },
    [draftKey],
  );

  const saveDraft = useCallback(
    (
      update: (draft: { text: string; attachments: UserComposerAttachment[] }) => {
        text: string;
        attachments: UserComposerAttachment[];
      },
    ) => {
      const store = useDraftStore.getState();
      const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
      const next = update(current);
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  const textPublication = useMemo(
    () =>
      new AfterPaintPublication<string>((nextText) => {
        useDraftStore.getState().editDraftText({ draftKey, text: nextText });
      }),
    [draftKey],
  );

  useEffect(() => {
    if (lastFocusRequestRef.current === attachmentFocusRequestId) return;
    lastFocusRequestRef.current = attachmentFocusRequestId;
    const text = textSource.getSnapshot();
    const caret = takeQuoteCaret(draftKey) ?? { start: text.length, end: text.length };
    publishTextReplacement("replace", text, caret);
  }, [attachmentFocusRequestId, draftKey, publishTextReplacement, textSource]);

  // Forget this composer's selection when it stops showing the draft, so a later quote appends.
  useEffect(() => () => reportComposerSelection(draftKey, null), [draftKey]);

  const replaceInput = useCallback(
    (next: {
      text: string;
      attachments: UserComposerAttachment[];
      selection?: ProfileReferenceRange;
    }) => {
      textPublication.cancel();
      saveDraft(() => ({ text: next.text, attachments: next.attachments }));
      publishTextReplacement("replace", next.text, next.selection);
    },
    [publishTextReplacement, saveDraft, textPublication],
  );

  const editText = useCallback(
    (nextText: string, selectionBefore?: ProfileReferenceRange) => {
      editRevisionRef.current += 1;
      const store = useDraftStore.getState();
      const record = store.drafts[draftKey];
      const current = record?.lifecycle === "active" ? record.input : undefined;
      const hasReferences = current?.attachments.some(isRangedAttachment);
      if (current && hasReferences) {
        textPublication.cancel();
        const next = applyProfileReferenceEdit({
          previousText: current.text,
          text: nextText,
          attachments: current.attachments,
          selectionBefore,
        });
        store.saveDraftInput({
          draftKey,
          draft: { text: next.text, attachments: next.attachments },
        });
        if (next.selection) publishTextReplacement("replace", next.text, next.selection);
        return;
      }
      if (isWeb) {
        textPublication.stage(nextText);
      } else {
        store.editDraftText({ draftKey, text: nextText });
      }
    },
    [draftKey, publishTextReplacement, textPublication],
  );

  const replaceText = useCallback(
    (nextText: string) => {
      textPublication.cancel();
      useDraftStore.getState().editDraftText({ draftKey, text: nextText });
      publishTextReplacement("replace", nextText);
    },
    [draftKey, publishTextReplacement, textPublication],
  );

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      textPublication.cancel();
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
    },
    [draftKey, textPublication],
  );

  const captureSubmissionDraft = useCallback(() => {
    // Publish our own immediate clear before capturing the version. Subsequent editor
    // events invalidate it synchronously, even before their after-paint publication.
    textPublication.flush();
    const record = useDraftStore.getState().drafts[draftKey];
    const revision = editRevisionRef.current;
    return () =>
      currentDraftKeyRef.current === draftKey &&
      editRevisionRef.current === revision &&
      useDraftStore.getState().drafts[draftKey] === record;
  }, [draftKey, textPublication]);

  const retainFailedSubmission = useCallback(
    ({
      message,
      attachments: failedAttachments,
    }: {
      message: string;
      attachments: UserComposerAttachment[];
    }) => {
      useDraftStore.getState().retainFailedSubmission({
        draftKey,
        draft: { text: message, attachments: failedAttachments },
      });
    },
    [draftKey],
  );

  const restoreFailedSubmission = useCallback(
    (id: string) => {
      textPublication.flush();
      const restored = useDraftStore.getState().restoreFailedSubmission({ draftKey, id });
      if (!restored) return false;
      publishTextReplacement("replace", restored.text);
      return true;
    },
    [draftKey, publishTextReplacement, textPublication],
  );

  const submission = useMemo<AgentInputDraftSubmission>(
    () => ({
      capture: captureSubmissionDraft,
      retainFailed: retainFailedSubmission,
      failures: failedSubmissions,
      restore: restoreFailedSubmission,
    }),
    [captureSubmissionDraft, retainFailedSubmission, failedSubmissions, restoreFailedSubmission],
  );

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") textPublication.flush();
    };
    const flush = () => textPublication.flush();
    const canListenForPageHide =
      isWeb && typeof window !== "undefined" && typeof window.addEventListener === "function";
    if (isWeb && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", flushWhenHidden);
    }
    if (canListenForPageHide) {
      window.addEventListener("pagehide", flush);
    }
    return () => {
      if (isWeb && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", flushWhenHidden);
      }
      if (canListenForPageHide) {
        window.removeEventListener("pagehide", flush);
      }
      textPublication.flush();
    };
  }, [textPublication]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        const hydratedText = useDraftStore.getState().getDraftInput(draftKey)?.text ?? "";
        publishTextReplacement("hydrated", hydratedText);
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, publishTextReplacement]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModeId = useMemo(
    () => resolveEffectiveComposerModeId(providerSelection, formState.isModelLoading),
    [formState.isModelLoading, providerSelection],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
    applyProfileFeatureValues,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues ?? formState.initialFeatureValues,
  });

  const [roleId, setRoleId] = useState<string | null>(composerOptions?.initialRoleId ?? null);

  const applyDraftAgentProfile = useCallback(
    (profile: Parameters<typeof formState.applyProfileFromUser>[0], profileId?: string) => {
      formState.applyProfileFromUser(profile, profileId);
      applyProfileFeatureValues(profile);
    },
    [applyProfileFeatureValues, formState],
  );

  const commandDraft = useMemo(
    () =>
      buildDraftCommandTarget({
        selection: providerSelection,
        cwd: workingDir,
        effectiveModelId,
        effectiveThinkingOptionId,
        featureValues: draftFeatureValues,
      }),
    [
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      workingDir,
      effectiveModeId,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      roleId,
      agentControls: buildDraftAgentControls({
        formState,
        features: draftFeatures,
        onSetFeature: setDraftFeatureValue,
        onApplyAgentProfile: applyDraftAgentProfile,
        selectedRoleId: roleId,
        onSelectRole: setRoleId,
      }),
      commandDraft,
    };
  }, [
    roleId,
    commandDraft,
    composerOptions,
    effectiveModeId,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    draftFeatureValues,
    applyDraftAgentProfile,
    formState,
    setDraftFeatureValue,
    workingDir,
  ]);

  return {
    submission,
    textSource,
    editText,
    replaceText,
    replaceInput,
    textReplacement,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModeId,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandTarget,
  buildDraftAgentControls,
};
