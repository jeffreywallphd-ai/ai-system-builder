import { randomUUID } from "node:crypto";
import type {
  ConversationTurnInvocationOutcome,
  ConversationTurnInvocationPort,
  ConversationTurnInvocationRequest,
  ConversationalRuntimeAdapterCatalogPort,
  ConversationalRuntimeGuardPort,
} from "../../../application/ports/conversational-execution";
import type { PythonRuntimePort } from "../../../application/ports/runtime";
import type { ModelRegistryPort } from "../../../application/ports/model";
import { SystemBuilderModelAuthorityService } from "../../../application/services/system-builder";
import type { ModelInventoryRecord } from "../../../contracts/model";
import { createSystemBuilderModelBinding } from "../../../contracts/system-builder";
import {
  createWorkspaceId,
  type WorkspaceId,
} from "../../../contracts/workspace";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../python/pythonRuntimeTaskTimeoutPolicy";

export const PYTHON_CONVERSATIONAL_ADAPTER_ID =
  "python-runtime.conversation-text-generation.v1";
const PYTHON_RUNTIME_CAPABILITY_CONVERSATION_TEXT_GENERATION =
  "conversation-text-generation";

function toMessages(
  request: ConversationTurnInvocationRequest,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> =
    [];
  if (request.context.systemInstruction)
    out.push({ role: "system", content: request.context.systemInstruction });
  for (const h of request.context.history ?? [])
    out.push({ role: h.role, content: h.content });
  out.push({ role: "user", content: request.context.userTurnContent });
  return out;
}

export function createPythonConversationalTextGenerationInvocationAdapter(
  runtimePort: PythonRuntimePort,
  modelRegistry: Pick<ModelRegistryPort, "getModelRecord" | "listModels">,
): ConversationTurnInvocationPort {
  const modelAuthority = new SystemBuilderModelAuthorityService(modelRegistry);
  return {
    async invokeConversationTurn(
      request,
    ): Promise<ConversationTurnInvocationOutcome> {
      if (
        request.runtime.runtimeId !== "python-sidecar" ||
        request.runtime.capabilityKind !== "text-generation"
      )
        return { status: "unsupported" };
      let modelBinding;
      try {
        modelBinding = createSystemBuilderModelBinding(
          request.runtime.selectedModelRecordId,
        );
      } catch {
        return { status: "blocked" };
      }
      const requestId = `conversation-text-generation-${randomUUID()}`;
      try {
        const resolution = await modelAuthority.resolve(
          createWorkspaceId(request.source.workspaceId),
          modelBinding,
        );
        if (resolution.status !== "ready") return { status: "blocked" };
        const runtimeModel = await resolveRuntimeModel(
          modelAuthority,
          modelRegistry,
          createWorkspaceId(request.source.workspaceId),
          resolution.record,
        );
        if (!runtimeModel) return { status: "blocked" };
        await runtimePort.startTask({
          requestId,
          taskType: "conversation-text-generation",
          timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.short,
          payload: {
            messages: toMessages(request),
            generation: request.context.generation,
            selectedModelId: runtimeModel.selectedModelId,
            ...(runtimeModel.baseModelId
              ? { baseModelId: runtimeModel.baseModelId }
              : {}),
            ...(runtimeModel.adapterRevision
              ? { adapterRevision: runtimeModel.adapterRevision }
              : {}),
          },
          metadata: {
            operation: "conversation.turn.invoke",
            workspaceId: request.source.workspaceId,
            conversationSessionId: request.source.conversationSessionId,
          },
        });
        const deadline = Date.now() + PYTHON_RUNTIME_TASK_TIMEOUTS.short;
        while (Date.now() < deadline) {
          const status = await runtimePort.readTaskStatus(requestId);
          if (status.status === "succeeded") {
            const text =
              typeof (status.data as any)?.assistantResponseText === "string"
                ? (status.data as any).assistantResponseText.trim()
                : "";
            if (!text) return { status: "failed", code: "validation" };
            if (text.length > 8_000)
              return { status: "failed", code: "validation" };
            return { status: "completed", assistantResponseText: text };
          }
          if (status.status === "failed")
            return { status: "failed", code: "runtime-error" };
          if (status.status === "cancelled") return { status: "cancelled" };
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { status: "timed-out" };
      } catch {
        return { status: "failed", code: "internal" };
      }
    },
  };
}

interface ResolvedRuntimeModel {
  readonly selectedModelId: string;
  readonly baseModelId?: string;
  readonly adapterRevision?: string;
}

async function resolveRuntimeModel(
  authority: SystemBuilderModelAuthorityService,
  registry: Pick<ModelRegistryPort, "getModelRecord" | "listModels">,
  workspaceId: WorkspaceId,
  selected: ModelInventoryRecord,
): Promise<ResolvedRuntimeModel | undefined> {
  if (!selected.modelId) return undefined;
  if (selected.artifactForm !== "adapter") {
    return { selectedModelId: selected.modelId };
  }

  const associatedBaseModelId = (
    selected.adapterOfModelId ?? selected.baseModelId
  )?.trim();
  if (!associatedBaseModelId) return undefined;

  const metadataBaseRecordId =
    typeof selected.metadata?.["baseModelRecordId"] === "string"
      ? selected.metadata["baseModelRecordId"].trim()
      : undefined;
  let baseRecordId: string | undefined;
  if (metadataBaseRecordId) {
    baseRecordId = metadataBaseRecordId;
  } else {
    const listed = await registry.listModels({
      workspaceId,
      limit: 500,
      includeDiscovered: true,
      includeSharedStorage: true,
    });
    const matches = listed.models.filter(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.modelId === associatedBaseModelId &&
        candidate.artifactForm !== "adapter",
    );
    if (matches.length !== 1) return undefined;
    baseRecordId = matches[0]?.modelRecordId;
  }

  if (!baseRecordId) return undefined;
  let binding;
  try {
    binding = createSystemBuilderModelBinding(baseRecordId);
  } catch {
    return undefined;
  }
  const baseResolution = await authority.resolve(workspaceId, binding);
  if (
    baseResolution.status !== "ready" ||
    baseResolution.record.artifactForm === "adapter" ||
    baseResolution.record.modelId !== associatedBaseModelId
  ) {
    return undefined;
  }

  return {
    selectedModelId: selected.modelId,
    baseModelId: baseResolution.record.modelId,
    ...(selected.localPath && selected.generatedFromRunId
      ? { adapterRevision: selected.generatedFromRunId }
      : {}),
  };
}

export function createPythonConversationalRuntimeAdapterCatalog(): ConversationalRuntimeAdapterCatalogPort {
  return {
    async resolveForRuntime(request) {
      if (
        request.runtime.runtimeId !== "python-sidecar" ||
        request.runtime.capabilityKind !== "text-generation"
      )
        return { status: "unsupported" } as const;
      return {
        status: "supported",
        adapterId: PYTHON_CONVERSATIONAL_ADAPTER_ID,
        capabilityKind: "text-generation",
        capabilities: { progress: false, cancellation: false },
      } as const;
    },
  };
}

export function createPythonConversationalRuntimeGuard(
  runtimePort: PythonRuntimePort,
): ConversationalRuntimeGuardPort {
  return {
    async getRuntimeStatus(request) {
      if (request.adapterId !== PYTHON_CONVERSATIONAL_ADAPTER_ID)
        return "unsupported";
      try {
        const health = await runtimePort.getHealthStatus();
        const caps = await runtimePort.getCapabilities();
        if (!health.healthy) return "unhealthy";
        if (
          !caps.capabilities.includes(
            PYTHON_RUNTIME_CAPABILITY_CONVERSATION_TEXT_GENERATION,
          )
        )
          return "unsupported";
        return health.status.status === "ready" ? "ready" : "starting";
      } catch {
        return "unavailable";
      }
    },
  };
}
