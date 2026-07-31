import type { AssetReference } from "../../../contracts/asset";
import type { AssetStudioPatchProposal } from "../../../contracts/asset-studio";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetCodingModelRequest {
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly intent: string;
  readonly context: readonly { readonly id: string; readonly kind: "contract" | "template" | "source" | "test"; readonly content: string }[];
  readonly allowedDependencies: readonly string[];
  readonly allowedCapabilities: readonly string[];
  readonly maxOutputCharacters: number;
  readonly timeoutMs: number;
  readonly abortSignal?: AbortSignal;
}

export interface AssetCodingModelPort {
  propose(request: AssetCodingModelRequest): Promise<AssetStudioPatchProposal>;
}
