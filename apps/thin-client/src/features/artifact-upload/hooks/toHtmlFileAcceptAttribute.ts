import type { ThinClientArtifactUploadAcceptedTypePolicy } from "../api/apiArtifactUploadClient";

export function toHtmlFileAcceptAttribute(policy: ThinClientArtifactUploadAcceptedTypePolicy): string {
  return [...policy.acceptedExtensions, ...policy.acceptedMediaTypes].join(",");
}
