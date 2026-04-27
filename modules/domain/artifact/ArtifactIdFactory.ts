import { ArtifactId } from "./ArtifactId";

export interface ArtifactIdFactory {
  createArtifactId: () => ArtifactId;
}

export class SystemArtifactIdFactory implements ArtifactIdFactory {
  public createArtifactId(): ArtifactId {
    return ArtifactId.generate();
  }
}
