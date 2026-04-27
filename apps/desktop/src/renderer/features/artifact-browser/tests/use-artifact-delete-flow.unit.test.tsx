import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactDeleteFlow } from "../hooks/useArtifactDeleteFlow";

interface HookHarnessProps {
  client: DesktopArtifactBrowserClient;
  refreshArtifacts: () => Promise<void>;
  clearSelectedArtifact: () => void;
  setViewState: (value: ArtifactBrowserViewState) => void;
  onState: (state: ReturnType<typeof useArtifactDeleteFlow>) => void;
}

function HookHarness(props: HookHarnessProps) {
  const state = useArtifactDeleteFlow({
    client: props.client,
    refreshArtifacts: props.refreshArtifacts,
    clearSelectedArtifact: props.clearSelectedArtifact,
    setViewState: props.setViewState,
  });
  props.onState(state);
  return null;
}

describe("useArtifactDeleteFlow", () => {
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

  it("requires exact typed Delete and runs registered/unregistered delete flows with refresh cleanup", async () => {
    const deleteUnregisteredArtifact = vi.fn().mockResolvedValue({ storageKey: "uploads/orphan.json" });
    const deleteRegisteredArtifact = vi.fn().mockResolvedValue({ storageKey: "uploads/cat.png" });
    const refreshArtifacts = vi.fn().mockResolvedValue(undefined);
    const clearSelectedArtifact = vi.fn();
    const setViewState = vi.fn();
    const client = {
      deleteUnregisteredArtifact,
      deleteRegisteredArtifact,
    } as const;

    let hookState: ReturnType<typeof useArtifactDeleteFlow> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <HookHarness
          client={client as unknown as DesktopArtifactBrowserClient}
          refreshArtifacts={refreshArtifacts}
          clearSelectedArtifact={clearSelectedArtifact}
          setViewState={setViewState}
          onState={(state) => {
            hookState = state;
          }}
        />,
      );
    });

    await act(async () => {
      hookState?.requestDeleteUnregisteredArtifact("uploads/orphan.json");
    });
    await act(async () => {
      hookState?.setDeleteConfirmationInput("delete");
    });
    await act(async () => {
      await hookState?.confirmPendingDelete();
    });
    expect(deleteUnregisteredArtifact).not.toHaveBeenCalled();
    expect(setViewState).toHaveBeenLastCalledWith({
      status: "error",
      message: "Delete cancelled: typed confirmation must be exactly Delete.",
    });

    await act(async () => {
      hookState?.requestDeleteUnregisteredArtifact("uploads/orphan.json");
    });
    await act(async () => {
      hookState?.setDeleteConfirmationInput("Delete");
    });
    await act(async () => {
      await hookState?.confirmPendingDelete();
    });
    expect(deleteUnregisteredArtifact).toHaveBeenCalledWith({ storageKey: "uploads/orphan.json" });
    expect(refreshArtifacts).toHaveBeenCalledTimes(1);
    expect(clearSelectedArtifact).not.toHaveBeenCalled();

    await act(async () => {
      hookState?.requestDeleteRegisteredArtifact("uploads/cat.png");
    });
    await act(async () => {
      hookState?.setDeleteConfirmationInput("Delete");
    });
    await act(async () => {
      await hookState?.confirmPendingDelete();
    });
    expect(deleteRegisteredArtifact).toHaveBeenCalledWith({ storageKey: "uploads/cat.png" });
    expect(clearSelectedArtifact).toHaveBeenCalledTimes(1);
    expect(refreshArtifacts).toHaveBeenCalledTimes(2);
  });
});
