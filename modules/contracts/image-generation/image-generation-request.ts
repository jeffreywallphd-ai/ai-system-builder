export type ImageGenerationLatentSource =
  | { kind: "empty" }
  | { kind: "artifact"; artifactId: string };

export interface ImageGenerationFaceReference {
  artifactId: string;
  weight?: number;
}

export interface ImageGenerationFaceIdConfig {
  enabled: boolean;
  references: ImageGenerationFaceReference[];
  identityStrength?: number;
  structureStrength?: number;
  noise?: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  denoise?: number;
  sampler?: string;
  scheduler?: string;
  model?: string;
  numImages?: number;
  latentSource?: ImageGenerationLatentSource;
  faceId?: ImageGenerationFaceIdConfig;
  engineHints?: Record<string, unknown>;
}
