import type { AssetDefinition } from "../../../contracts/asset";
import type { AssetDerivedCustomizationDraftRecord } from "../../../contracts/asset-authoring";
import type { AssetStudioAssetDraftRecord } from "../../../contracts/asset-studio";

/** Commit the exact current review and its definition in one owning record transaction. */
export interface AssetDefinitionPublicationPort {
  publishStudio(command: {
    readonly current: AssetStudioAssetDraftRecord;
    readonly definition: AssetDefinition;
    readonly publishedAt: string;
    readonly actorId: string;
  }): Promise<AssetStudioAssetDraftRecord>;
  publishDerived(command: {
    readonly current: AssetDerivedCustomizationDraftRecord;
    readonly definition: AssetDefinition;
    readonly baseDefinition: AssetDefinition;
    readonly publishedAt: string;
    readonly actorId: string;
  }): Promise<AssetDerivedCustomizationDraftRecord>;
}
