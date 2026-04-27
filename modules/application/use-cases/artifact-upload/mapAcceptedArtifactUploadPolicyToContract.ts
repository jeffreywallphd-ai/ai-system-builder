import type { ArtifactUploadAcceptedTypePolicy } from "../../../contracts/artifact-upload";
import type { AcceptedArtifactUploadPolicy } from "../../../domain";

export function mapAcceptedArtifactUploadPolicyToContract(
  policy: AcceptedArtifactUploadPolicy,
): ArtifactUploadAcceptedTypePolicy {
  return {
    acceptedMediaTypes: policy.acceptedMediaTypes,
    acceptedExtensions: policy.acceptedExtensions,
  };
}
