import { randomUUID } from "node:crypto";
import type { ImageGenerationTaskAuthorityService } from "../../services/image/image-generation-task-authority.service";
import type { OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";
import { isWorkspaceId } from "../../../contracts/workspace";
import { snapshotBoundedImageGenerationRequest, type ImageGenerationRequest } from "../../../contracts/image-generation";
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

export class GenerateImageUseCase {
  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      taskAuthority: ImageGenerationTaskAuthorityService;
      taskReconciler?: OwnedTaskReconcilerService;
      createRequestId?: () => string;
      modelCheckpointResolver?: ModelCheckpointResolverPort;
      runtimeCapabilityGuard?: Pick<
        RuntimeCapabilityGuardService,
        "requireCapabilityReady"
      >;
    },
  ) {}

  public async startImageGeneration(request: ImageGenerationRequest, context?: ApplicationRequestContext): Promise<StartRuntimeTaskResult> {
    return this.dependencies.taskReconciler ? this.dependencies.taskReconciler.withLease("image", (lease) => this.startOwned(request, context, lease)) : this.startOwned(request, context);
  }

  private async startOwned(
    request: ImageGenerationRequest,
    context?: ApplicationRequestContext,
    lifecycle?: ReturnType<OwnedTaskReconcilerService["reserve"]>,
  ): Promise<StartRuntimeTaskResult> {
    if (!isWorkspaceId(context?.workspaceId)) {
      throw new Error("Workspace id is required for image generation.");
    }
    request = snapshotBoundedImageGenerationRequest(request);

    const taskRequestId = this.dependencies.createRequestId?.() ?? randomUUID();
    const ownership = await this.dependencies.taskAuthority.reserve(taskRequestId, context.workspaceId);
    try {
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

    this.dependencies.taskReconciler?.assertAccepting();
    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady(
      "image-generation",
    );

    const result = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.IMAGE_GENERATION,
      payload,
      requestId: taskRequestId,
      workspaceId: context.workspaceId,
      metadata: { workspaceId: context.workspaceId, ...(context.organizationId ? { organizationId: context.organizationId } : {}) },
    });

    if (result.requestId !== taskRequestId) throw new Error("Image generation task acceptance identity is invalid.");
    ownership.accept();
    lifecycle?.start(async () => {
      // Internal cleanup observes only the accepted request; it does not publish
      // image assets or depend on a renderer retaining current write authority.
      const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(result.requestId);
      return !("recordType" in record) && record.workspaceId === context.workspaceId && (record.status === "succeeded" || record.status === "failed" || record.status === "cancelled");
    }, () => this.dependencies.runtimeTaskRegistry.cancelTask(result.requestId), async () => {});
    return result;
    } catch (error) { ownership.release(); lifecycle?.release(); throw error; }
  }

  public async readImageGeneration(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<RuntimeTaskStatusRecord> {
    await this.dependencies.taskAuthority.assertOwned(requestId, context?.workspaceId, "read");
    const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (!("recordType" in record) && (record.requestId !== requestId || record.workspaceId !== context?.workspaceId || record.taskType !== TaskType.IMAGE_GENERATION)) throw new Error("Image generation task was not found in this workspace.");
    return record;
  }

  public async cancelImageGeneration(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<CancelRuntimeTaskResult> {
    await this.dependencies.taskAuthority.assertOwned(requestId, context?.workspaceId, "write");
    return this.dependencies.runtimeTaskRegistry.cancelTask(requestId);
  }
}
