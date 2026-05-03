import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactBrowserArtifacts } from "../hooks/useArtifactBrowserArtifacts";

interface HookHarnessProps {
  client: DesktopArtifactBrowserClient;
  setViewState: (value: ArtifactBrowserViewState) => void;
  onState: (state: ReturnType<typeof useArtifactBrowserArtifacts>) => void;
}

function HookHarness(props: HookHarnessProps) {
  const state = useArtifactBrowserArtifacts({
    client: props.client,
    setViewState: props.setViewState,
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
      .mockResolvedValueOnce([{ storageKey: "uploads/cat.png", artifactFamily: "image" }])
      .mockResolvedValueOnce([{ storageKey: "uploads/train.parquet", artifactFamily: "tabular" }])
      .mockResolvedValueOnce([{ storageKey: "uploads/train.parquet", artifactFamily: "tabular" }]);
    const browseUnregisteredArtifacts = vi
      .fn()
      .mockResolvedValueOnce([{ storageKey: "uploads/orphan.json", relativePath: "orphan.json", fileName: "orphan.json" }])
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
          onState={(state) => {
            hookState = state;
          }}
        />,
      );
    });

    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(1, {});
    expect(hookState?.items[0]?.storageKey).toBe("uploads/cat.png");
    expect(hookState?.uploadedItems[0]?.storageKey).toBe("uploads/cat.png");
    expect(hookState?.generatedItems).toEqual([]);
    expect(hookState?.unregisteredItems[0]?.storageKey).toBe("uploads/orphan.json");

    await act(async () => {
      hookState?.setSelectedArtifactFamily("tabular");
    });
    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(2, { artifactFamily: "tabular" });
    expect(hookState?.items[0]?.storageKey).toBe("uploads/train.parquet");
    expect(hookState?.unregisteredItems[0]?.storageKey).toBe("uploads/orphan-2.json");
    expect(setViewState).toHaveBeenCalledWith({ status: "loading", message: "Loading artifacts..." });

    await act(async () => {
      hookState?.setSelectedStorageFilter("generated");
    });
    await act(async () => {
      await hookState?.refreshArtifacts();
    });
    expect(browseArtifacts).toHaveBeenNthCalledWith(3, { artifactFamily: "tabular" });
    expect(hookState?.items).toEqual([]);
  });
});
