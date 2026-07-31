import type {
  AssetCustomizationId,
  AssetDerivedCustomizationDraftRecord,
  ListAssetDerivedCustomizationsQuery,
} from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetDerivedCustomizationListResult {
  readonly records: readonly AssetDerivedCustomizationDraftRecord[];
  readonly nextCursor?: string;
}

export interface AssetDerivedCustomizationRepositoryPort {
  create(
    record: AssetDerivedCustomizationDraftRecord,
  ): Promise<AssetDerivedCustomizationDraftRecord>;
  read(
    workspaceId: WorkspaceId,
    customizationId: AssetCustomizationId,
  ): Promise<AssetDerivedCustomizationDraftRecord | undefined>;
  update(
    record: AssetDerivedCustomizationDraftRecord,
    expectedRevision: number,
  ): Promise<AssetDerivedCustomizationDraftRecord>;
  list(
    query: ListAssetDerivedCustomizationsQuery,
  ): Promise<AssetDerivedCustomizationListResult>;
}

