export const ARTIFACT_UPLOAD_MAXIMUM_BYTES = 64 * 1024 * 1024;

export interface ArtifactUploadAcceptedTypePolicy {
  acceptedMediaTypes: readonly string[];
  acceptedExtensions: readonly string[];
  maximumBytes?: number;
}
