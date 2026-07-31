import { useMemo } from "react";

import type { AssetLibraryClient } from "../../../../../../modules/ui/shared/asset-library";
import {
  useAssetLibraryDefinitionBrowser,
  type AssetLibraryFeatureState,
  type AssetLibraryFiltersState,
  type AssetLibraryFilterValue,
} from "../../../../../../modules/ui/shared/asset-library/assetLibraryBrowser";
import { createApiAssetLibraryClient } from "../api/apiAssetLibraryClient";

export type {
  AssetLibraryFeatureState,
  AssetLibraryFiltersState,
  AssetLibraryFilterValue,
};

export function useAssetLibraryFeature(client?: AssetLibraryClient, workspaceId?: string): AssetLibraryFeatureState {
  const defaultClient = useMemo(() => client ?? createApiAssetLibraryClient(), [client]);
  return useAssetLibraryDefinitionBrowser(defaultClient, workspaceId);
}
