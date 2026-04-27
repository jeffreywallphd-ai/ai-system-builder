import { useCallback, useState } from "react";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type {
  DesktopArtifactBrowseItem,
  DesktopArtifactFamily,
  DesktopUnregisteredArtifactBrowseItem,
} from "../../../lib/desktopApi";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

interface UseArtifactBrowserArtifactsParams {
  client: DesktopArtifactBrowserClient;
  setViewState: (value: ArtifactBrowserViewState) => void;
}

export interface UseArtifactBrowserArtifactsResult {
  items: DesktopArtifactBrowseItem[];
  unregisteredItems: DesktopUnregisteredArtifactBrowseItem[];
  selectedArtifactFamily: DesktopArtifactFamily | "all";
  setSelectedArtifactFamily: (value: DesktopArtifactFamily | "all") => void;
  refreshArtifacts: () => Promise<void>;
}

export function useArtifactBrowserArtifacts({
  client,
  setViewState,
}: UseArtifactBrowserArtifactsParams): UseArtifactBrowserArtifactsResult {
  const [items, setItems] = useState<DesktopArtifactBrowseItem[]>([]);
  const [unregisteredItems, setUnregisteredItems] = useState<DesktopUnregisteredArtifactBrowseItem[]>([]);
  const [selectedArtifactFamily, setSelectedArtifactFamily] = useState<DesktopArtifactFamily | "all">("all");

  const refreshArtifacts = useCallback(async () => {
    setViewState({ status: "loading", message: "Loading artifacts..." });
    try {
      const [browseItems, unregistered] = await Promise.all([
        client.browseArtifacts(selectedArtifactFamily === "all" ? {} : { artifactFamily: selectedArtifactFamily }),
        client.browseUnregisteredArtifacts?.() ?? Promise.resolve([]),
      ]);

      setItems(browseItems);
      setUnregisteredItems(unregistered);
      setViewState({
        status: "success",
        message: (browseItems.length + unregistered.length) > 0
          ? "Loaded artifacts."
          : "No artifacts found yet.",
      });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load artifacts.",
      });
    }
  }, [client, selectedArtifactFamily, setViewState]);

  return {
    items,
    unregisteredItems,
    selectedArtifactFamily,
    setSelectedArtifactFamily,
    refreshArtifacts,
  };
}
