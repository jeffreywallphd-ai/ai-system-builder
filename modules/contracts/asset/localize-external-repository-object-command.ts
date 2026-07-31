import type { AssetReference } from "./asset-reference";
import type { AssetMutationCommandBase } from "./asset-mutation-command";

export interface LocalizeExternalRepositoryObjectCommand
  extends AssetMutationCommandBase<"asset.localize-external-repository-object"> {
  readonly viewId: string;
  readonly targetDefinitionRef?: AssetReference;
}
