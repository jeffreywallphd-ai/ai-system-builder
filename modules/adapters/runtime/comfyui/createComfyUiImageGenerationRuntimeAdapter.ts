import { randomUUID } from "node:crypto";

import type { ImageGenerationRequest } from "../../../contracts/image-generation";
import { TaskType, type RuntimeTaskListRequest, type RuntimeTaskListResult, type RuntimeTaskRecord, type RuntimeTaskStatus, type StartRuntimeTaskRequest, type StartRuntimeTaskResult } from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime/runtime-task-registry.port";
import type { ComfyUiHttpClient } from "./createComfyUiHttpClient";
import type { ComfyUiRuntimeSupervisor } from "./createComfyUiRuntimeSupervisor";
import { mapImageGenerationRequestToComfyUiPrompt, type ComfyUiImageGenerationWorkflowMapperOptions } from "./comfyUiImageGenerationWorkflowMapper";

interface Deps { client: Pick<ComfyUiHttpClient, "submitPrompt" | "getQueue" | "getHistory">; supervisor: Pick<ComfyUiRuntimeSupervisor, "start" | "getRecentRuntimeOutput" | "getRuntimeDeviceMode">; mapperOptions: ComfyUiImageGenerationWorkflowMapperOptions; now?: () => string; }

const GENERIC_NO_OUTPUT_MESSAGE = "ComfyUI history entry did not contain image outputs.";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function toShortTraceback(traceback: unknown): string | undefined {
  if (!Array.isArray(traceback)) return undefined;
  const lines = traceback.filter((line): line is string => typeof line === "string").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  return lines.slice(-3).join(" | ").slice(0, 360);
}

function resolveComfyUiFailure(historyRecord: Record<string, unknown>, runtimeOutput: string[]): { message: string; details?: Record<string, unknown> } {
  const status = toRecord(historyRecord.status);
  const statusStr = typeof status?.status_str === "string" ? status.status_str : undefined;
  const messages = Array.isArray(status?.messages) ? status?.messages : [];
  const normalizedMessages = messages.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return undefined;
    return toRecord(entry[1]);
  }).filter((entry): entry is Record<string, unknown> => Boolean(entry));

  const firstError = normalizedMessages.find((entry) => typeof entry.exception_message === "string" || typeof entry.error === "string");
  const exceptionMessage = typeof firstError?.exception_message === "string"
    ? firstError.exception_message
    : (typeof firstError?.error === "string" ? firstError.error : undefined);
  const nodeId = firstError?.node_id;
  const nodeType = typeof firstError?.node_type === "string" ? firstError.node_type : undefined;
  const tracebackSummary = toShortTraceback(firstError?.traceback);
  const statusMessage = normalizedMessages.map((entry) => typeof entry.message === "string" ? entry.message : undefined).find(Boolean);
  const runtimeSnippet = runtimeOutput.find((line) => /exception during processing|notimplementederror|error/i.test(line));

  const evidence = [statusStr, exceptionMessage, tracebackSummary, statusMessage, runtimeSnippet].filter((value): value is string => Boolean(value));
  const evidenceJoined = evidence.join(" ").toLowerCase();
  const isDirectMlFailure = evidenceJoined.includes("cannot access storage of opaquetensorimpl")
    || evidenceJoined.includes("privateuseone")
    || evidenceJoined.includes("torch-directml")
    || evidenceJoined.includes("directml");

  if (isDirectMlFailure && evidenceJoined.includes("cannot access storage of opaquetensorimpl")) {
    return {
      message: "ComfyUI failed during DirectML execution: Cannot access storage of OpaqueTensorImpl. This is a PyTorch/DirectML runtime failure, not a checkpoint-resolution failure. Try CPU mode or a smaller SD 1.5 checkpoint.",
      details: {
        exceptionMessage: exceptionMessage ?? "Cannot access storage of OpaqueTensorImpl",
        failedNodeId: nodeId,
        failedNodeType: nodeType,
        tracebackSummary,
      },
    };
  }

  const primary = exceptionMessage ?? statusMessage ?? statusStr ?? runtimeSnippet;
  if (!primary) {
    return { message: GENERIC_NO_OUTPUT_MESSAGE };
  }

  return {
    message: `ComfyUI failed: ${primary}`,
    details: { exceptionMessage, failedNodeId: nodeId, failedNodeType: nodeType, tracebackSummary },
  };
}

export function createComfyUiImageGenerationRuntimeAdapter(deps: Deps): RuntimeTaskRegistryPort {
  const byRequest = new Map<string, { promptId: string; request: ImageGenerationRequest; submittedAt: string }>();
  const finalResults = new Map<string, RuntimeTaskRecord>();
  const now = deps.now ?? (() => new Date().toISOString());

  const unknown = (requestId: string): RuntimeTaskRecord => ({ requestId, taskType: TaskType.IMAGE_GENERATION, status: "unknown", concurrencyClass: "gpu-exclusive", updatedAt: now() });

  return {
    async startTask(request: StartRuntimeTaskRequest) {
      if (request.taskType !== TaskType.IMAGE_GENERATION) {
        throw new Error(`ComfyUI runtime adapter only supports ${TaskType.IMAGE_GENERATION} tasks.`);
      }
      const imageRequest = request.payload as ImageGenerationRequest;
      await deps.supervisor.start();
      const payload = mapImageGenerationRequestToComfyUiPrompt(imageRequest, deps.mapperOptions);
      const submitted = await deps.client.submitPrompt(payload);
      const requestId = request.requestId ?? randomUUID();
      const submittedAt = now();
      byRequest.set(requestId, { promptId: submitted.prompt_id, request: imageRequest, submittedAt });
      return { requestId, status: submitted.number === undefined ? "running" : "queued", metadata: { engine: "comfyui", comfyUiPromptId: submitted.prompt_id, submittedAt } } as StartRuntimeTaskResult;
    },

    async getTaskStatus(requestId) {
      const existing = finalResults.get(requestId);
      if (existing) return existing;
      const tracked = byRequest.get(requestId);
      if (!tracked) return unknown(requestId);

      const [queue, history] = await Promise.all([deps.client.getQueue(), deps.client.getHistory()]);
      const historyRecord = history[tracked.promptId] as Record<string, unknown> | undefined;
      if (historyRecord) {
        const outputsRecord = (historyRecord.outputs ?? {}) as Record<string, { images?: Array<Record<string, unknown>> }>;
        const outputs = Object.values(outputsRecord).flatMap((n) => (n.images ?? []).map((image) => ({ fileName: String(image.filename ?? ""), subfolder: image.subfolder ? String(image.subfolder) : undefined, promptId: tracked.promptId, engine: "comfyui", type: "image" })));
        const status: RuntimeTaskStatus = outputs.length > 0 ? "succeeded" : "failed";
        const failure = status === "failed" ? resolveComfyUiFailure(historyRecord, deps.supervisor.getRecentRuntimeOutput?.() ?? []) : undefined;
        const record: RuntimeTaskRecord = {
          requestId, taskType: TaskType.IMAGE_GENERATION, status, concurrencyClass: "gpu-exclusive",
          data: status === "succeeded" ? { outputs } : undefined,
          error: status === "failed" ? { code: "comfyui_failed", message: failure?.message ?? GENERIC_NO_OUTPUT_MESSAGE, details: failure?.details } : undefined,
          completedAt: now(), updatedAt: now(),
          metadata: {
            engine: "comfyui",
            comfyUiPromptId: tracked.promptId,
            runtimeDeviceMode: deps.supervisor.getRuntimeDeviceMode?.(),
            request: {
              prompt: tracked.request.prompt,
              negativePrompt: tracked.request.negativePrompt,
              seed: tracked.request.seed,
              model: tracked.request.model,
              width: tracked.request.width,
              height: tracked.request.height,
            },
            ...(failure?.details ?? {}),
          },
        };
        finalResults.set(requestId, record);
        return record;
      }

      const pending = queue.queue_pending.some((entry) => Array.isArray(entry) && String(entry[1] ?? "") === tracked.promptId);
      const running = queue.queue_running.some((entry) => Array.isArray(entry) && String(entry[1] ?? "") === tracked.promptId);
      if (pending || running) {
        return { requestId, taskType: TaskType.IMAGE_GENERATION, status: pending ? "queued" : "running", concurrencyClass: "gpu-exclusive", progress: { message: pending ? "Queued in ComfyUI." : "Running in ComfyUI.", details: { promptId: tracked.promptId, queue } }, startedAt: tracked.submittedAt, updatedAt: now(), metadata: { engine: "comfyui", comfyUiPromptId: tracked.promptId } };
      }
      return { requestId, taskType: TaskType.IMAGE_GENERATION, status: "unknown", concurrencyClass: "gpu-exclusive", error: { code: "comfyui_task_missing", message: "ComfyUI prompt was not found in queue or history." }, startedAt: tracked.submittedAt, updatedAt: now(), metadata: { engine: "comfyui", comfyUiPromptId: tracked.promptId } };
    },

    async cancelTask(requestId) {
      return { requestId, cancelled: false, status: byRequest.has(requestId) ? "running" : "unknown", message: "ComfyUI image generation cancellation is not implemented yet." };
    },
    async listTasks(_request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult> {
      return { tasks: [] };
    },
  };
}
