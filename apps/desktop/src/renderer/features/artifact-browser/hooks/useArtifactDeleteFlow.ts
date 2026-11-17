import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactDeleteConfirmation } from "./useArtifactDeleteConfirmation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseArtifactDeleteFlowParams {
  client: DesktopArtifactBrowserClient;
  refreshArtifacts: () => Promise<void>;
  captureSelectionClear: (storageKey: string) => () => void;
  setViewState: (value: ArtifactBrowserViewState) => void;
  workspaceId?: string;
}

export function useArtifactDeleteFlow({
  client,
  refreshArtifacts,
  captureSelectionClear,
  setViewState,
  workspaceId,
}: UseArtifactDeleteFlowParams) {
  const confirmation = useArtifactDeleteConfirmation();
  const scope = useMemo(() => ({ lease: undefined as object | undefined }), [client, workspaceId]);
  const activeScope = useRef(scope), pending = useRef(false);
  const latestRefresh = useRef(refreshArtifacts);
  const [isDeleting, setIsDeleting] = useState(false);

  useLayoutEffect(() => { latestRefresh.current = refreshArtifacts; }, [refreshArtifacts]);

  useLayoutEffect(() => {
    const lease = {}; scope.lease = lease; activeScope.current = scope;
    confirmation.cancelPendingDelete();
    return () => { if (scope.lease === lease) scope.lease = undefined; };
  }, [scope]);

  async function confirmPendingDelete(): Promise<void> {
    const lease = scope.lease;
    const current = () => Boolean(lease) && scope.lease === lease && activeScope.current === scope;
    if (!current() || pending.current || !confirmation.pendingDeleteConfirmation) {
      return;
    }

    if (confirmation.deleteConfirmationInput !== "Delete") {
      setViewState({ status: "error", message: "Delete cancelled: typed confirmation must be exactly Delete." });
      return;
    }

    const target = confirmation.pendingDeleteConfirmation;
    const clearDeletedSelection = target.kind === "registered" ? captureSelectionClear(target.storageKey) : undefined;
    pending.current = true; setIsDeleting(true);
    setViewState({ status: "loading", message: `Deleting ${target.storageKey}...` });
    try {
      const remove = target.kind === "registered" ? client.deleteRegisteredArtifact : client.deleteUnregisteredArtifact;
      if (!remove) throw new Error("Artifact delete flow is unavailable.");
      await remove.call(client, { storageKey: target.storageKey, workspaceId });
      if (!current()) return;
      confirmation.cancelPendingDelete();
      clearDeletedSelection?.();
      await latestRefresh.current();
      if (current()) setViewState({ status: "success", message: `Deleted ${target.storageKey}.` });
    } catch (error) {
      if (current()) setViewState({ status: "error", message: error instanceof Error ? error.message : "Failed to delete artifact." });
    } finally {
      pending.current = false;
      if (activeScope.current.lease) setIsDeleting(false);
    }
  }

  return {
    pendingDeleteConfirmation: confirmation.pendingDeleteConfirmation,
    isDeleting,
    deleteConfirmationInput: confirmation.deleteConfirmationInput,
    requestDeleteUnregisteredArtifact: (storageKey: string) => { if (scope.lease && !pending.current) confirmation.requestDeleteUnregisteredArtifact(storageKey); },
    requestDeleteRegisteredArtifact: (storageKey: string) => { if (scope.lease && !pending.current) confirmation.requestDeleteRegisteredArtifact(storageKey); },
    setDeleteConfirmationInput: confirmation.setDeleteConfirmationInput,
    cancelPendingDelete: confirmation.cancelPendingDelete,
    confirmPendingDelete,
  };
}
