import type { ContractBoundaryContext } from "../shared";
import {
  normalizeStagedArtifactDescriptorInput,
  type StagedArtifactDescriptorInput,
  type StagedArtifactMetadata,
} from "./staged-artifact-descriptor";

export interface RegisterStagedArtifactRequest<
  TContent = Uint8Array,
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> extends ContractBoundaryContext {
  descriptor: StagedArtifactDescriptorInput<TMetadata>;
  content: TContent;
  overwrite?: boolean;
}

export function createRegisterStagedArtifactRequest<
  TContent,
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  content: TContent,
  options?: {
    descriptor?: StagedArtifactDescriptorInput<TMetadata>;
    overwrite?: boolean;
    requestId?: string;
    correlationId?: string;
  },
): RegisterStagedArtifactRequest<TContent, TMetadata> {
  return {
    descriptor: normalizeStagedArtifactDescriptorInput(options?.descriptor),
    content,
    overwrite: options?.overwrite,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
