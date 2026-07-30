export interface ArtifactIntakeCandidate {
  fileName: string;
  mediaType: string;
  bytesLength: number;
  bytes: Uint8Array;
}

export function createArtifactIntakeCandidate(input: {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}): ArtifactIntakeCandidate {
  return {
    fileName: input.fileName.trim(),
    mediaType: input.mediaType.trim().toLowerCase(),
    bytesLength: input.bytes.byteLength,
    bytes: input.bytes,
  };
}
