export interface ArtifactIntakeCandidate {
  fileName: string;
  mediaType: string;
  bytesLength: number;
}

export function createArtifactIntakeCandidate(input: {
  fileName: string;
  mediaType: string;
  bytesLength: number;
}): ArtifactIntakeCandidate {
  return {
    fileName: input.fileName.trim(),
    mediaType: input.mediaType.trim().toLowerCase(),
    bytesLength: input.bytesLength,
  };
}
