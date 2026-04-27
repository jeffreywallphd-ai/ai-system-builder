import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useArtifactDeleteConfirmation } from "../hooks/useArtifactDeleteConfirmation";

function HookHarness(props: { onState: (state: ReturnType<typeof useArtifactDeleteConfirmation>) => void }) {
  const state = useArtifactDeleteConfirmation();
  props.onState(state);
  return null;
}

describe("useArtifactDeleteConfirmation", () => {
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

  it("tracks registered and unregistered delete intents and clears state on cancel", async () => {
    let hookState: ReturnType<typeof useArtifactDeleteConfirmation> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookHarness onState={(state) => {
        hookState = state;
      }} />);
    });

    await act(async () => {
      hookState?.requestDeleteRegisteredArtifact("uploads/cat.png");
    });
    expect(hookState?.pendingDeleteConfirmation).toEqual({
      kind: "registered",
      storageKey: "uploads/cat.png",
      label: "Delete registered artifact uploads/cat.png",
    });

    await act(async () => {
      hookState?.setDeleteConfirmationInput("Delete");
      hookState?.cancelPendingDelete();
    });
    expect(hookState?.pendingDeleteConfirmation).toBeUndefined();
    expect(hookState?.deleteConfirmationInput).toBe("");

    await act(async () => {
      hookState?.requestDeleteUnregisteredArtifact("uploads/orphan.json");
    });
    expect(hookState?.pendingDeleteConfirmation).toEqual({
      kind: "unregistered",
      storageKey: "uploads/orphan.json",
      label: "Delete unregistered artifact uploads/orphan.json",
    });
  });
});
