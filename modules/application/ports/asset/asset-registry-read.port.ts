import type { AssetReference } from "../../../contracts/asset";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListQuery,
  AssetRegistryListResult,
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewCard,
  AssetRegistryResourceBackedViewDetail,
} from "../../services/asset/asset-registry-read-facade.types";

export interface AssetRegistryDefinitionReadPort {
  readDefinitionDetails?(refs: readonly AssetReference[], options?: AssetRegistryReadOptions): Promise<readonly (AssetDefinitionDetail | undefined)[]>;
  listDefinitionCards(query?: AssetRegistryListQuery): Promise<AssetRegistryListResult<AssetDefinitionCard>>;
  readDefinitionDetail(ref: AssetReference, options?: AssetRegistryReadOptions): Promise<AssetDefinitionDetail | undefined>;
  listResourceBackedViewCards?(query?: AssetRegistryListQuery): Promise<AssetRegistryListResult<AssetRegistryResourceBackedViewCard>>;
  readResourceBackedViewDetail?(viewId: string, options?: AssetRegistryReadOptions): Promise<AssetRegistryResourceBackedViewDetail | undefined>;
}
