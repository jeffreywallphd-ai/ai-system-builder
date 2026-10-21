import type {
  CancelModelDownloadTaskRequest,
  CancelModelDownloadTaskResult,
  ListModelDownloadTasksRequest,
  ListModelDownloadTasksResult,
  ModelDownloadTaskActivity,
  ReadModelDownloadTaskRequest,
  ReadModelDownloadTaskResult,
  StartModelDownloadTaskRequest,
  StartModelDownloadTaskResult,
} from "../../../contracts/model";
import {
  normalizeDownloadModelRequest,
  normalizeListModelDownloadTasksRequest,
  normalizeModelDownloadTaskIdentity,
  normalizeModelInventoryRecord,
} from "../../../contracts/model";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import type { ModelDownloadCompletionPort, ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";

interface DownloadDescriptor {
  readonly request: ReturnType<typeof normalizeDownloadModelRequest>;
  readonly startedAt: string;
  readonly authority: ModelDownloadAuthority;
}

/** Supplied by the authenticated host, never copied from request payloads. */
export interface ModelDownloadAuthority {
  readonly organizationId?: string;
  readonly principalId?: string;
  readonly modelWriteAuthorized?: boolean;
}

export class ModelDownloadTasksUseCase {
  private readonly descriptors = new Map<string, DownloadDescriptor>();
  private readonly finalizedModels = new Map<string, ModelDownloadTaskActivity["model"]>();
  private readonly finalizations = new Map<string, Promise<ModelDownloadTaskActivity["model"]>>();
  private readonly finalizationFailures = new Set<string>();

  public constructor(private readonly dependencies: {
    runtimeTaskRegistry: RuntimeTaskRegistryPort;
    modelDownloadCompletion: ModelDownloadCompletionPort;
    modelRegistry: ModelRegistryPort;
    now?: () => string;
    taskReconciler?: OwnedTaskReconcilerService;
  }) {}

  public async start(request: StartModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<StartModelDownloadTaskResult> {
    const normalized = normalizeDownloadModelRequest(request);
    const lease = this.dependencies.taskReconciler?.reserve();
    try {
    const started = await this.dependencies.runtimeTaskRegistry.startTask({
      workspaceId: normalized.workspaceId,
      taskType: TaskType.MODEL_DOWNLOAD,
      concurrencyClass: "io",
      payload: {
        provider: "transformers",
        modelId: normalized.modelId,
        inferenceMode: normalized.inferenceMode,
        taskTags: normalized.taskTags,
        artifactForm: normalized.artifactForm,
      },
    });
    const startedAt = this.now();
    this.descriptors.set(started.requestId, { request: structuredClone(normalized), startedAt, authority: Object.freeze({ ...authority }) });
    this.pruneDescriptors();
    lease?.start(async () => {
      // Observe only accepted work; model registration still needs explicit
      // current write authority through complete().
      const record = await this.dependencies.runtimeTaskRegistry.getTaskStatus(started.requestId);
      return !("recordType" in record) && record.requestId === started.requestId && record.workspaceId === normalized.workspaceId && record.taskType === TaskType.MODEL_DOWNLOAD && ["succeeded", "failed", "cancelled"].includes(record.status);
    }, () => this.dependencies.runtimeTaskRegistry.cancelTask(started.requestId), async () => {});
    return {
      activity: {
        requestId: started.requestId,
        workspaceId: normalized.workspaceId!,
        modelId: normalized.modelId,
        displayName: normalized.displayName ?? normalized.modelId,
        status: started.status ?? "queued",
        startedAt,
        updatedAt: startedAt,
      },
    };
    } catch (error) { lease?.release(); throw error; }
  }

  public async read(request: ReadModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<ReadModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    const task = await this.dependencies.runtimeTaskRegistry.getTaskStatus(normalized.requestId);
    if ("recordType" in task || task.requestId !== normalized.requestId || task.taskType !== TaskType.MODEL_DOWNLOAD || task.workspaceId !== normalized.workspaceId) {
      throw new Error("Model download task was not found in this workspace.");
    }
    return { activity: await this.toActivity(task, descriptor) };
  }

  public async list(request: ListModelDownloadTasksRequest, authority: ModelDownloadAuthority = {}): Promise<ListModelDownloadTasksResult> {
    const normalized = normalizeListModelDownloadTasksRequest(request);
    // Scope checks precede even registry enumeration. A request from another
    // tenant cannot use a shared workspace label to observe or finalize work.
    const owned = [...this.descriptors.values()].some((d) => d.request.workspaceId === normalized.workspaceId && sameAuthority(d.authority, authority));
    if (!owned) return { activities: [] };
    const result = await this.dependencies.runtimeTaskRegistry.listTasks({
      workspaceId: normalized.workspaceId,
      taskTypes: [TaskType.MODEL_DOWNLOAD],
      includeCompleted: normalized.includeCompleted,
      limit: normalized.limit,
    });
    const activities: ModelDownloadTaskActivity[] = [];
    for (const task of result.tasks) {
      const descriptor = this.descriptors.get(task.requestId);
      if ("recordType" in task || task.taskType !== TaskType.MODEL_DOWNLOAD || !descriptor || descriptor.request.workspaceId !== normalized.workspaceId || !sameAuthority(descriptor.authority, authority) || task.workspaceId !== normalized.workspaceId) continue;
      activities.push(await this.toActivity(task, descriptor));
    }
    return { activities };
  }

  public async cancel(request: CancelModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<CancelModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    const cancellation = await this.dependencies.runtimeTaskRegistry.cancelTask(normalized.requestId);
    if (cancellation.requestId !== normalized.requestId) {
      throw new Error("Model download cancellation could not be confirmed.");
    }
    const read = await this.read(normalized, authority);
    return { activity: read.activity, cancelled: cancellation.cancelled };
  }

  private async toActivity(task: RuntimeTaskRecord, descriptor: DownloadDescriptor): Promise<ModelDownloadTaskActivity> {
    const model = this.finalizedModels.get(task.requestId);
    const status = this.finalizationFailures.has(task.requestId) ? "failed" : task.status;

    return {
      requestId: task.requestId,
      workspaceId: descriptor.request.workspaceId!,
      modelId: descriptor.request.modelId,
      displayName: descriptor.request.displayName ?? descriptor.request.modelId,
      status,
      progress: sanitizeProgress(task.progress),
      error: status === "failed"
        ? this.finalizationFailures.has(task.requestId)
          ? { code: "model_download_registration_failed", message: "Downloaded model could not be registered.", retryable: true }
          : sanitizeError(task.error)
        : undefined,
      model,
      startedAt: task.startedAt ?? descriptor.startedAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    };
  }

  public async complete(request: ReadModelDownloadTaskRequest, authority: ModelDownloadAuthority = {}): Promise<ReadModelDownloadTaskResult> {
    const normalized = normalizeModelDownloadTaskIdentity(request);
    if (authority.modelWriteAuthorized !== true) throw new Error("Model write authority is required to register a download.");
    const descriptor = this.requireDescriptor(normalized.requestId, normalized.workspaceId, authority);
    const task = await this.dependencies.runtimeTaskRegistry.getTaskStatus(normalized.requestId);
    if ("recordType" in task || task.requestId !== normalized.requestId || task.taskType !== TaskType.MODEL_DOWNLOAD || task.workspaceId !== normalized.workspaceId || task.status !== "succeeded") {
      throw new Error("Completed model download was not found in this workspace.");
    }
    try {
      await this.finalize(normalized.requestId, descriptor);
      this.finalizationFailures.delete(normalized.requestId);
    } catch {
      this.finalizationFailures.add(normalized.requestId);
      // Keep retries explicit and write-authorized; a read never retries a write.
      this.finalizations.delete(normalized.requestId);
      throw new Error("Downloaded model could not be registered. Retry completion.");
    }
    return { activity: await this.toActivity(task, descriptor) };
  }

  private finalize(requestId: string, descriptor: DownloadDescriptor): Promise<ModelDownloadTaskActivity["model"]> {
    const existing = this.finalizations.get(requestId);
    if (existing) return existing;
    const finalization = (async () => {
      const completion = await this.dependencies.modelDownloadCompletion.readCompletedModelDownload(requestId);
      if (!completion?.localPath || completion.modelId !== descriptor.request.modelId) {
        throw new Error("Model download completion data is unavailable.");
      }
      const registered = await this.dependencies.modelRegistry.registerDownloadedModel({
        modelRecordId: descriptor.request.modelRecordId,
        workspaceId: descriptor.request.workspaceId,
        displayName: descriptor.request.displayName ?? descriptor.request.modelId,
        source: "huggingface",
        provider: descriptor.request.provider,
        modelId: descriptor.request.modelId,
        localPath: completion.localPath,
        artifactForm: descriptor.request.artifactForm ?? "full-model",
        inferenceMode: descriptor.request.inferenceMode,
        taskTags: descriptor.request.taskTags,
        metadata: {
          ...descriptor.request.metadata,
          download: {
            provider: completion.provider,
            fromCache: completion.fromCache,
            downloaded: completion.downloaded,
          },
        },
      });
      const normalizedModel = normalizeModelInventoryRecord(registered.model);
      const { localPath: _localPath, validationReportPath: _validationReportPath, ...model } = normalizedModel;
      this.finalizedModels.set(requestId, model);
      return model;
    })();
    this.finalizations.set(requestId, finalization);
    return finalization;
  }

  private requireDescriptor(requestId: string, workspaceId: string, authority: ModelDownloadAuthority): DownloadDescriptor {
    const descriptor = this.descriptors.get(requestId);
    if (!descriptor || descriptor.request.workspaceId !== workspaceId || !sameAuthority(descriptor.authority, authority)) {
      throw new Error("Model download task was not found in this workspace.");
    }
    return descriptor;
  }

  private pruneDescriptors(): void {
    while (this.descriptors.size > 100) {
      const oldest = this.descriptors.keys().next().value;
      if (typeof oldest !== "string") return;
      this.descriptors.delete(oldest);
      this.finalizedModels.delete(oldest);
      this.finalizations.delete(oldest);
      this.finalizationFailures.delete(oldest);
    }
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date().toISOString()))();
  }
}

function sanitizeProgress(progress: RuntimeTaskRecord["progress"]): RuntimeTaskRecord["progress"] {
  if (!progress) return undefined;
  return {
    message: sanitizeText(progress.message, 240),
    current: finiteNonNegative(progress.current),
    total: finiteNonNegative(progress.total),
    percent: typeof progress.percent === "number" && Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : undefined,
    unit: sanitizeText(progress.unit, 20),
  };
}

function sanitizeError(error: RuntimeTaskRecord["error"]): ModelDownloadTaskActivity["error"] {
  return {
    code: sanitizeText(error?.code, 80) ?? "model_download_failed",
    message: sanitizeText(error?.message, 240) ?? "Model download failed.",
    retryable: error?.retryable === true,
  };
}

function sanitizeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|api[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|var|etc|opt)\/[^\s,;]*/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, limit) : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}


function sameAuthority(recorded: ModelDownloadAuthority, current: ModelDownloadAuthority): boolean {
  return recorded.organizationId === current.organizationId && recorded.principalId === current.principalId;
}
