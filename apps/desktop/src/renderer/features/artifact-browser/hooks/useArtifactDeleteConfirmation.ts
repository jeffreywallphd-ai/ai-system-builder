import { useState } from "react";

export interface PendingDeleteConfirmation {
  kind: "registered" | "unregistered";
  storageKey: string;
  label: string;
}

export function useArtifactDeleteConfirmation() {
  const [pendingDeleteConfirmation, setPendingDeleteConfirmation] = useState<PendingDeleteConfirmation | undefined>();
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");

  function requestDeleteUnregisteredArtifact(storageKey: string): void {
    setDeleteConfirmationInput("");
    setPendingDeleteConfirmation({
      kind: "unregistered",
      storageKey,
      label: `Delete unregistered artifact ${storageKey}`,
    });
  }

  function requestDeleteRegisteredArtifact(storageKey: string): void {
    setDeleteConfirmationInput("");
    setPendingDeleteConfirmation({
      kind: "registered",
      storageKey,
      label: `Delete registered artifact ${storageKey}`,
    });
  }

  function cancelPendingDelete(): void {
    setDeleteConfirmationInput("");
    setPendingDeleteConfirmation(undefined);
  }

  return {
    pendingDeleteConfirmation,
    deleteConfirmationInput,
    requestDeleteUnregisteredArtifact,
    requestDeleteRegisteredArtifact,
    setDeleteConfirmationInput,
    cancelPendingDelete,
  };
}
