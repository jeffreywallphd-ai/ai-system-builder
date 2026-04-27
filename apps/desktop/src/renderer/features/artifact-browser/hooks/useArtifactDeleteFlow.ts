import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactDeleteConfirmation } from "./useArtifactDeleteConfirmation";

interface UseArtifactDeleteFlowParams {
  client: DesktopArtifactBrowserClient;
  refreshArtifacts: () => Promise<void>;
  clearSelectedArtifact: () => void;
  setViewState: (value: ArtifactBrowserViewState) => void;
}

export function useArtifactDeleteFlow({
  client,
  refreshArtifacts,
  clearSelectedArtifact,
  setViewState,
}: UseArtifactDeleteFlowParams) {
  const confirmation = useArtifactDeleteConfirmation();

  async function runDeleteUnregisteredArtifact(storageKey: string): Promise<void> {
    setViewState({ status: "loading", message: `Deleting ${storageKey}...` });
    try {
      if (!client.deleteUnregisteredArtifact) {
        throw new Error("Unregistered artifact delete flow is unavailable.");
      }
      await client.deleteUnregisteredArtifact({ storageKey });
      await refreshArtifacts();
      setViewState({ status: "success", message: `Deleted ${storageKey}.` });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to delete unregistered artifact.",
      });
    }
  }

  async function runDeleteRegisteredArtifact(storageKey: string): Promise<void> {
    setViewState({ status: "loading", message: `Deleting ${storageKey}...` });
    try {
      if (!client.deleteRegisteredArtifact) {
        throw new Error("Registered artifact delete flow is unavailable.");
      }
      await client.deleteRegisteredArtifact({ storageKey });
      clearSelectedArtifact();
      await refreshArtifacts();
      setViewState({ status: "success", message: `Deleted ${storageKey}.` });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to delete registered artifact.",
      });
    }
  }

  async function confirmPendingDelete(): Promise<void> {
    if (!confirmation.pendingDeleteConfirmation) {
      return;
    }

    if (confirmation.deleteConfirmationInput !== "Delete") {
      setViewState({ status: "error", message: "Delete cancelled: typed confirmation must be exactly Delete." });
      return;
    }

    const pending = confirmation.pendingDeleteConfirmation;
    confirmation.cancelPendingDelete();

    if (pending.kind === "registered") {
      await runDeleteRegisteredArtifact(pending.storageKey);
      return;
    }

    await runDeleteUnregisteredArtifact(pending.storageKey);
  }

  return {
    pendingDeleteConfirmation: confirmation.pendingDeleteConfirmation,
    deleteConfirmationInput: confirmation.deleteConfirmationInput,
    requestDeleteUnregisteredArtifact: confirmation.requestDeleteUnregisteredArtifact,
    requestDeleteRegisteredArtifact: confirmation.requestDeleteRegisteredArtifact,
    setDeleteConfirmationInput: confirmation.setDeleteConfirmationInput,
    cancelPendingDelete: confirmation.cancelPendingDelete,
    confirmPendingDelete,
  };
}
