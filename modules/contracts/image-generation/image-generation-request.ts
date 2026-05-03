export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  sampler?: string;
  scheduler?: string;
  model?: string;
  numImages?: number;
  engineHints?: Record<string, unknown>;
}
