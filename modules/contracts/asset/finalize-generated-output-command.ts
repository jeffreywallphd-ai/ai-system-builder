import type { AssetReference } from "./asset-reference";
import type { AssetMutationCommandBase } from "./asset-mutation-command";
import type { WorkspaceId } from "../workspace";

export interface FinalizeGeneratedOutputCommand
  extends AssetMutationCommandBase<"asset.finalize-generated-output"> {
  readonly workspaceId: WorkspaceId;
  readonly viewId?: string;
  readonly generatedOutputId?: string;
  readonly targetDefinitionRef?: AssetReference;
  readonly displayName?: string;
}
