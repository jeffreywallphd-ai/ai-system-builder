import { useMemo } from "react";

import type { AssetLibraryClient } from "../../../../../../../modules/ui/shared/asset-library";
import {
  useAssetLibraryDefinitionBrowser,
  type AssetLibraryFeatureState,
  type AssetLibraryFiltersState,
  type AssetLibraryFilterValue,
} from "../../../../../../../modules/ui/shared/asset-library";
import { createDesktopAssetLibraryClient } from "../api/desktopAssetLibraryClient";

export type {
  AssetLibraryFeatureState,
  AssetLibraryFiltersState,
  AssetLibraryFilterValue,
};

export function useAssetLibraryFeature(client?: AssetLibraryClient, workspaceId?: string): AssetLibraryFeatureState {
  const defaultClient = useMemo(() => client ?? createDesktopAssetLibraryClient(), [client]);
  return useAssetLibraryDefinitionBrowser(defaultClient, workspaceId);
}
