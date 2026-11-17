import type { ImageGenerationRequest } from "./image-generation-request";
import { readStrictPassiveRecord, copyBoundedPassiveData } from "../shared";

const MAXIMUM_PROMPT_CHARACTERS = 10_000;
const MAXIMUM_NEGATIVE_PROMPT_CHARACTERS = 10_000;
const MAXIMUM_IMAGE_DIMENSION = 4_096;
const MAXIMUM_IMAGE_PIXELS = 16_777_216;
const MAXIMUM_STEPS = 200;
const MAXIMUM_IMAGES = 8;
const REQUEST_FIELDS = ["prompt","negativePrompt","seed","width","height","steps","cfg","denoise","sampler","scheduler","model","numImages","latentSource","faceId","engineHints"];

function assertOptionalBoundedInteger(
  value: number | undefined,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < minimum || value > maximum)
  ) {
    throw new Error(
      `Image generation ${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

export function assertImageGenerationRequestBounds(request: ImageGenerationRequest): void {
  const fields = readStrictPassiveRecord(request, REQUEST_FIELDS);
  request = fields as unknown as ImageGenerationRequest;
  for (const value of [request.sampler, request.scheduler]) {
    if (value !== undefined && typeof value !== 'string') throw new Error('Image generation sampler and scheduler must be strings.');
  }
  if (
    typeof request.prompt !== "string" ||
    request.prompt.trim().length === 0
  ) {
    throw new Error("Image generation requires a non-empty prompt.");
  }
  if (request.prompt.length > MAXIMUM_PROMPT_CHARACTERS) {
    throw new Error("Image generation prompt exceeds the maximum length.");
  }
  if (
    request.negativePrompt !== undefined &&
    (typeof request.negativePrompt !== "string" || request.negativePrompt.length > MAXIMUM_NEGATIVE_PROMPT_CHARACTERS)
  ) {
    throw new Error(
      "Image generation negative prompt exceeds the maximum length.",
    );
  }
  assertOptionalBoundedInteger(
    request.width,
    "width",
    64,
    MAXIMUM_IMAGE_DIMENSION,
  );
  assertOptionalBoundedInteger(
    request.height,
    "height",
    64,
    MAXIMUM_IMAGE_DIMENSION,
  );
  if (
    (request.width ?? 1) * (request.height ?? 1) >
    MAXIMUM_IMAGE_PIXELS
  ) {
    throw new Error("Image generation dimensions exceed the pixel budget.");
  }
  assertOptionalBoundedInteger(request.steps, "steps", 1, MAXIMUM_STEPS);
  assertOptionalBoundedInteger(
    request.numImages,
    "image count",
    1,
    MAXIMUM_IMAGES,
  );
  if (
    request.cfg !== undefined &&
    (!Number.isFinite(request.cfg) || request.cfg <= 0 || request.cfg > 50)
  ) {
    throw new Error("Image generation CFG must be between 0 and 50.");
  }
  if (
    request.denoise !== undefined &&
    (!Number.isFinite(request.denoise) ||
      request.denoise < 0 ||
      request.denoise > 1)
  ) {
    throw new Error("Image generation denoise must be between 0 and 1.");
  }
  if (request.seed !== undefined && !Number.isSafeInteger(request.seed)) {
    throw new Error("Image generation seed must be a safe integer.");
  }
  if (request.faceId !== undefined) {
    const face = readStrictPassiveRecord(copyBoundedPassiveData(request.faceId), ["enabled","references","identityStrength","structureStrength","noise"]);
    if (typeof face.enabled !== "boolean" || !Array.isArray(face.references) || face.references.some(reference =>
      !reference || typeof reference !== "object" || typeof reference.artifactId !== "string" || !reference.artifactId.trim())) {
      throw new Error("Image generation face references are invalid.");
    }
    for (const name of ['identityStrength','structureStrength','noise']) {
      if (face[name] !== undefined && (typeof face[name] !== 'number' || !Number.isFinite(face[name])))
        throw new Error('Image generation face configuration is invalid.');
    }
    for (const reference of face.references) {
      const item = readStrictPassiveRecord(reference, ['artifactId','weight']);
      if (item.weight !== undefined && (typeof item.weight !== 'number' || !Number.isFinite(item.weight)))
        throw new Error('Image generation face reference weight is invalid.');
    }
  }
  if ((request.faceId?.references.length ?? 0) > 3) {
    throw new Error(
      "Image generation supports at most three face reference artifacts.",
    );
  }
  if (
    request.model !== undefined &&
    (typeof request.model !== "string" || request.model.trim().length === 0 || request.model.length > 512)
  ) {
    throw new Error("Image generation model reference is invalid.");
  }
  if (request.engineHints !== undefined) {
    const hints = copyBoundedPassiveData(request.engineHints);
    if (!hints || typeof hints !== 'object' || Array.isArray(hints) || JSON.stringify(hints).length > 4_096)
      throw new Error("Image generation engine hints exceed the request budget.");
  }
  if (request.latentSource !== undefined) {
    const latent = readStrictPassiveRecord(request.latentSource, ["kind","artifactId"]);
    if (!["empty","artifact"].includes(latent.kind as string) ||
      (latent.kind === "artifact" && typeof latent.artifactId !== "string") ||
      (latent.kind === "empty" && latent.artifactId !== undefined)) {
      throw new Error("Image generation latent source is invalid.");
    }
  }
  if (
    request.latentSource?.kind === "artifact" &&
    request.latentSource.artifactId.trim().length === 0
  ) {
    throw new Error(
      "Image generation latent artifact id is required when using an artifact latent source.",
    );
  }
}

/** Own the admitted data across awaits; prompt text is preserved, never display-sanitized. */
export function snapshotBoundedImageGenerationRequest(request: ImageGenerationRequest): ImageGenerationRequest {
  const input = readStrictPassiveRecord(request, REQUEST_FIELDS) as unknown as ImageGenerationRequest;
  assertImageGenerationRequestBounds(input);
  return {
    ...input,
    ...(input.latentSource === undefined ? {} : {latentSource: {...readStrictPassiveRecord(input.latentSource, ["kind","artifactId"])} as ImageGenerationRequest['latentSource']}),
    ...(input.faceId === undefined ? {} : {faceId: copyBoundedPassiveData(input.faceId) as ImageGenerationRequest['faceId']}),
    ...(input.engineHints === undefined ? {} : {engineHints: copyBoundedPassiveData(input.engineHints) as ImageGenerationRequest['engineHints']}),
  };
}

