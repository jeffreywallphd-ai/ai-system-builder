import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactBrowserArtifacts } from "../hooks/useArtifactBrowserArtifacts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface HookHarnessProps {
  client: DesktopArtifactBrowserClient;
  setViewState: (value: ArtifactBrowserViewState) => void;
  onState: (state: ReturnType<typeof useArtifactBrowserArtifacts>) => void;
  workspaceId?: string;
}

function HookHarness(props: HookHarnessProps) {
  const state = useArtifactBrowserArtifacts({
    client: props.client,
    setViewState: props.setViewState,
    workspaceId: props.workspaceId,
  });
  props.onState(state);
  return null;
}

describe("useArtifactBrowserArtifacts", () => {
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
  });

  it("loads and refreshes registered and unregistered artifacts using selected family filter", async () => {
    const browseArtifacts = vi
      .fn()
      .mockResolvedValueOnce([
        { storageKey: "uploads/cat.png", artifactFamily: "image" },
        {
          storageKey: "workspaces/workspace-a/system-builds/evidence/digest",
          artifactFamily: "structured-text",
          mediaType: "application/vnd.ai-system-builder.build-evidence+json",
        },
        {
          storageKey: "workspaces/workspace-a/system-builds/policy/digest",
          artifactFamily: "structured-text",
          mediaType: "application/vnd.ai-system-builder.policy+json",
        },
      ])
      .mockResolvedValueOnce([{ storageKey: "uploads/train.parquet", artifactFamily: "tabular" }])
      .mockResolvedValueOnce([{ storageKey: "uploads/train.parquet", artifactFamily: "tabular" }]);
    const browseUnregisteredArtifacts = vi
      .fn()
      .mockResolvedValueOnce([
        { storageKey: "uploads/orphan.json", relativePath: "orphan.json", fileName: "orphan.json" },
        {
          storageKey: "workspaces/workspace-a/system-builds/provenance/digest",
          relativePath: "system-builds/provenance/digest",
          fileName: "digest",
          mediaType: "application/vnd.in-toto+json",
        },
      ])
      .mockResolvedValueOnce([{ storageKey: "uploads/orphan-2.json", relativePath: "orphan-2.json", fileName: "orphan-2.json" }]);
    const client = {
      browseArtifacts,
      browseUnregisteredArtifacts,
    } as unknown as DesktopArtifactBrowserClient;
    const setViewState = vi.fn();

    let hookState: ReturnType<typeof useArtifactBrowserArtifacts> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <HookHarness
          client={client}
          setViewState={setViewState}
          workspaceId="workspace-a"
          onState={(state) => {
            hookState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(1, { workspaceId: "workspace-a" });
    expect(hookState?.items[0]?.storageKey).toBe("uploads/cat.png");
    expect(hookState?.uploadedItems[0]?.storageKey).toBe("uploads/cat.png");
    expect(hookState?.generatedItems).toEqual([]);
    expect(hookState?.unregisteredItems[0]?.storageKey).toBe("uploads/orphan.json");
    expect(hookState?.items).toHaveLength(1);
    expect(hookState?.unregisteredItems).toHaveLength(1);

    await act(async () => {
      hookState?.setSelectedArtifactFamily("tabular");
    });
    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(2, { artifactFamily: "tabular", workspaceId: "workspace-a" });
    expect(hookState?.items[0]?.storageKey).toBe("uploads/train.parquet");
    expect(hookState?.unregisteredItems[0]?.storageKey).toBe("uploads/orphan-2.json");
    expect(setViewState).toHaveBeenCalledWith({ status: "loading", message: "Loading artifacts..." });

    await act(async () => {
      hookState?.setSelectedStorageFilter("generated");
    });
    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(3, { artifactFamily: "tabular", workspaceId: "workspace-a" });
    expect(hookState?.items).toEqual([]);
  });

  it("groups workspace-prefixed uploaded markdown artifacts as uploaded items", async () => {
    const storageKey = "workspaces/workspace.d64c780b4ce34f62a65fb0b0ae4f80ca/artifacts/files/uploads/20260605133238388-9976fe6a4c5b4f4784aad3df0c5b37bd.md";
    const browseArtifacts = vi.fn().mockResolvedValue([
      {
        artifactId: storageKey,
        storageKey,
        originalName: "host-model.md",
        artifactFamily: "text" as const,
        mediaType: "text/markdown",
        sourceKind: "upload" as const,
        sizeBytes: 20908,
      },
    ]);
    const client = {
      browseArtifacts,
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue([]),
    } as unknown as DesktopArtifactBrowserClient;
    const setViewState = vi.fn();

    let hookState: ReturnType<typeof useArtifactBrowserArtifacts> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <HookHarness
          client={client}
          setViewState={setViewState}
          workspaceId="workspace.d64c780b4ce34f62a65fb0b0ae4f80ca"
          onState={(state) => {
            hookState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await hookState?.refreshArtifacts();
    });

    expect(browseArtifacts).toHaveBeenCalledWith({ workspaceId: "workspace.d64c780b4ce34f62a65fb0b0ae4f80ca" });
    expect(hookState?.items[0]?.originalName).toBe("host-model.md");
    expect(hookState?.uploadedItems[0]?.storageKey).toBe(storageKey);
    expect(hookState?.generatedItems).toEqual([]);
    expect(setViewState).toHaveBeenLastCalledWith({ status: "success" });
  });
});
