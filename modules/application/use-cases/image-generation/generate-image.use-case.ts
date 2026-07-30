import { isWorkspaceId } from "../../../contracts/workspace";
import type { ImageGenerationRequest } from "../../../contracts/image-generation";
import {
  TaskType,
  type CancelRuntimeTaskResult,
  type RuntimeTaskStatusRecord,
  type StartRuntimeTaskResult,
} from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { RuntimeCapabilityGuardService } from "../../services/runtime";
import type { ModelCheckpointResolverPort } from "../../ports/model";

import type { ApplicationRequestContext } from "../../ports";

const MAXIMUM_PROMPT_CHARACTERS = 10_000;
const MAXIMUM_NEGATIVE_PROMPT_CHARACTERS = 10_000;
const MAXIMUM_IMAGE_DIMENSION = 4_096;
const MAXIMUM_IMAGE_PIXELS = 16_777_216;
const MAXIMUM_STEPS = 200;
const MAXIMUM_IMAGES = 8;

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

function assertValidRequest(request: ImageGenerationRequest): void {
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
    request.negativePrompt.length > MAXIMUM_NEGATIVE_PROMPT_CHARACTERS
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
  if ((request.faceId?.references.length ?? 0) > 3) {
    throw new Error(
      "Image generation supports at most three face reference artifacts.",
    );
  }
  if (
    request.model !== undefined &&
    (request.model.trim().length === 0 || request.model.length > 512)
  ) {
    throw new Error("Image generation model reference is invalid.");
  }
  if (
    request.engineHints !== undefined &&
    JSON.stringify(request.engineHints).length > 4_096
  ) {
    throw new Error("Image generation engine hints exceed the request budget.");
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

export class GenerateImageUseCase {
  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      modelCheckpointResolver?: ModelCheckpointResolverPort;
      runtimeCapabilityGuard?: Pick<
        RuntimeCapabilityGuardService,
        "requireCapabilityReady"
      >;
    },
  ) {}

  public async startImageGeneration(
    request: ImageGenerationRequest,
    context?: ApplicationRequestContext,
  ): Promise<StartRuntimeTaskResult> {
    if (!isWorkspaceId(context?.workspaceId)) {
      throw new Error("Workspace id is required for image generation.");
    }
    assertValidRequest(request);

    const resolvedModel =
      await this.dependencies.modelCheckpointResolver?.resolveCheckpoint({
        selectedModel: request.model,
        workspaceId: context.workspaceId,
        taskTag: "text-to-image",
      });
    const { runtimeDeviceMode: _ignoredRuntimeDeviceMode, ...safeEngineHints } =
      request.engineHints ?? {};
    const boundedRequest = {
      ...request,
      ...(Object.keys(safeEngineHints).length > 0
        ? { engineHints: safeEngineHints }
        : { engineHints: undefined }),
    };
    const payload = resolvedModel?.checkpoint
      ? { ...boundedRequest, model: resolvedModel.checkpoint }
      : boundedRequest;

    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady(
      "image-generation",
    );

    const result = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.IMAGE_GENERATION,
      payload,
      requestId: context?.requestId,
      workspaceId: context.workspaceId,
      metadata: { workspaceId: context.workspaceId },
    });

    return result;
  }

  public async readImageGeneration(
    requestId: string,
    _context?: ApplicationRequestContext,
  ): Promise<RuntimeTaskStatusRecord> {
    return this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
  }

  public async cancelImageGeneration(
    requestId: string,
    _context?: ApplicationRequestContext,
  ): Promise<CancelRuntimeTaskResult> {
    return this.dependencies.runtimeTaskRegistry.cancelTask(requestId);
  }
}
