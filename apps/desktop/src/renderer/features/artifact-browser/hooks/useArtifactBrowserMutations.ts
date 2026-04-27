import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

interface UseArtifactBrowserMutationsParams {
  client: DesktopArtifactBrowserClient;
  refreshArtifacts: () => Promise<void>;
  setViewState: (value: ArtifactBrowserViewState) => void;
}

export function useArtifactBrowserMutations({
  client,
  refreshArtifacts,
  setViewState,
}: UseArtifactBrowserMutationsParams) {
  async function registerUnregisteredArtifact(storageKey: string): Promise<void> {
    setViewState({ status: "loading", message: `Registering ${storageKey}...` });
    try {
      if (!client.registerUnregisteredArtifact) {
        throw new Error("Unregistered artifact register flow is unavailable.");
      }
      await client.registerUnregisteredArtifact({ storageKey });
      await refreshArtifacts();
      setViewState({ status: "success", message: `Registered ${storageKey}.` });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to register unregistered artifact.",
      });
    }
  }

  return {
    registerUnregisteredArtifact,
  };
}
