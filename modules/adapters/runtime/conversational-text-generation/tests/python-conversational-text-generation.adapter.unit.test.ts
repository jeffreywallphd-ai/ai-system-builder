import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovedConversationalInvocationSource,
  ConversationalInvocationRuntimeReference,
} from "../../../../application/ports/conversational-execution";
import {
  PYTHON_CONVERSATIONAL_ADAPTER_ID,
  createPythonConversationalRuntimeAdapterCatalog,
  createPythonConversationalRuntimeGuard,
  createPythonConversationalTextGenerationInvocationAdapter,
} from "../python-conversational-text-generation.adapter";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../../python/pythonRuntimeTaskTimeoutPolicy";

const source: ApprovedConversationalInvocationSource = {
  workspaceId: "workspace.1",
  conversationSessionId: "conversation.session.1",
  sourceExecutionPlanId: "execution.plan.1",
  sourceCompositionPlanId: "composition.plan.1",
  sourceRuntimeReadinessBindingId: "readiness.binding.1",
  executionApprovalId: "execution.approval.1",
  runtimeReferenceId: "runtime.reference.1",
};
const runtime: ConversationalInvocationRuntimeReference = {
  runtimeId: "python-sidecar",
  capabilityKind: "text-generation",
  runtimeReferenceId: source.runtimeReferenceId,
  selectedModelRecordId: "model.chat.local",
};

test("catalog resolves only python-sidecar text-generation runtime", async () => {
  const catalog = createPythonConversationalRuntimeAdapterCatalog();
  assert.equal(
    (
      await catalog.resolveForRuntime({
        source,
        runtime: { ...runtime, runtimeId: "other-runtime" },
      })
    ).status,
    "unsupported",
  );
  const supported = await catalog.resolveForRuntime({ source, runtime });
  assert.equal(supported.status, "supported");
  if (supported.status === "supported") {
    assert.equal(supported.adapterId, PYTHON_CONVERSATIONAL_ADAPTER_ID);
  }
});

test("runtime guard maps unsupported adapter id", async () => {
  const guard = createPythonConversationalRuntimeGuard({
    getHealthStatus: async () => ({
      healthy: true,
      status: { runtimeId: "python-sidecar", status: "ready" } as never,
    }),
    getCapabilities: async () => ({
      runtimeId: "python-sidecar",
      capabilities: ["conversation-text-generation"],
    }),
  } as never);
  assert.equal(
    await guard.getRuntimeStatus({
      adapterId: "other-adapter-id",
      source,
      runtime,
    }),
    "unsupported",
  );
});

test("invocation adapter maps successful protected runtime response", async () => {
  let statusReads = 0;
  let submitted: unknown;
  const invocation = createPythonConversationalTextGenerationInvocationAdapter(
    {
      startTask: async (request: unknown) => {
        submitted = request;
        return { requestId: "req-1" };
      },
      readTaskStatus: async () =>
        statusReads++ === 0
          ? { requestId: "req-1", status: "running" }
          : {
              requestId: "req-1",
              status: "succeeded",
              data: { assistantResponseText: "hello world" },
            },
    } as never,
    {
      listModels: async () => ({ models: [] }),
      getModelRecord: async (workspaceId, modelRecordId) =>
        workspaceId === "workspace.1" && modelRecordId === "model.chat.local"
          ? ({
              workspaceId,
              modelRecordId,
              displayName: "Local chat",
              source: "local",
              lifecycleStatus: "validated",
              artifactForm: "full-model",
              provider: "huggingface",
              modelId: "local/chat-v1",
              taskTags: ["chat"],
              createdAt: "2026-07-29T00:00:00.000Z",
              updatedAt: "2026-07-29T00:00:00.000Z",
              validationStatus: "valid",
            } as never)
          : undefined,
    },
  );
  const context = {
    contextKind: "protected-conversational-invocation" as const,
    source,
    runtime,
    systemInstruction: "Use approved composed behavior.",
    userTurnContent: "hello",
  };
  const outcome = await invocation.invokeConversationTurn({
    source,
    runtime,
    context,
  });
  assert.equal(outcome.status, "completed");
  assert.equal(
    JSON.stringify(submitted).includes(source.runtimeReferenceId),
    false,
  );
  assert.equal(
    (submitted as { payload?: { selectedModelId?: string } }).payload
      ?.selectedModelId,
    "local/chat-v1",
  );
  assert.equal(
    (submitted as { timeoutMs?: number }).timeoutMs,
    PYTHON_RUNTIME_TASK_TIMEOUTS.short,
  );
});

test("invocation adapter blocks a missing or cross-workspace model record before worker submission", async () => {
  let submissions = 0;
  const invocation = createPythonConversationalTextGenerationInvocationAdapter(
    {
      startTask: async () => {
        submissions += 1;
        return { requestId: "never" };
      },
    } as never,
    {
      listModels: async () => ({ models: [] }),
      getModelRecord: async () => undefined,
    },
  );
  const outcome = await invocation.invokeConversationTurn({
    source,
    runtime,
    context: {
      contextKind: "protected-conversational-invocation",
      source,
      runtime,
      userTurnContent: "hello",
    },
  });
  assert.equal(outcome.status, "blocked");
  assert.equal(submissions, 0);
});

test("invocation adapter resolves and submits an associated base model with a selected LoRA", async () => {
  let submitted: any;
  const baseModel = {
    workspaceId: "workspace.1",
    modelRecordId: "model.base.local",
    displayName: "Base chat",
    source: "huggingface",
    lifecycleStatus: "downloaded",
    artifactForm: "full-model",
    provider: "huggingface",
    modelId: "owner/base-chat",
    taskTags: ["chat"],
    createdAt: "2026-07-29T00:00:00.000Z",
    validationStatus: "valid",
  } as never;
  const adapterModel = {
    workspaceId: "workspace.1",
    modelRecordId: runtime.selectedModelRecordId,
    displayName: "Chat LoRA",
    source: "generated",
    lifecycleStatus: "generated",
    artifactForm: "adapter",
    provider: "huggingface",
    modelId: "generated/chat-lora",
    adapterOfModelId: "owner/base-chat",
    baseModelId: "owner/base-chat",
    generatedFromRunId: "training-run-1",
    localPath: "C:/private/generated/chat-lora",
    taskTags: ["chat"],
    metadata: { baseModelRecordId: "model.base.local" },
    createdAt: "2026-07-29T00:00:00.000Z",
    validationStatus: "valid",
  } as never;
  const invocation = createPythonConversationalTextGenerationInvocationAdapter(
    {
      startTask: async (request: unknown) => {
        submitted = request;
        return { requestId: "req-lora" };
      },
      readTaskStatus: async () => ({
        requestId: "req-lora",
        status: "succeeded",
        data: { assistantResponseText: "adapted response" },
      }),
    } as never,
    {
      listModels: async () => ({ models: [adapterModel, baseModel] }),
      getModelRecord: async (_workspaceId, modelRecordId) =>
        modelRecordId === runtime.selectedModelRecordId
          ? adapterModel
          : modelRecordId === "model.base.local"
            ? baseModel
            : undefined,
    },
  );

  const outcome = await invocation.invokeConversationTurn({
    source,
    runtime,
    context: {
      contextKind: "protected-conversational-invocation",
      source,
      runtime,
      userTurnContent: "hello",
    },
  });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(submitted.payload, {
    messages: [{ role: "user", content: "hello" }],
    generation: undefined,
    selectedModelId: "generated/chat-lora",
    baseModelId: "owner/base-chat",
    adapterRevision: "training-run-1",
  });
  assert.equal(JSON.stringify(submitted).includes("C:/private"), false);
});

test("invocation adapter blocks a LoRA whose associated base record is missing or mismatched", async () => {
  let submissions = 0;
  const adapterModel = {
    workspaceId: "workspace.1",
    modelRecordId: runtime.selectedModelRecordId,
    displayName: "Chat LoRA",
    source: "generated",
    lifecycleStatus: "generated",
    artifactForm: "adapter",
    provider: "huggingface",
    modelId: "generated/chat-lora",
    adapterOfModelId: "owner/expected-base",
    taskTags: ["chat"],
    metadata: { baseModelRecordId: "model.wrong-base" },
    createdAt: "2026-07-29T00:00:00.000Z",
  } as never;
  const invocation = createPythonConversationalTextGenerationInvocationAdapter(
    {
      startTask: async () => {
        submissions += 1;
        return { requestId: "never" };
      },
    } as never,
    {
      listModels: async () => ({ models: [adapterModel] }),
      getModelRecord: async (_workspaceId, modelRecordId) =>
        modelRecordId === runtime.selectedModelRecordId
          ? adapterModel
          : modelRecordId === "model.wrong-base"
            ? ({
                ...(adapterModel as unknown as Record<string, unknown>),
                modelRecordId: "model.wrong-base",
                artifactForm: "full-model",
                modelId: "owner/wrong-base",
              } as never)
            : undefined,
    },
  );

  const outcome = await invocation.invokeConversationTurn({
    source,
    runtime,
    context: {
      contextKind: "protected-conversational-invocation",
      source,
      runtime,
      userTurnContent: "hello",
    },
  });

  assert.equal(outcome.status, "blocked");
  assert.equal(submissions, 0);
});
