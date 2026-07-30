import type { AssetMutationActor } from "./asset-mutation-actor";
import type { AssetMutationApproval } from "./asset-mutation-approval";
import type { AssetMutationOperation } from "./asset-mutation-operation";
import type { AssetMutationRequestContext } from "./asset-mutation-request-context";
import type { WorkspaceId } from "../workspace";

export interface AssetMutationCommandBase<
  TOperation extends AssetMutationOperation = AssetMutationOperation,
> {
  readonly operation: TOperation;
  readonly workspaceId?: WorkspaceId;
  readonly approval: AssetMutationApproval;
  readonly actor: AssetMutationActor;
  readonly context?: AssetMutationRequestContext;
}
