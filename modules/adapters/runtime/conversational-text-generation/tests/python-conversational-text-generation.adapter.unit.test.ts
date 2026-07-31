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
    { getModelRecord: async () => undefined },
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
