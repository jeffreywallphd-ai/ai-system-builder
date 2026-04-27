import type { ArtifactUploadAcceptedTypePolicy } from "../api/desktopArtifactUploadClient";

export function toHtmlFileAcceptAttribute(policy: ArtifactUploadAcceptedTypePolicy): string {
  return [...policy.acceptedExtensions, ...policy.acceptedMediaTypes].join(",");
}
