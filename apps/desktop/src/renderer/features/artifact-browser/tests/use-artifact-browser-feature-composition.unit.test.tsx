import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useArtifactBrowserFeature } from "../hooks/useArtifactBrowserFeature";

const artifactsHookResult = {
  items: [{ storageKey: "uploads/cat.png", artifactFamily: "image" as const }],
  unregisteredItems: [{ storageKey: "uploads/orphan.json", relativePath: "orphan.json", fileName: "orphan.json" }],
  selectedArtifactFamily: "all" as const,
  setSelectedArtifactFamily: vi.fn(),
  refreshArtifacts: vi.fn().mockResolvedValue(undefined),
};

const deleteFlowResult = {
  pendingDeleteConfirmation: undefined,
  deleteConfirmationInput: "",
  requestDeleteUnregisteredArtifact: vi.fn(),
  requestDeleteRegisteredArtifact: vi.fn(),
  setDeleteConfirmationInput: vi.fn(),
  cancelPendingDelete: vi.fn(),
  confirmPendingDelete: vi.fn().mockResolvedValue(undefined),
};

const mutationResult = {
  registerUnregisteredArtifact: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../hooks/useArtifactBrowserArtifacts", () => ({
  useArtifactBrowserArtifacts: vi.fn(() => artifactsHookResult),
}));

vi.mock("../hooks/useArtifactDeleteFlow", () => ({
  useArtifactDeleteFlow: vi.fn(() => deleteFlowResult),
}));

vi.mock("../hooks/useArtifactBrowserMutations", () => ({
  useArtifactBrowserMutations: vi.fn(() => mutationResult),
}));

function HookHarness(props: { onState: (state: ReturnType<typeof useArtifactBrowserFeature>) => void; client: unknown; workspaceId?: string }) {
  const state = useArtifactBrowserFeature(props.client as never, props.workspaceId);
  props.onState(state);
  return null;
}

describe("useArtifactBrowserFeature composition", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    vi.clearAllMocks();
  });

  it("exposes delegated list, mutation, and delete flow responsibilities from focused hooks", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn().mockResolvedValue(undefined),
      readArtifactContent: vi.fn().mockResolvedValue(undefined),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({ mediaType: "text/plain", bytes: new Uint8Array([97]) }),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn().mockResolvedValue({ target: { provider: "huggingface", repository: "repo", path: "path", revision: "main", locator: "repo/path" }, verification: { exists: true } }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({ target: { provider: "huggingface", repository: "repo", path: "path", revision: "main", locator: "repo/path" }, verification: { exists: true } }),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({ artifactId: "uploads/cat.png" }),
      localizeArtifactFromRepo: vi.fn(),
    };

    let hookState: ReturnType<typeof useArtifactBrowserFeature> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookHarness client={client} workspaceId="workspace-a" onState={(state) => { hookState = state; }} />);
    });

    expect(hookState?.items).toBe(artifactsHookResult.items);
    expect(hookState?.unregisteredItems).toBe(artifactsHookResult.unregisteredItems);
    expect(hookState?.refreshArtifacts).toBe(artifactsHookResult.refreshArtifacts);
    expect(hookState?.registerUnregisteredArtifact).toBe(mutationResult.registerUnregisteredArtifact);
    expect(hookState?.requestDeleteRegisteredArtifact).toBe(deleteFlowResult.requestDeleteRegisteredArtifact);
    expect(hookState?.confirmPendingDelete).toBe(deleteFlowResult.confirmPendingDelete);
  });

  it("uses the current workspace for download reads and keeps missing or foreign reads denied", async () => {
    const bytes = new Uint8Array([123, 125, 10]);
    const owners = new Map([
      ["generated/a.jsonl", "workspace-a"],
      ["generated/b.jsonl", "workspace-b"],
    ]);
    const readArtifactMedia = vi.fn(async (
      locator: { storageKey: string }, context?: { workspaceId?: string },
    ) => {
      if (!context?.workspaceId || owners.get(locator.storageKey) !== context.workspaceId) {
        throw new Error("Artifact unavailable in the active workspace.");
      }
      return { mediaType: "application/x-ndjson", bytes };
    });
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn().mockResolvedValue(undefined),
      readArtifactContent: vi.fn().mockResolvedValue(undefined),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia,
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(), clearHuggingFaceToken: vi.fn(),
      publishArtifactToHuggingFace: vi.fn(), verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(), localizeArtifactFromRepo: vi.fn(),
    };
    let hookState: ReturnType<typeof useArtifactBrowserFeature> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    const renderWorkspace = async (workspaceId?: string) => {
      await act(async () => {
        root.render(<HookHarness client={client} workspaceId={workspaceId} onState={(state) => { hookState = state; }} />);
      });
    };
    await renderWorkspace("workspace-a");
    await expect(hookState!.readArtifactMedia("generated/a.jsonl")).resolves.toEqual({ mediaType: "application/x-ndjson", bytes });
    await renderWorkspace("workspace-b");
    await expect(hookState!.readArtifactMedia("generated/a.jsonl")).rejects.toThrow("Artifact unavailable in the active workspace.");
    await expect(hookState!.readArtifactMedia("generated/b.jsonl")).resolves.toEqual({ mediaType: "application/x-ndjson", bytes });
    await renderWorkspace(undefined);
    await expect(hookState!.readArtifactMedia("generated/b.jsonl")).rejects.toThrow("Artifact unavailable in the active workspace.");
    expect(readArtifactMedia.mock.calls.map(([, context]) => context?.workspaceId)).toEqual([
      "workspace-a", "workspace-b", "workspace-b", undefined,
    ]);
  });
});
