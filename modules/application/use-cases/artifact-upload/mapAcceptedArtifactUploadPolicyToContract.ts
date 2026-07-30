import type { ArtifactUploadAcceptedTypePolicy } from "../../../contracts/artifact-upload";
import type { AcceptedArtifactUploadPolicy } from "../../../domain";
import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../store-artifact-upload.types";

export function mapAcceptedArtifactUploadPolicyToContract(
  policy: AcceptedArtifactUploadPolicy,
  maximumBytes = ARTIFACT_UPLOAD_MAXIMUM_BYTES,
): ArtifactUploadAcceptedTypePolicy {
  return {
    acceptedMediaTypes: policy.acceptedMediaTypes,
    acceptedExtensions: policy.acceptedExtensions,
    maximumBytes,
  };
}
