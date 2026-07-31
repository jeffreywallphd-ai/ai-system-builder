import type { ImageGenerationRequest } from "../../../contracts/image-generation";

export interface ComfyUiImageGenerationWorkflowMapperOptions {
  defaultCheckpoint?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultSteps?: number;
  latentReferenceImageName?: string;
  faceReferenceImageNames?: string[];
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
  const cfg = request.cfg ?? 8;
  const denoise = request.denoise ?? 1;
  const sampler = request.sampler ?? options.defaultSampler ?? "dpmpp_2m";
  const scheduler = request.scheduler ?? options.defaultScheduler ?? "karras";
  const seed = request.seed ?? (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1);
  const controlAfterGenerate = request.seed === undefined ? "randomize" : "fixed";
  const numImages = Math.max(Math.floor(request.numImages ?? 1), 1);
  const hasLatentReference = request.latentSource?.kind === "artifact" && Boolean(options.latentReferenceImageName);
  const faceIdReferences = (request.faceId?.enabled ? request.faceId.references : undefined) ?? [];
  const faceReferenceImageName = options.faceReferenceImageNames?.find((imageName) => imageName.trim().length > 0);
  const hasFaceReference = faceIdReferences.length > 0 && Boolean(faceReferenceImageName) && !hasLatentReference;
  const encodedLatentSource = hasLatentReference ? ["10", 0] : hasFaceReference ? ["18", 0] : undefined;
  const latentSource = encodedLatentSource && numImages > 1 ? ["11", 0] : encodedLatentSource ?? ["4", 0];

  const prompt: ComfyUiPromptPayload["prompt"] = {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: ["1", 1] } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: request.negativePrompt ?? "", clip: ["1", 1] } },
      "4": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: numImages } },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed,
          control_after_generate: controlAfterGenerate,
          steps,
          cfg,
          sampler_name: sampler,
          scheduler,
          denoise,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: latentSource,
        },
      },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": { class_type: "SaveImage", inputs: { filename_prefix: "ai-system-builder", images: ["6", 0] } },
  };

  if (request.latentSource?.kind === "artifact" && options.latentReferenceImageName) {
    prompt["8"] = { class_type: "LoadImage", inputs: { image: options.latentReferenceImageName } };
    prompt["9"] = { class_type: "ResizeAndPadImage", inputs: { image: ["8", 0], target_width: width, target_height: height, padding_color: "black", interpolation: "area" } };
    prompt["10"] = { class_type: "VAEEncode", inputs: { pixels: ["9", 0], vae: ["1", 2] } };
  }
  if (hasFaceReference) {
    prompt["17"] = { class_type: "LoadImage", inputs: { image: faceReferenceImageName } };
    prompt["18"] = { class_type: "VAEEncode", inputs: { pixels: ["17", 0], vae: ["1", 2] } };
  }
  if (encodedLatentSource && numImages > 1) {
    prompt["11"] = { class_type: "RepeatLatentBatch", inputs: { samples: encodedLatentSource, amount: numImages } };
  }

  return { prompt };
}

