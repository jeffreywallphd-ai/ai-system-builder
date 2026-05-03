import type { ImageGenerationOutput } from "../../../contracts/image-generation";

export interface PersistGeneratedImageInput {
  output: ImageGenerationOutput;
  assetId: string;
}

export interface PersistGeneratedImageResult {
  artifactId: string;
  originalFileName: string;
}

export interface GeneratedImagePersistencePort {
  persistGeneratedImage(input: PersistGeneratedImageInput): Promise<PersistGeneratedImageResult>;
}
