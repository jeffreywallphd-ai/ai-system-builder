import type { AssetReference } from "./asset-reference";
import type { AssetMutationCommandBase } from "./asset-mutation-command";

export const ASSET_EXTERNAL_REPOSITORY_IMPORT_MODES = [
  "remote-reference",
  "catalog-registration",
] as const;

export type AssetExternalRepositoryImportMode =
  (typeof ASSET_EXTERNAL_REPOSITORY_IMPORT_MODES)[number];

export interface ImportExternalRepositoryObjectCommand
  extends AssetMutationCommandBase<"asset.import-external-repository-object"> {
  readonly viewId: string;
  readonly importMode?: AssetExternalRepositoryImportMode;
  readonly targetDefinitionRef?: AssetReference;
}
