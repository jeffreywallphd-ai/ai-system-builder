import { describe, expect, it } from "../../../../testing/node-test";

import { mapImageGenerationRequestToComfyUiPrompt } from "../comfyUiImageGenerationWorkflowMapper";

describe("comfyUiImageGenerationWorkflowMapper", () => {
  it("maps prompt/negative prompt", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt({ prompt: "sunset", negativePrompt: "blurry" }, { defaultCheckpoint: "sdxl.safetensors" });
    expect(payload.prompt["2"].inputs.text).toBe("sunset");
    expect(payload.prompt["3"].inputs.text).toBe("blurry");
  });

  it("applies defaults and supports seed/dimensions/steps", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt({ prompt: "test", seed: 77, width: 512, height: 768, steps: 22, cfg: 6.5, denoise: 0.72 }, { defaultCheckpoint: "sdxl.safetensors", defaultSampler: "euler", defaultScheduler: "karras" });
    expect(payload.prompt["4"].inputs.width).toBe(512);
    expect(payload.prompt["4"].inputs.height).toBe(768);
    expect(payload.prompt["5"].inputs.steps).toBe(22);
    expect(payload.prompt["5"].inputs.seed).toBe(77);
    expect(payload.prompt["5"].inputs.cfg).toBe(6.5);
    expect(payload.prompt["5"].inputs.denoise).toBe(0.72);
  });

  it("maps multiple text-to-image outputs through latent batch size", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt({ prompt: "test", numImages: 3 }, { defaultCheckpoint: "sdxl.safetensors" });
    expect(payload.prompt["4"].inputs.batch_size).toBe(3);
    expect(payload.prompt["5"].inputs.latent_image).toEqual(["4", 0]);
  });

  it("uses dpmpp_2m and karras as sampler defaults", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt({ prompt: "test" }, { defaultCheckpoint: "sdxl.safetensors" });
    expect(payload.prompt["5"].inputs.sampler_name).toBe("dpmpp_2m");
    expect(payload.prompt["5"].inputs.scheduler).toBe("karras");
  });

  it("routes artifact latent references through ResizeAndPadImage at requested dimensions", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt(
      { prompt: "test", width: 640, height: 384, latentSource: { kind: "artifact", artifactId: "uploads/cat.png" } },
      { defaultCheckpoint: "sdxl.safetensors", latentReferenceImageName: "cat.png" },
    );
    expect(payload.prompt["8"]).toEqual({ class_type: "LoadImage", inputs: { image: "cat.png" } });
    expect(payload.prompt["9"]).toEqual({ class_type: "ResizeAndPadImage", inputs: { image: ["8", 0], target_width: 640, target_height: 384, padding_color: "black", interpolation: "area" } });
    expect(payload.prompt["10"]).toEqual({ class_type: "VAEEncode", inputs: { pixels: ["9", 0], vae: ["1", 2] } });
    expect(payload.prompt["5"].inputs.latent_image).toEqual(["10", 0]);
  });

  it("repeats artifact latent references when generating multiple images", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt(
      { prompt: "test", width: 640, height: 384, numImages: 2, latentSource: { kind: "artifact", artifactId: "uploads/cat.png" } },
      { defaultCheckpoint: "sdxl.safetensors", latentReferenceImageName: "cat.png" },
    );
    expect(payload.prompt["11"]).toEqual({ class_type: "RepeatLatentBatch", inputs: { samples: ["10", 0], amount: 2 } });
    expect(payload.prompt["5"].inputs.latent_image).toEqual(["11", 0]);
  });

  it("throws a clear configuration error when checkpoint is missing", () => {
    expect(() => mapImageGenerationRequestToComfyUiPrompt({ prompt: "x" }, {})).toThrow("requires a model checkpoint");
  });

  it("preserves explicit seed and randomizes when missing", () => {
    const explicit = mapImageGenerationRequestToComfyUiPrompt({ prompt: "seeded", seed: 42 }, { defaultCheckpoint: "sdxl.safetensors" });
    const implicit = mapImageGenerationRequestToComfyUiPrompt({ prompt: "random" }, { defaultCheckpoint: "sdxl.safetensors" });
    expect(explicit.prompt["5"].inputs.seed).toBe(42);
    expect(explicit.prompt["5"].inputs.control_after_generate).toBe("fixed");
    expect(implicit.prompt["5"].inputs.seed).not.toBe(0);
    expect(implicit.prompt["5"].inputs.control_after_generate).toBe("randomize");
  });

  it("maps faceId references to a built-in image-to-image workflow when prepared references are provided", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt(
      { prompt: "portrait", faceId: { enabled: true, references: [{ artifactId: "face-a.png" }], identityStrength: 0.9, structureStrength: 0.6, noise: 0.2 } },
      { defaultCheckpoint: "sdxl.safetensors", faceReferenceImageNames: ["prepared-face.png"] },
    );
    expect(payload.prompt["17"]).toEqual({ class_type: "LoadImage", inputs: { image: "prepared-face.png" } });
    expect(payload.prompt["18"]).toEqual({ class_type: "VAEEncode", inputs: { pixels: ["17", 0], vae: ["1", 2] } });
    expect(payload.prompt["5"].inputs.positive).toEqual(["2", 0]);
    expect(payload.prompt["5"].inputs.latent_image).toEqual(["18", 0]);
    expect(Object.values(payload.prompt).map((node) => node.class_type)).not.toContain("InstantIDModelLoader");
  });

  it("repeats FaceID image latents when generating multiple images", () => {
    const payload = mapImageGenerationRequestToComfyUiPrompt(
      { prompt: "portrait", numImages: 2, faceId: { enabled: true, references: [{ artifactId: "face-a.png" }] } },
      { defaultCheckpoint: "sdxl.safetensors", faceReferenceImageNames: ["prepared-face.png"] },
    );
    expect(payload.prompt["11"]).toEqual({ class_type: "RepeatLatentBatch", inputs: { samples: ["18", 0], amount: 2 } });
    expect(payload.prompt["5"].inputs.latent_image).toEqual(["11", 0]);
  });
});
