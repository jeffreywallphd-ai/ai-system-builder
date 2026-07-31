import type { AssetConfiguration } from "./asset-configuration";
import type { AssetReference } from "./asset-reference";
import type { AssetMutationCommandBase } from "./asset-mutation-command";

export interface RegisterResourceBackedViewCommand
  extends AssetMutationCommandBase<"asset.register-resource-backed-view"> {
  readonly viewId: string;
  readonly targetDefinitionRef?: AssetReference;
  readonly displayName?: string;
  readonly selectedConfiguration?: AssetConfiguration;
}
