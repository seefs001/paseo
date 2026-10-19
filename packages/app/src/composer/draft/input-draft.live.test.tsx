/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import { materializeAgentProfile } from "@/agent-profiles/internal/materialize-profile";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
}));

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedServerId: "host-1",
    selectedProvider: "codex",
    setProviderFromUser: () => undefined,
    selectedMode: "auto",
    setModeFromUser: () => undefined,
    selectedModel: "",
    setModelFromUser: () => undefined,
    selectedThinkingOptionId: "",
    setThinkingOptionFromUser: () => undefined,
    workingDir: "/repo",
    providerDefinitions: [{ id: "codex", label: "Codex", modes: [{ id: "auto", label: "Auto" }] }],
    providerDefinitionMap: new Map(),
    agentDefinition: undefined,
    modeOptions: [{ id: "auto", label: "Auto" }],
    availableModels: [
      {
        provider: "codex",
        id: "gpt-5.4",
        label: "gpt-5.4",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
    allProviderModels: new Map([
      [
        "codex",
        [
          {
            provider: "codex",
            id: "gpt-5.4",
            label: "gpt-5.4",
            isDefault: true,
            defaultThinkingOptionId: "high",
            thinkingOptions: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      ],
    ]),
    modelSelectorProviders: [
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "gpt-5.4",
              isDefault: true,
            },
          ],
        },
      },
    ],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ],
    isModelLoading: false,
    modelError: null,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const mountedRoots = new Set<Root>();
function createTestRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  mountedRoots.add(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
  });
});

let useAgentInputDraft: typeof import("./input-draft").useAgentInputDraft;
type DraftRecordForTest = ReturnType<typeof useDraftStore.getState>["drafts"][string];

beforeAll(async () => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  ({ useAgentInputDraft } = await import("./input-draft"));
});

describe("useAgentInputDraft live contract", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    localStorage.clear();

    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
  });

  it("hydrates persisted text and attachments and returns draft-mode composer state for a caller-provided key", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "attachment-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/1",
      createdAt: 1,
      fileName: "image.png",
      byteSize: 128,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe({ draftKey }: { draftKey: string }) {
      latest = useAgentInputDraft({
        draftKey,
        composer: {
          initialServerId: "host-1",
          isVisible: true,
          lockedWorkingDir: "/repo",
        },
      });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    let root: Root | null = createTestRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().composerState?.agentControls.selectedProvider).toBe("codex");
    expect(getLatest().composerState?.commandDraft).toEqual({
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      },
    });

    const hydratedTextReplacement = getLatest().textReplacement;
    // The editor applies a retained caret to the hydrated text, so hydration announces itself.
    expect(hydratedTextReplacement.kind).toBe("hydrated");

    await act(async () => {
      getLatest().editText("hello world");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().textReplacement).toBe(hydratedTextReplacement);

    await act(async () => {
      getLatest().replaceText("replacement text");
    });

    expect(getLatest().textReplacement).not.toBe(hydratedTextReplacement);
    expect(getLatest().textReplacement.kind).toBe("replace");
    expect(getLatest().textReplacement.text).toBe("replacement text");

    await act(async () => {
      getLatest().editText("hello world");
    });

    await act(async () => {
      root!.unmount();
    });

    root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe draftKey="draft:setup" />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("hello world");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
  });

  it.each([
    { initialProvider: "pi", fastMode: true },
    { initialProvider: "claude", fastMode: true },
    { initialProvider: "pi", fastMode: false },
  ])(
    "applies saved Pi Fast=$fastMode from $initialProvider without losing model isolation",
    async ({ initialProvider, fastMode }) => {
      const queryClient = new QueryClient();
      const features = [{ id: "fast_mode", type: "toggle", label: "Fast", value: false }];
      for (const provider of ["pi", initialProvider]) {
        queryClient.setQueryData(
          ["providerFeatures", "host-1", provider, "/repo", null, "openai/model-a", null],
          features,
        );
      }
      const targetQueryKey = [
        "providerFeatures",
        "host-1",
        "pi",
        "/repo",
        null,
        "openai/model-b",
        null,
      ];
      const profile = materializeAgentProfile({
        id: "pi-fast-profile",
        name: "Fast model B",
        provider: "pi",
        model: "openai/model-b",
        featureValues: { fast_mode: fastMode },
      });
      let latest: ReturnType<typeof useDraftAgentFeatures> | null = null;
      let select: ((provider: string, modelId: string) => void) | null = null;
      function controls() {
        if (!latest) throw new Error("Expected draft feature controls");
        return latest;
      }
      function selectModel(provider: string, modelId: string) {
        if (!select) throw new Error("Expected model selector");
        select(provider, modelId);
      }
      function Probe() {
        const [selection, setSelection] = useState({
          provider: initialProvider,
          modelId: "openai/model-a",
        });
        select = (provider, modelId) => setSelection({ provider, modelId });
        latest = useDraftAgentFeatures({
          serverId: "host-1",
          ...selection,
          cwd: "/repo",
          modeId: null,
          thinkingOptionId: null,
        });
        return null;
      }
      const container = document.getElementById("root");
      if (!container) throw new Error("Missing root container");
      const root = createTestRoot(container);
      const render = () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        );
      await act(async () => {
        render();
      });
      await act(async () => {
        controls().setFeatureValue("fast_mode", !fastMode);
      });
      await act(async () => {
        selectModel(profile.provider, profile.modelId);
        controls().applyProfileFeatureValues(profile);
      });
      // The target model's capabilities arrive after the profile selection.
      await act(async () => {
        queryClient.setQueryData(targetQueryKey, features);
        await new Promise<void>((resolve) => notifyManager.schedule(resolve));
      });

      expect(controls().featureValues).toEqual({ fast_mode: fastMode });
      expect(controls().features).toMatchObject([{ id: "fast_mode", value: fastMode }]);

      await act(async () => {
        controls().setFeatureValue("fast_mode", !fastMode);
      });
      await act(async () => {
        controls().applyProfileFeatureValues(profile);
      });
      expect(controls().featureValues).toEqual({ fast_mode: fastMode });

      await act(async () => {
        selectModel("pi", "openai/model-a");
      });
      const originalFast = initialProvider === "pi" ? !fastMode : false;
      expect(controls().features).toMatchObject([{ id: "fast_mode", value: originalFast }]);
      await act(async () => {
        selectModel("pi", "openai/model-b");
      });
      expect(controls().featureValues).toEqual({ fast_mode: fastMode });

      await act(async () => {
        root.unmount();
      });
      const nextRoot = createTestRoot(container);
      await act(async () => {
        nextRoot.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        selectModel("pi", "openai/model-b");
      });
      expect(controls().featureValues).toBeUndefined();
      expect(controls().features).toMatchObject([{ id: "fast_mode", value: false }]);
    },
  );

  it("migrates legacy image drafts to image attachments on hydration", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
      fileName: "legacy.png",
      byteSize: 512,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:legacy": {
          input: {
            text: "legacy text",
            images: [image],
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:legacy" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("legacy text");
    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    expect(useDraftStore.getState().drafts["draft:legacy"]?.input).toEqual({
      text: "legacy text",
      attachments: [{ kind: "image", metadata: image }],
    });
  });

  it("hydrates drafts saved by old builds with cwd", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const githubIssue: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 42,
        title: "Unify attachments",
        url: "https://github.com/paseo/paseo/issues/42",
        state: "open",
        body: "body",
        labels: ["composer"],
      },
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    useDraftStore.setState({
      drafts: {
        "draft:new-shape": {
          input: {
            text: "new text",
            attachments: [githubIssue],
            cwd: "/persisted",
          },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
      createModalDraft: null,
    });

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:new-shape" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    expect(getLatest().textSource.getSnapshot()).toBe("new text");
    expect(getLatest().attachments).toEqual([githubIssue]);

    await act(async () => {
      root.unmount();
    });

    expect(useDraftStore.getState().drafts["draft:new-shape"]?.input).toEqual({
      text: "new text",
      attachments: [githubIssue],
      cwd: "/persisted",
    });
  });

  it("updates and persists attachments through setAttachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "next-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/next-image",
      createdAt: 11,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    let renders = 0;
    function Probe() {
      renders += 1;
      latest = useAgentInputDraft({ draftKey: "draft:attachments" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("with attachment");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    expect(getLatest().attachments).toEqual([{ kind: "image", metadata: image }]);
    const readPersistedInput = () => useDraftStore.getState().drafts["draft:attachments"]?.input;
    await act(async () => {
      // Web text publication occurs after paint; attachments save immediately.
      await expect.poll(readPersistedInput).toEqual({
        text: "with attachment",
        attachments: [{ kind: "image", metadata: image }],
      });
    });
    const settledRenders = renders;
    const attached = getLatest().attachments;
    const source = getLatest().textSource;
    let textNotifications = 0;
    const unsubscribe = source.subscribe(() => {
      textNotifications += 1;
    });
    await act(async () => {
      getLatest().editText("with attachment\n");
      await expect.poll(source.getSnapshot).toBe("with attachment\n");
    });
    expect(renders).toBe(settledRenders);
    expect(getLatest().attachments).toBe(attached);
    expect(getLatest().textSource).toBe(source);
    expect(textNotifications).toBe(1);
    unsubscribe();
    await act(async () => {
      root.unmount();
    });
  });

  it("attaches to an unmounted legacy draft without losing its input", async () => {
    const image: AttachmentMetadata = {
      id: "legacy-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/legacy-image",
      createdAt: 10,
    };
    useDraftStore.setState({
      drafts: {
        "draft:legacy-workspace-file": {
          input: { text: "legacy text", images: [image] },
          lifecycle: "active",
          updatedAt: Date.now(),
          version: 1,
        } as unknown as DraftRecordForTest,
      },
    });

    await useDraftStore.getState().attachWorkspaceFile({
      draftKey: "draft:legacy-workspace-file",
      attachment: createWorkspaceFileAttachment({ path: "src/app.ts" }),
    });

    expect(useDraftStore.getState().getDraftInput("draft:legacy-workspace-file")).toEqual({
      text: "legacy text",
      attachments: [
        { kind: "image", metadata: image },
        createWorkspaceFileAttachment({ path: "src/app.ts" }),
      ],
    });
  });

  it("clear resets text and attachments", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const image: AttachmentMetadata = {
      id: "clear-image",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/clear-image",
      createdAt: 12,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:clear" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: image }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:clear"]?.input).toEqual({
      text: "",
      attachments: [],
    });
  });

  it("clears drafts with sent and abandoned lifecycle tombstones", async () => {
    let latest: ReturnType<typeof useAgentInputDraft> | null = null;
    const sentImage: AttachmentMetadata = {
      id: "attachment-sent",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "attachments/sent",
      createdAt: 2,
    };

    function getLatest(): ReturnType<typeof useAgentInputDraft> {
      if (!latest) {
        throw new Error("Expected hook result");
      }
      return latest;
    }

    function Probe() {
      latest = useAgentInputDraft({ draftKey: "draft:lifecycle" });
      return null;
    }

    const queryClient = new QueryClient();
    const container = document.getElementById("root");
    if (!container) {
      throw new Error("Missing root container");
    }

    const root = createTestRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      getLatest().editText("queued message");
      getLatest().setAttachments([{ kind: "image", metadata: sentImage }]);
    });

    await act(async () => {
      getLatest().clear("sent");
    });

    expect(getLatest().textSource.getSnapshot()).toBe("");
    expect(getLatest().attachments).toEqual([]);
    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "sent",
      input: { text: "", attachments: [] },
    });

    await act(async () => {
      getLatest().editText("draft again");
    });

    await act(async () => {
      getLatest().clear("abandoned");
    });

    expect(useDraftStore.getState().drafts["draft:lifecycle"]).toMatchObject({
      lifecycle: "abandoned",
      input: { text: "", attachments: [] },
    });
  });
});
