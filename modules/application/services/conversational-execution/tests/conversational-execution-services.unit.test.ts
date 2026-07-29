import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSessionRecord } from "../../../../contracts/conversations";
import type { ExecutionApprovalRecord } from "../../../../contracts/execution-runs";
import type {
  ApprovedConversationalInvocationSource,
  ConversationTurnInvocationOutcome,
  ProtectedConversationalInvocationContext,
} from "../../../ports/conversational-execution";
import {
  ConversationTurnInvocationOrchestratorService,
  ConversationalInvocationContextValidationService,
  ConversationalRuntimeAdapterSelectionService,
  ConversationalRuntimeGuardService,
} from "../index";

const source: ApprovedConversationalInvocationSource = {
  workspaceId: "workspace.1",
  conversationSessionId: "conversation.session.1",
  sourceExecutionPlanId: "execution.plan.1",
  sourceCompositionPlanId: "composition.plan.1",
  sourceRuntimeReadinessBindingId: "readiness.binding.1",
  executionApprovalId: "execution.approval.1",
  runtimeReferenceId: "runtime.reference.1",
};

const runtime = {
  runtimeId: "python-sidecar",
  capabilityKind: "text-generation" as const,
  runtimeReferenceId: source.runtimeReferenceId,
  selectedModelRecordId: "model.chat.local",
};

const session = {
  id: source.conversationSessionId,
  workspaceId: source.workspaceId,
  sourceExecutionPlanId: source.sourceExecutionPlanId,
  sourceCompositionPlanId: source.sourceCompositionPlanId,
  sourceRuntimeReadinessBindingId: source.sourceRuntimeReadinessBindingId,
  status: "approved",
  systemLabel: "Starter conversational assistant",
  executionApprovalId: source.executionApprovalId,
  executionApprovalStatus: "granted",
  runtimeReferenceId: source.runtimeReferenceId,
  turnIds: [],
  blockers: [],
  diagnostics: [],
  provenance: [],
  createdAt: "2026-05-22T00:00:00.000Z",
  updatedAt: "2026-05-22T00:00:00.000Z",
} as unknown as ConversationSessionRecord;

const approval = {
  id: source.executionApprovalId,
  workspaceId: source.workspaceId,
  sourceExecutionPlanId: source.sourceExecutionPlanId,
  conversationSessionId: source.conversationSessionId,
  approvalKind: "conversation-session-execution",
  approvalStatus: "granted",
  label: "Approved conversation session",
  runtimeReferenceId: source.runtimeReferenceId,
  createdAt: "2026-05-22T00:00:00.000Z",
  updatedAt: "2026-05-22T00:00:00.000Z",
  grantedAt: "2026-05-22T00:00:00.000Z",
  provenance: [],
  blockers: [],
  diagnostics: [],
} as unknown as ExecutionApprovalRecord;

const protectedContext = (
  overrides: Partial<ProtectedConversationalInvocationContext> = {},
): ProtectedConversationalInvocationContext => ({
  contextKind: "protected-conversational-invocation",
  source,
  runtime,
  systemInstruction: "Answer from the approved composed assistant behavior.",
  userTurnContent: "Explain the approved system briefly.",
  history: [{ role: "assistant", content: "Previous bounded answer." }],
  generation: { temperature: 0.4, maxOutputTokens: 512 },
  ...overrides,
});

test("adapter selection accepts only an explicit compatible catalog result", async () => {
  let observedSource: ApprovedConversationalInvocationSource | undefined;
  const service = new ConversationalRuntimeAdapterSelectionService({
    async resolveForRuntime(request) {
      observedSource = request.source;
      return {
        status: "supported",
        adapterId: "adapter.explicit.1",
        capabilityKind: "text-generation",
        capabilities: { progress: false, cancellation: false },
      };
    },
  });

  const result = await service.select({ source, runtime });

  assert.equal(result.status, "supported");
  assert.equal(observedSource, source);
});

test("adapter selection does not fall back to labels or arbitrary candidates", async () => {
  let calls = 0;
  const service = new ConversationalRuntimeAdapterSelectionService({
    async resolveForRuntime() {
      calls += 1;
      return { status: "deferred" };
    },
  });

  assert.equal((await service.select({ source, runtime })).status, "deferred");
  assert.equal(
    (
      await service.select({
        source,
        runtime: { ...runtime, runtimeReferenceId: "different.reference" },
      })
    ).status,
    "invalid",
  );
  assert.equal(calls, 1);
});

test("adapter selection sanitizes catalog failures and malformed support", async () => {
  const unavailable = new ConversationalRuntimeAdapterSelectionService({
    async resolveForRuntime() {
      throw new Error("provider detail must not escape");
    },
  });
  const malformed = new ConversationalRuntimeAdapterSelectionService({
    async resolveForRuntime() {
      return {
        status: "supported",
        adapterId: "",
        capabilityKind: "text-generation",
        capabilities: { progress: false, cancellation: false },
      };
    },
  });

  assert.deepEqual(await unavailable.select({ source, runtime }), {
    status: "unavailable",
  });
  assert.deepEqual(await malformed.select({ source, runtime }), {
    status: "invalid",
  });
});

test("protected context validation accepts bounded composed behavior and technical text", () => {
  const service = new ConversationalInvocationContextValidationService();
  const result = service.validate(
    protectedContext({
      userTurnContent:
        "Explain how an API key placeholder, C:\\models path, curl command, and JSON payload work without supplying real secrets.",
    }),
    { source, runtime },
  );

  assert.deepEqual(result, { valid: true });
});

test("protected context validation rejects unexpected payload fields and source mismatches", () => {
  const service = new ConversationalInvocationContextValidationService();
  const unexpected = {
    ...protectedContext(),
    providerPayload: { raw: true },
  };
  const mismatched = protectedContext({
    source: { ...source, sourceCompositionPlanId: "composition.plan.other" },
  });

  assert.equal(service.validate(unexpected, { source, runtime }).valid, false);
  assert.deepEqual(service.validate(mismatched, { source, runtime }), {
    valid: false,
    reason: "protected-context-association-mismatch",
  });
});

test("protected context validation rejects raw secret, stack, environment, signed URL, base64, and workflow dumps", () => {
  const service = new ConversationalInvocationContextValidationService();
  const unsafeValues = [
    "api_key=live-secret-value-123456789",
    "Error: boom\n  at invoke (runtime.ts:1:2)\n  at main (index.ts:2:3)",
    "MODEL_HOST=runtime.internal\nMODEL_TOKEN=not-a-placeholder-secret\nMODEL_PORT=1234\n",
    "https://example.test/object?X-Amz-Signature=1234567890abcdef1234",
    `data:application/octet-stream;base64,${"A".repeat(600)}`,
    JSON.stringify({ nodes: [], edges: [] }),
  ];

  for (const value of unsafeValues) {
    assert.deepEqual(
      service.validate(protectedContext({ userTurnContent: value }), {
        source,
        runtime,
      }),
      { valid: false, reason: "unsafe-protected-context" },
    );
  }
});

test("protected context validation enforces visible-content, history, and generation bounds", () => {
  const service = new ConversationalInvocationContextValidationService();
  assert.equal(
    service.validate(
      protectedContext({ userTurnContent: "x".repeat(32_001) }),
      { source, runtime },
    ).valid,
    false,
  );
  assert.deepEqual(
    service.validate(
      protectedContext({
        history: new Array(51).fill({ role: "user", content: "bounded" }),
      }),
      { source, runtime },
    ),
    { valid: false, reason: "history-too-large" },
  );
  assert.deepEqual(
    service.validate(
      protectedContext({ generation: { maxOutputTokens: 8_193 } }),
      { source, runtime },
    ),
    { valid: false, reason: "generation-settings-invalid" },
  );
});

test("runtime guard permits ready and blocks every other safe state", async () => {
  const ready = new ConversationalRuntimeGuardService({
    async getRuntimeStatus() {
      return "ready";
    },
  });
  assert.deepEqual(
    await ready.canInvoke({ adapterId: "adapter.1", source, runtime }),
    { allowed: true, status: "ready" },
  );

  for (const state of [
    "starting",
    "unavailable",
    "configuration-required",
    "permission-required",
    "unsupported",
    "unhealthy",
    "stale",
    "blocked",
    "deferred",
  ] as const) {
    const guard = new ConversationalRuntimeGuardService({
      async getRuntimeStatus() {
        return state;
      },
    });
    assert.deepEqual(
      await guard.canInvoke({ adapterId: "adapter.1", source, runtime }),
      { allowed: false, status: state },
    );
  }
});

test("runtime guard sanitizes exceptions and rejects mismatched source references", async () => {
  const service = new ConversationalRuntimeGuardService({
    async getRuntimeStatus() {
      throw new Error("raw runtime health details");
    },
  });
  assert.deepEqual(
    await service.canInvoke({ adapterId: "adapter.1", source, runtime }),
    { allowed: false, status: "unavailable" },
  );
  assert.deepEqual(
    await service.canInvoke({
      adapterId: "adapter.1",
      source,
      runtime: { ...runtime, runtimeReferenceId: "different.reference" },
    }),
    { allowed: false, status: "blocked" },
  );
});

type HarnessOptions = Readonly<{
  approvalResult?:
    Readonly<{ valid: true }> | Readonly<{ valid: false; reason: string }>;
  adapterStatus?: "supported" | "deferred" | "unsupported";
  guardStatus?:
    | "ready"
    | "starting"
    | "unavailable"
    | "configuration-required"
    | "permission-required"
    | "unsupported"
    | "unhealthy"
    | "stale"
    | "blocked"
    | "deferred";
  context?: ProtectedConversationalInvocationContext;
  outcome?: ConversationTurnInvocationOutcome;
  throwInvocation?: boolean;
}>;

const createHarness = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  let invocationRequest: unknown;
  const adapterStatus = options.adapterStatus ?? "supported";
  const orchestrator = new ConversationTurnInvocationOrchestratorService({
    approvalValidityService: {
      async isValidForInvocation() {
        calls.push("approval");
        return options.approvalResult ?? { valid: true as const };
      },
    },
    adapterSelectionService: new ConversationalRuntimeAdapterSelectionService({
      async resolveForRuntime() {
        calls.push("adapter");
        if (adapterStatus !== "supported") return { status: adapterStatus };
        return {
          status: "supported",
          adapterId: "adapter.1",
          capabilityKind: "text-generation",
          capabilities: { progress: false, cancellation: false },
        };
      },
    }),
    runtimeGuardService: new ConversationalRuntimeGuardService({
      async getRuntimeStatus() {
        calls.push("guard");
        return options.guardStatus ?? "ready";
      },
    }),
    contextPort: {
      async prepareProtectedInvocationContext() {
        calls.push("context");
        return {
          status: "prepared",
          context: options.context ?? protectedContext(),
        };
      },
    },
    contextValidationService:
      new ConversationalInvocationContextValidationService(),
    invocationPort: {
      async invokeConversationTurn(request) {
        calls.push("invoke");
        invocationRequest = request;
        if (options.throwInvocation) {
          throw new Error("provider stack and payload");
        }
        return (
          options.outcome ?? {
            status: "completed",
            assistantResponseText: "Bounded fake assistant response.",
          }
        );
      },
    },
  });
  return { orchestrator, calls, getInvocationRequest: () => invocationRequest };
};

const validInput = {
  workspaceId: source.workspaceId,
  session,
  approval,
  runtime,
  userTurnContent: "Explain the approved system briefly.",
  conversationTurnId: "conversation.turn.1",
  executionRunId: "execution.run.1",
  executionAttemptId: "execution.attempt.1",
  operationId: "operation.1",
};

test("orchestrator requires structured asset-derived source associations before approval", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.orchestrator.invoke({ ...validInput, workspaceId: "" }),
    { status: "invalid-request" },
  );
  assert.deepEqual(
    await harness.orchestrator.invoke({
      ...validInput,
      runtime: { ...runtime, selectedModelRecordId: "" },
    }),
    { status: "invalid-request" },
  );
  assert.deepEqual(
    await harness.orchestrator.invoke({
      ...validInput,
      session: { ...session, sourceCompositionPlanId: undefined },
    }),
    { status: "invalid-request" },
  );
  assert.deepEqual(harness.calls, []);
});

test("orchestrator reuses Prompt 4 approval validity and stops on invalidation", async () => {
  const harness = createHarness({
    approvalResult: { valid: false, reason: "source-plan-stale" },
  });
  const result = await harness.orchestrator.invoke(validInput);
  assert.deepEqual(result, { status: "source-plan-stale" });
  assert.deepEqual(harness.calls, ["approval"]);
});

test("orchestrator returns deferred without resolving protected context or invoking", async () => {
  const harness = createHarness({ adapterStatus: "deferred" });
  const result = await harness.orchestrator.invoke(validInput);
  assert.deepEqual(result, { status: "deferred" });
  assert.deepEqual(harness.calls, ["approval", "adapter"]);
});

test("orchestrator blocks before protected context when runtime is not ready", async () => {
  const harness = createHarness({ guardStatus: "configuration-required" });
  const result = await harness.orchestrator.invoke(validInput);
  assert.deepEqual(result, { status: "configuration-required" });
  assert.deepEqual(harness.calls, ["approval", "adapter", "guard"]);
});

test("orchestrator validates protected context before invoking", async () => {
  const harness = createHarness({
    context: protectedContext({
      source: { ...source, sourceExecutionPlanId: "execution.plan.other" },
    }),
  });
  const result = await harness.orchestrator.invoke(validInput);
  assert.deepEqual(result, {
    status: "invalid-invocation-context",
    reason: "protected-context-association-mismatch",
  });
  assert.deepEqual(harness.calls, ["approval", "adapter", "guard", "context"]);
});

test("orchestrator invokes exactly once in sequence with protected source context", async () => {
  const harness = createHarness();
  const result = await harness.orchestrator.invoke(validInput);
  assert.deepEqual(result, {
    status: "completed",
    assistantResponseText: "Bounded fake assistant response.",
  });
  assert.deepEqual(harness.calls, [
    "approval",
    "adapter",
    "guard",
    "context",
    "invoke",
  ]);
  assert.deepEqual(harness.getInvocationRequest(), {
    source,
    runtime,
    context: protectedContext(),
    conversationTurnId: validInput.conversationTurnId,
    executionRunId: validInput.executionRunId,
    executionAttemptId: validInput.executionAttemptId,
    operationId: validInput.operationId,
  });
});

test("orchestrator maps safe invocation outcomes without raw provider details", async () => {
  for (const outcome of [
    { status: "cancelled" },
    { status: "timed-out" },
    { status: "unavailable" },
    { status: "not-ready" },
    { status: "unsupported" },
    { status: "blocked" },
    { status: "failed", code: "runtime-error" },
  ] as const) {
    const harness = createHarness({ outcome });
    const result = await harness.orchestrator.invoke(validInput);
    assert.equal(result.status, outcome.status);
    assert.equal(JSON.stringify(result).includes("provider"), false);
  }
});

test("orchestrator sanitizes thrown invocation failures", async () => {
  const harness = createHarness({ throwInvocation: true });
  assert.deepEqual(await harness.orchestrator.invoke(validInput), {
    status: "internal-unavailable",
  });
});
