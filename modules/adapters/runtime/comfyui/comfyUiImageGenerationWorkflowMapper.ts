import type { ImageGenerationRequest } from "../../../contracts/image-generation";

export interface ComfyUiImageGenerationWorkflowMapperOptions {
  defaultCheckpoint?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultSteps?: number;
  defaultSampler?: string;
  defaultScheduler?: string;
}

export interface ComfyUiPromptPayload {
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

export function mapImageGenerationRequestToComfyUiPrompt(
  request: ImageGenerationRequest,
  options: ComfyUiImageGenerationWorkflowMapperOptions,
): ComfyUiPromptPayload {
  const checkpoint = request.model ?? options.defaultCheckpoint;
  if (!checkpoint) {
    throw new Error("ComfyUI image generation requires a model checkpoint. Provide request.model or defaultCheckpoint.");
  }

  const width = request.width ?? options.defaultWidth ?? 1024;
  const height = request.height ?? options.defaultHeight ?? 1024;
  const steps = request.steps ?? options.defaultSteps ?? 30;
  const sampler = request.sampler ?? options.defaultSampler ?? "euler";
  const scheduler = request.scheduler ?? options.defaultScheduler ?? "normal";
  const seed = request.seed ?? (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1);

  return {
    prompt: {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: ["1", 1] } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: request.negativePrompt ?? "", clip: ["1", 1] } },
      "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: request.numImages ?? 1 } },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed,
          steps,
          cfg: 8,
          sampler_name: sampler,
          scheduler,
          denoise: 1,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
        },
      },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": { class_type: "SaveImage", inputs: { filename_prefix: "ai-system-builder", images: ["6", 0] } },
    },
  };
}
