import type {
  AssetDefinition,
  AssetFamily,
  AssetLifecycleStatus,
  AssetReference,
  AssetReviewStatus,
  AssetType,
} from "../../../contracts/asset";

export interface AssetDefinitionListQuery {
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  /** Alternatives within each field are OR; different fields remain AND.
   * Apply these predicates before sorting/paging. Empty lists mean no filter. */
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly reviewStatus?: AssetReviewStatus;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetDefinitionListResult {
  readonly definitions: readonly AssetDefinition[];
  readonly nextCursor?: string;
}

export interface AssetDefinitionRepositoryPort {
  saveDefinition(definition: AssetDefinition): Promise<AssetDefinition>;
  /** At most250 unique exact identities. Atomically compare expected original bodies
   * on every retry before replacing the collection; undefined means absent. */
  saveDefinitions?(definitions: readonly AssetDefinition[], expected: readonly (AssetDefinition | undefined)[]): Promise<readonly AssetDefinition[]>;
  getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined>;
  /** Bounded ordered lookup; missing references retain their position. */
  getDefinitions?(references: readonly AssetReference[]): Promise<readonly (AssetDefinition | undefined)[]>;
  listDefinitions(query?: AssetDefinitionListQuery): Promise<AssetDefinitionListResult>;
  deleteDefinition?(reference: AssetReference): Promise<void>;
}
