import { randomUUID } from "node:crypto";
import {types} from "node:util";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import type {ApprovedImageGenerationAdmission, ApprovedImageGenerationFence} from "../../ports/image/approved-image-generation.port";
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

  /** Only a trusted approved-plan owner may supply this internal capability.
   * It is not decoded from transport DTOs. Accepted runtime ownership survives
   * later permission withdrawal; public disclosure is checked by its own owner. */
  public async startApprovedImageGeneration(request: ImageGenerationRequest, context: ApplicationRequestContext,
    admission: ApprovedImageGenerationAdmission): Promise<StartRuntimeTaskResult> {
    const denied = () => new Error("Approved image generation is unavailable.");
    const keys = ["isCurrent", "authorize", "resolveCheckpoint"];
    let captured: Record<string, unknown>;
    try {
      if (types.isProxy(admission)) throw denied();
      captured = readStrictPassiveRecord(admission, keys);
      if (keys.some(key => typeof captured[key] !== "function" || types.isProxy(captured[key]))) throw denied();
    } catch {throw denied();}
    const current = () => {
      try {
        const same = () => {
          const now = readStrictPassiveRecord(admission, keys);
          return keys.every(key => now[key] === captured[key]);
        };
        if (!same()) return false;
        const value: unknown = (captured.isCurrent as () => boolean).call(admission);
        if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
        return value === true && same();
      } catch {return false;}
    };
    const assertCurrent = () => {if (!current()) throw denied();};
    const authorize = async () => {
      if (!current()) throw denied();
      let allowed = false;
      try {allowed = await (captured.authorize as () => Promise<boolean>).call(admission) === true;} catch {}
      if (!allowed || !current()) throw denied();
    };
    const fence: ApprovedImageGenerationFence = Object.freeze({authorize, assertCurrent});
    // Detach caller data before the first policy wait, including workspace scope.
    const boundedRequest = snapshotBoundedImageGenerationRequest(request);
    const pinnedContext = Object.freeze({workspaceId: context.workspaceId, organizationId: context.organizationId,
      principalId: context.principalId, requestId: context.requestId, correlationId: context.correlationId});
    const resolver: ModelCheckpointResolverPort = {resolveCheckpoint: async selected => {
      await authorize(); assertCurrent();
      let value: Record<string, unknown>;
      try {
        const result = await (captured.resolveCheckpoint as ApprovedImageGenerationAdmission["resolveCheckpoint"])
          .call(admission, Object.freeze({...selected}), fence);
        if (types.isProxy(result)) throw denied();
        value = readStrictPassiveRecord(result, ["checkpoint"]);
      } catch {throw denied();}
      await authorize(); assertCurrent();
      const checkpoint = value.checkpoint;
      if (typeof checkpoint !== "string" || checkpoint.length > 240 ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]*\.safetensors$/.test(checkpoint) || checkpoint.includes("..")) throw denied();
      return {checkpoint};
    }};
    await authorize(); assertCurrent();
    const start = (lease?: ReturnType<OwnedTaskReconcilerService["reserve"]>) =>
      this.startOwned(boundedRequest, pinnedContext, lease, {fence, resolver});
    return this.dependencies.taskReconciler ? this.dependencies.taskReconciler.withLease("image", start) : start();
  }

  private async startOwned(
    request: ImageGenerationRequest,
    context?: ApplicationRequestContext,
    lifecycle?: ReturnType<OwnedTaskReconcilerService["reserve"]>,
    approved?: {fence: ApprovedImageGenerationFence; resolver: ModelCheckpointResolverPort},
  ): Promise<StartRuntimeTaskResult> {
    const workspaceId = context?.workspaceId;
    const organizationId = context?.organizationId;
    if (!isWorkspaceId(workspaceId)) {
      throw new Error("Workspace id is required for image generation.");
    }
    request = snapshotBoundedImageGenerationRequest(request);

    if (approved) {await approved.fence.authorize(); approved.fence.assertCurrent();}

    const taskRequestId = this.dependencies.createRequestId?.() ?? randomUUID();
    const ownership = await this.dependencies.taskAuthority.reserve(taskRequestId, workspaceId);
    try {
    if (approved) {await approved.fence.authorize(); approved.fence.assertCurrent();}
    const resolvedModel =
      await (approved?.resolver ?? this.dependencies.modelCheckpointResolver)?.resolveCheckpoint({
        selectedModel: request.model,
        workspaceId,
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
    if (approved) {await approved.fence.authorize(); approved.fence.assertCurrent();}
    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady(
      "image-generation",
    );

    if (approved) {
      await approved.fence.authorize(); approved.fence.assertCurrent();
      this.dependencies.taskReconciler?.assertAccepting();
    }

    const result = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.IMAGE_GENERATION,
      payload,
      requestId: taskRequestId,
      workspaceId,
      metadata: { workspaceId, ...(organizationId ? { organizationId } : {}) },
    });

    if (result.requestId !== taskRequestId) throw new Error("Image generation task acceptance identity is invalid.");
    ownership.accept();
    lifecycle?.start(async () => {
      // Internal cleanup observes only the accepted request; it does not publish
      // image assets or depend on a renderer retaining current write authority.
      const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(taskRequestId);
      return !("recordType" in record) && record.requestId === taskRequestId && record.taskType === TaskType.IMAGE_GENERATION &&
        record.workspaceId === workspaceId && (record.status === "succeeded" || record.status === "failed" || record.status === "cancelled");
    }, () => this.dependencies.runtimeTaskRegistry.cancelTask(taskRequestId), async () => {});
    return result;
    } catch (error) { ownership.release(); lifecycle?.release(); throw error; }
  }

  public async readImageGeneration(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<RuntimeTaskStatusRecord> {
    const workspaceId = context?.workspaceId;
    await this.dependencies.taskAuthority.assertOwned(requestId, workspaceId, "read");
    const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (!("recordType" in record) && (record.requestId !== requestId || record.workspaceId !== workspaceId || record.taskType !== TaskType.IMAGE_GENERATION)) throw new Error("Image generation task was not found in this workspace.");
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
