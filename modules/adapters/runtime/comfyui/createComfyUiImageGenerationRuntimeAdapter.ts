import { randomUUID } from "node:crypto";

import type { ImageGenerationRequest } from "../../../contracts/image-generation";
import { isWorkspaceId } from "../../../contracts/workspace";
import {
  TaskType,
  type RuntimeTaskListRequest,
  type RuntimeTaskListResult,
  type RuntimeTaskRecord,
  type RuntimeTaskStatus,
  type StartRuntimeTaskRequest,
  type StartRuntimeTaskResult,
} from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime/runtime-task-registry.port";
import type { ComfyUiHttpClient } from "./createComfyUiHttpClient";
import {
  mapImageGenerationRequestToComfyUiPrompt,
  type ComfyUiImageGenerationWorkflowMapperOptions,
} from "./comfyUiImageGenerationWorkflowMapper";

interface Deps {
  client: Pick<
    ComfyUiHttpClient,
    "submitPrompt" | "getQueue" | "getHistory"
  > & {
    cancelPrompt?: ComfyUiHttpClient["cancelPrompt"];
  };
  supervisor: {
    start: () => Promise<void>;
    getRecentRuntimeOutput?: () => string[];
    getRuntimeDeviceMode?: () => string;
  };
  prepareLatentReferenceImage?: (request: {
    artifactId: string;
    imageRequest: ImageGenerationRequest;
    workspaceId: string;
  }) => Promise<{ imageName: string; cleanup?: () => Promise<void> }>;
  prepareFaceReferenceImage?: (request: {
    artifactId: string;
    imageRequest: ImageGenerationRequest;
    workspaceId: string;
  }) => Promise<{ imageName: string; cleanup?: () => Promise<void> }>;
  mapperOptions: ComfyUiImageGenerationWorkflowMapperOptions;
  now?: () => string;
  maximumActiveTasks?: number;
  maximumRetainedTasks?: number;
}

const GENERIC_NO_OUTPUT_MESSAGE =
  "ComfyUI history entry did not contain image outputs.";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveComfyUiFailure(
  historyRecord: Record<string, unknown>,
  runtimeOutput: string[],
): { message: string; details?: Record<string, unknown> } {
  const status = toRecord(historyRecord.status);
  const statusStr =
    typeof status?.status_str === "string" ? status.status_str : undefined;
  const messages = Array.isArray(status?.messages) ? status?.messages : [];
  const normalizedMessages = messages
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return undefined;
      return toRecord(entry[1]);
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const firstError = normalizedMessages.find(
    (entry) =>
      typeof entry.exception_message === "string" ||
      typeof entry.error === "string",
  );
  const exceptionMessage =
    typeof firstError?.exception_message === "string"
      ? firstError.exception_message
      : typeof firstError?.error === "string"
        ? firstError.error
        : undefined;
  const nodeType =
    typeof firstError?.node_type === "string"
      ? firstError.node_type
      : undefined;
  const statusMessage = normalizedMessages
    .map((entry) =>
      typeof entry.message === "string" ? entry.message : undefined,
    )
    .find(Boolean);
  const runtimeSnippet = runtimeOutput.find((line) =>
    /exception during processing|notimplementederror|error/i.test(line),
  );

  const evidence = [
    statusStr,
    exceptionMessage,
    statusMessage,
    runtimeSnippet,
  ].filter((value): value is string => Boolean(value));
  const evidenceJoined = evidence.join(" ").toLowerCase();
  const isDirectMlFailure =
    evidenceJoined.includes("cannot access storage of opaquetensorimpl") ||
    evidenceJoined.includes("privateuseone") ||
    evidenceJoined.includes("torch-directml") ||
    evidenceJoined.includes("directml");

  if (
    isDirectMlFailure &&
    evidenceJoined.includes("cannot access storage of opaquetensorimpl")
  ) {
    return {
      message:
        "ComfyUI failed during DirectML execution: Cannot access storage of OpaqueTensorImpl. This is a PyTorch/DirectML runtime failure, not a checkpoint-resolution failure. Try CPU mode or a smaller SD 1.5 checkpoint.",
      details: { failedNodeType: nodeType },
    };
  }

  if (!exceptionMessage && !statusMessage && !statusStr && !runtimeSnippet) {
    return { message: GENERIC_NO_OUTPUT_MESSAGE };
  }

  return {
    message:
      "ComfyUI image generation failed. Review the host runtime diagnostics and retry.",
    details: { failedNodeType: nodeType },
  };
}

export function createComfyUiImageGenerationRuntimeAdapter(
  deps: Deps,
): RuntimeTaskRegistryPort {
  type PreparedReference = { imageName: string; cleanup?: () => Promise<void> };
  type TrackedRequest = {
    promptId: string;
    submittedAt: string;
    workspaceId: string;
    preparedReferences: readonly PreparedReference[];
  };
  const byRequest = new Map<string, TrackedRequest>();
  const finalResults = new Map<string, RuntimeTaskRecord>();
  const now = deps.now ?? (() => new Date().toISOString());
  const maximumActiveTasks = Math.min(
    Math.max(deps.maximumActiveTasks ?? 8, 1),
    32,
  );
  const maximumRetainedTasks = Math.min(
    Math.max(deps.maximumRetainedTasks ?? 256, 1),
    1_024,
  );
  const rememberFinal = (requestId: string, record: RuntimeTaskRecord) => {
    finalResults.delete(requestId);
    finalResults.set(requestId, record);
    while (finalResults.size > maximumRetainedTasks) {
      const oldestRequestId = finalResults.keys().next().value;
      if (typeof oldestRequestId !== "string") break;
      finalResults.delete(oldestRequestId);
    }
  };

  const unknown = (requestId: string): RuntimeTaskRecord => ({
    requestId,
    taskType: TaskType.IMAGE_GENERATION,
    status: "unknown",
    concurrencyClass: "gpu-exclusive",
    error: {
      code: "comfyui_task_not_found",
      message:
        "ComfyUI image generation task was not found in the current-process registry.",
      details: { reason: "request-id-not-tracked" },
      retryable: false,
    },
    metadata: { engine: "comfyui", reason: "request-id-not-tracked" },
    updatedAt: now(),
  });

  const matchesListRequest = (
    record: RuntimeTaskRecord,
    request: RuntimeTaskListRequest,
  ): boolean => {
    if (!isWorkspaceId(request.workspaceId)) return false;
    if (record.workspaceId !== request.workspaceId) return false;
    if (
      request.taskTypes &&
      request.taskTypes.length > 0 &&
      !request.taskTypes.includes(record.taskType)
    )
      return false;
    if (
      request.statuses &&
      request.statuses.length > 0 &&
      !request.statuses.includes(record.status)
    )
      return false;
    if (
      !request.includeCompleted &&
      (record.status === "succeeded" ||
        record.status === "failed" ||
        record.status === "cancelled")
    )
      return false;
    return true;
  };

  const taskRecordFromTracked = (
    requestId: string,
    tracked: TrackedRequest,
  ): RuntimeTaskRecord => ({
    requestId,
    workspaceId: tracked.workspaceId as never,
    taskType: TaskType.IMAGE_GENERATION,
    status: "queued",
    concurrencyClass: "gpu-exclusive",
    progress: {
      message: "Accepted by the ComfyUI runtime task registry.",
    },
    startedAt: tracked.submittedAt,
    updatedAt: tracked.submittedAt,
    metadata: {
      workspaceId: tracked.workspaceId,
      engine: "comfyui",
    },
  });

  const failedRuntimeReadRecord = (
    requestId: string,
    tracked: TrackedRequest,
    error: unknown,
  ): RuntimeTaskRecord => {
    const runtimeOutput = deps.supervisor.getRecentRuntimeOutput?.() ?? [];
    const nativeCrash = runtimeOutput.some((line) =>
      /windows fatal exception|0xc0000374|heap/i.test(line),
    );
    const message = nativeCrash
      ? "ComfyUI crashed while generating the image. The server runtime likely needs a supported Python/Torch environment; check the ComfyUI runtime logs and retry after repair."
      : "ComfyUI stopped responding while image generation was running. Check the server runtime logs and retry.";
    return {
      requestId,
      workspaceId: tracked.workspaceId as never,
      taskType: TaskType.IMAGE_GENERATION,
      status: "failed",
      concurrencyClass: "gpu-exclusive",
      error: {
        code: nativeCrash
          ? "comfyui_runtime_crashed"
          : "comfyui_status_read_failed",
        message,
        details: {
          runtimeDeviceMode: deps.supervisor.getRuntimeDeviceMode?.(),
          diagnosticClass: nativeCrash
            ? "native-runtime-crash"
            : "runtime-status-unavailable",
        },
        retryable: true,
      },
      startedAt: tracked.submittedAt,
      completedAt: now(),
      updatedAt: now(),
      metadata: {
        workspaceId: tracked.workspaceId,
        engine: "comfyui",
        runtimeDeviceMode: deps.supervisor.getRuntimeDeviceMode?.(),
      },
    };
  };

  const cleanupPreparedReferences = async (
    tracked: Pick<TrackedRequest, "preparedReferences">,
  ) => {
    await Promise.allSettled(
      tracked.preparedReferences.map((reference) => reference.cleanup?.()),
    );
  };

  return {
    async startTask(request: StartRuntimeTaskRequest) {
      if (request.taskType !== TaskType.IMAGE_GENERATION) {
        throw new Error(
          `ComfyUI runtime adapter only supports ${TaskType.IMAGE_GENERATION} tasks.`,
        );
      }
      if (!isWorkspaceId(request.workspaceId)) {
        throw new Error(
          "Workspace id is required for image generation runtime tasks.",
        );
      }
      if (byRequest.size >= maximumActiveTasks) {
        throw new Error(
          "ComfyUI image generation queue is at its active-task capacity.",
        );
      }
      const imageRequest = request.payload as ImageGenerationRequest;
      await deps.supervisor.start();
      const preparedReferences: PreparedReference[] = [];
      let submitted: Awaited<ReturnType<ComfyUiHttpClient["submitPrompt"]>>;
      try {
        const latentReference =
          imageRequest.latentSource?.kind === "artifact"
            ? await deps.prepareLatentReferenceImage?.({
                artifactId: imageRequest.latentSource.artifactId,
                imageRequest,
                workspaceId: request.workspaceId,
              })
            : undefined;
        if (
          imageRequest.latentSource?.kind === "artifact" &&
          !latentReference?.imageName
        ) {
          throw new Error(
            "Image generation latent artifact reference could not be prepared for ComfyUI.",
          );
        }
        if (latentReference) preparedReferences.push(latentReference);

        const faceReferenceImageNames: string[] = [];
        if (imageRequest.faceId?.enabled) {
          for (const reference of (imageRequest.faceId.references ?? []).slice(
            0,
            3,
          )) {
            const artifactId = reference.artifactId.trim();
            if (!artifactId) continue;
            const prepared = await (
              deps.prepareFaceReferenceImage ?? deps.prepareLatentReferenceImage
            )?.({
              artifactId,
              imageRequest,
              workspaceId: request.workspaceId,
            });
            if (prepared) {
              preparedReferences.push(prepared);
              faceReferenceImageNames.push(prepared.imageName);
            }
          }
        }
        if (
          imageRequest.faceId?.enabled &&
          (imageRequest.faceId.references ?? []).length > 0 &&
          faceReferenceImageNames.length === 0
        ) {
          throw new Error(
            "Image generation face reference artifact could not be prepared for ComfyUI.",
          );
        }
        const payload = mapImageGenerationRequestToComfyUiPrompt(imageRequest, {
          ...deps.mapperOptions,
          latentReferenceImageName: latentReference?.imageName,
          faceReferenceImageNames,
        });
        submitted = await deps.client.submitPrompt(payload);
      } catch (error) {
        await Promise.allSettled(
          preparedReferences.map((reference) => reference.cleanup?.()),
        );
        throw error;
      }
      const requestId = request.requestId ?? randomUUID();
      const submittedAt = now();
      byRequest.set(requestId, {
        promptId: submitted.prompt_id,
        submittedAt,
        workspaceId: request.workspaceId,
        preparedReferences,
      });
      return {
        requestId,
        status: submitted.number === undefined ? "running" : "queued",
        metadata: {
          workspaceId: request.workspaceId,
          engine: "comfyui",
          submittedAt,
          runtimeDeviceMode: deps.supervisor.getRuntimeDeviceMode?.(),
        },
      } as StartRuntimeTaskResult;
    },

    async getTaskStatus(requestId) {
      const existing = finalResults.get(requestId);
      if (existing) return existing;
      const tracked = byRequest.get(requestId);
      if (!tracked) return unknown(requestId);

      let queue: Awaited<ReturnType<ComfyUiHttpClient["getQueue"]>>;
      let history: Awaited<ReturnType<ComfyUiHttpClient["getHistory"]>>;
      try {
        [queue, history] = await Promise.all([
          deps.client.getQueue(),
          deps.client.getHistory(),
        ]);
      } catch (error) {
        const record = failedRuntimeReadRecord(requestId, tracked, error);
        await cleanupPreparedReferences(tracked);
        byRequest.delete(requestId);
        rememberFinal(requestId, record);
        return record;
      }
      const historyRecord = history[tracked.promptId] as
        Record<string, unknown> | undefined;
      if (historyRecord) {
        const outputsRecord = (historyRecord.outputs ?? {}) as Record<
          string,
          { images?: Array<Record<string, unknown>> }
        >;
        const outputs = Object.values(outputsRecord).flatMap((n) =>
          (n.images ?? []).map((image) => ({
            fileName: String(image.filename ?? ""),
            subfolder: image.subfolder ? String(image.subfolder) : undefined,
            promptId: tracked.promptId,
            engine: "comfyui",
            type: "image",
          })),
        );
        const status: RuntimeTaskStatus =
          outputs.length > 0 ? "succeeded" : "failed";
        const failure =
          status === "failed"
            ? resolveComfyUiFailure(
                historyRecord,
                deps.supervisor.getRecentRuntimeOutput?.() ?? [],
              )
            : undefined;
        const record: RuntimeTaskRecord = {
          requestId,
          workspaceId: tracked.workspaceId as never,
          taskType: TaskType.IMAGE_GENERATION,
          status,
          concurrencyClass: "gpu-exclusive",
          data:
            status === "succeeded"
              ? {
                  outputs: outputs.map((output) => ({
                    ...output,
                    workspaceId: tracked.workspaceId,
                  })),
                }
              : undefined,
          error:
            status === "failed"
              ? {
                  code: "comfyui_failed",
                  message: failure?.message ?? GENERIC_NO_OUTPUT_MESSAGE,
                  details: failure?.details,
                }
              : undefined,
          completedAt: now(),
          updatedAt: now(),
          metadata: {
            workspaceId: tracked.workspaceId,
            engine: "comfyui",
            runtimeDeviceMode: deps.supervisor.getRuntimeDeviceMode?.(),
            ...(failure?.details ?? {}),
          },
        };
        await cleanupPreparedReferences(tracked);
        byRequest.delete(requestId);
        rememberFinal(requestId, record);
        return record;
      }

      const pending = queue.queue_pending.some(
        (entry) =>
          Array.isArray(entry) && String(entry[1] ?? "") === tracked.promptId,
      );
      const running = queue.queue_running.some(
        (entry) =>
          Array.isArray(entry) && String(entry[1] ?? "") === tracked.promptId,
      );
      if (pending || running) {
        return {
          requestId,
          workspaceId: tracked.workspaceId as never,
          taskType: TaskType.IMAGE_GENERATION,
          status: pending ? "queued" : "running",
          concurrencyClass: "gpu-exclusive",
          progress: {
            message: pending ? "Queued in ComfyUI." : "Running in ComfyUI.",
          },
          startedAt: tracked.submittedAt,
          updatedAt: now(),
          metadata: {
            workspaceId: tracked.workspaceId,
            engine: "comfyui",
          },
        };
      }
      return {
        requestId,
        workspaceId: tracked.workspaceId as never,
        taskType: TaskType.IMAGE_GENERATION,
        status: "unknown",
        concurrencyClass: "gpu-exclusive",
        error: {
          code: "comfyui_task_missing",
          message: "ComfyUI prompt was not found in queue or history.",
        },
        startedAt: tracked.submittedAt,
        updatedAt: now(),
        metadata: {
          workspaceId: tracked.workspaceId,
          engine: "comfyui",
        },
      };
    },

    async cancelTask(requestId) {
      const tracked = byRequest.get(requestId);
      if (!tracked && !finalResults.has(requestId)) {
        return {
          requestId,
          cancelled: false,
          status: "unknown",
          message: "Runtime task was not found in this task registry delegate.",
        };
      }
      if (!tracked || !deps.client.cancelPrompt) {
        return {
          requestId,
          cancelled: false,
          status: finalResults.get(requestId)?.status ?? "running",
          message: "Runtime task is no longer cancellable.",
        };
      }
      await deps.client.cancelPrompt(tracked.promptId);
      await cleanupPreparedReferences(tracked);
      byRequest.delete(requestId);
      const record: RuntimeTaskRecord = {
        requestId,
        workspaceId: tracked.workspaceId as never,
        taskType: TaskType.IMAGE_GENERATION,
        status: "cancelled",
        concurrencyClass: "gpu-exclusive",
        completedAt: now(),
        updatedAt: now(),
        metadata: { workspaceId: tracked.workspaceId, engine: "comfyui" },
      };
      rememberFinal(requestId, record);
      return {
        requestId,
        cancelled: true,
        status: "cancelled",
        message: "Cancelled ComfyUI image generation task.",
      };
    },
    async listTasks(
      request: RuntimeTaskListRequest,
    ): Promise<RuntimeTaskListResult> {
      const records = new Map<string, RuntimeTaskRecord>();
      for (const [requestId, tracked] of byRequest.entries()) {
        records.set(
          requestId,
          finalResults.get(requestId) ??
            taskRecordFromTracked(requestId, tracked),
        );
      }
      for (const [requestId, record] of finalResults.entries()) {
        records.set(requestId, record);
      }
      const tasks = [...records.values()].filter((record) =>
        matchesListRequest(record, request),
      );
      return {
        tasks:
          typeof request.limit === "number"
            ? tasks.slice(0, Math.max(0, request.limit))
            : tasks,
      };
    },
  };
}
