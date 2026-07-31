import { isWorkspaceId } from "../../../contracts/workspace";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import { type PublishModelRequest, type PublishModelResult } from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { RuntimeCapabilityGuardService } from "../../services/runtime";

export class PublishModelUseCase {
  private readonly requestContext = new Map<string, { request: PublishModelRequest; modelRecordId: string; repository: string; provider: "huggingface" }>();
  private readonly finalizedResults = new Map<string, PublishModelResult>();

  public constructor(
    private readonly dependencies: {
      modelRegistry: ModelRegistryPort;
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      runtimeCapabilityGuard?: Pick<RuntimeCapabilityGuardService, "requireCapabilityReady">;
    },
  ) {}

  public async execute(request: PublishModelRequest): Promise<PublishModelResult> {
    if (!isWorkspaceId(request.workspaceId)) throw new Error("Workspace id is required for model publishing.");
    const model = await this.dependencies.modelRegistry.getModelRecord(request.workspaceId, request.modelRecordId);
    if (!model || !model.localPath) {
      throw new Error(`Model '${request.modelRecordId}' is missing a local model path and cannot be published.`);
    }
    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady("model-publishing");
    const started = await this.dependencies.runtimeTaskRegistry.startTask({ taskType: TaskType.MODEL_PUBLISHING, workspaceId: request.workspaceId, payload: request });
    this.requestContext.set(started.requestId, { request, modelRecordId: request.modelRecordId, repository: request.repository, provider: "huggingface" });
    return { modelRecordId: request.modelRecordId, published: false, provider: "huggingface", repository: request.repository, requestId: started.requestId } as PublishModelResult;
  }

  public async read(requestId: string): Promise<PublishModelResult> {
    const cached = this.finalizedResults.get(requestId);
    if (cached) {
      return cached;
    }
    const context = this.requestContext.get(requestId);
    const status = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (status.status === "running" || status.status === "queued") {
      return {
        modelRecordId: context?.modelRecordId ?? status.requestId,
        published: false,
        provider: context?.provider ?? "huggingface",
        repository: context?.repository ?? "unknown",
        requestId,
      } as PublishModelResult;
    }
    if (status.status === "failed" || status.status === "cancelled" || status.status === "unknown") {
      const message = status.error?.message ?? "Model publishing failed.";
      throw new Error(context ? `${message} (modelRecordId=${context.modelRecordId}, repository=${context.repository})` : message);
    }
    return this.resolveSucceeded(status, requestId);
  }

  private async resolveSucceeded(statusRecord: RuntimeTaskRecord, requestId: string): Promise<PublishModelResult> {
    if (!statusRecord.data || typeof statusRecord.data !== "object") {
      throw new Error(`Model publishing runtime result missing for request '${statusRecord.requestId}'.`);
    }
    const result = statusRecord.data as PublishModelResult;
    const context = this.requestContext.get(requestId);
    const workspaceId = context?.request.workspaceId ?? statusRecord.workspaceId;
    if (!isWorkspaceId(workspaceId)) throw new Error("Workspace id is required for model publishing result finalization.");
    const model = await this.dependencies.modelRegistry.getModelRecord(workspaceId, result.modelRecordId);
    if (!model) {
      throw new Error(`Model record '${result.modelRecordId}' was not found.`);
    }
    const metadata = { ...(model.metadata ?? {}), publishedProvider: result.provider, publishedRepository: result.repository, publishedRevision: result.revision, publishedUrl: result.url, publishedAt: new Date().toISOString() };
    await this.dependencies.modelRegistry.updateModelRecord({ workspaceId, modelRecordId: result.modelRecordId, patch: { published: { provider: result.provider, repository: result.repository, revision: result.revision, url: result.url, publishedAt: metadata.publishedAt as string }, metadata } });
    const finalized = { ...result, requestId } as PublishModelResult;
    this.finalizedResults.set(requestId, finalized);
    return finalized;
  }
}
