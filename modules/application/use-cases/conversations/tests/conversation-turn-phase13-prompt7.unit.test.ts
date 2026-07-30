import test from "node:test";
import assert from "node:assert/strict";
import { SubmitConversationTurnUseCase } from "../submit-conversation-turn.use-case";

function inMemory() {
  const sessions = new Map<string, any>();
  const turns = new Map<string, any>();
  const msgs = new Map<string, any>();
  const responses = new Map<string, any>();
  const runs = new Map<string, any>();
  const atts = new Map<string, any>();
  const events: any[] = [];
  const results = new Map<string, any>();
  const operations = new Map<string, any>();
  return {
    stores: {
      sessions,
      turns,
      msgs,
      responses,
      runs,
      atts,
      events,
      results,
      operations,
    },
    ports: {
      sessionRepository: {
        getConversationSessionById: async (_w: string, id: string) =>
          sessions.get(id),
        updateConversationSession: async (r: any) => (sessions.set(r.id, r), r),
      },
      turnRepository: {
        saveConversationTurn: async (r: any) => (turns.set(r.id, r), r),
        updateConversationTurn: async (r: any) => (turns.set(r.id, r), r),
        getConversationTurnById: async (_w: string, id: string) =>
          turns.get(id),
      },
      messageRepository: {
        saveConversationMessage: async (r: any) => (msgs.set(r.id, r), r),
      },
      assistantResponseRepository: {
        saveAssistantResponse: async (r: any) => (responses.set(r.id, r), r),
      },
      executionRunRepository: {
        saveExecutionRun: async (r: any) => (runs.set(r.id, r), r),
        updateExecutionRun: async (r: any) => (runs.set(r.id, r), r),
        getExecutionRunById: async (_w: string, id: string) => runs.get(id),
      },
      executionAttemptRepository: {
        saveExecutionAttempt: async (r: any) => (atts.set(r.id, r), r),
        updateExecutionAttempt: async (r: any) => (atts.set(r.id, r), r),
        getExecutionAttemptById: async (_w: string, id: string) => atts.get(id),
      },
      executionEventRepository: {
        appendExecutionEvent: async (r: any) => (events.push(r), r),
      },
      executionResultRepository: {
        saveExecutionResult: async (r: any) => (results.set(r.id, r), r),
      },
      operationRepository: {
        getConversationOperationById: async (w: string, s: string, o: string) =>
          operations.get(`${w}:${s}:${o}`),
        saveConversationOperation: async (r: any) => (
          operations.set(
            `${r.workspaceId}:${r.conversationSessionId}:${r.operationId}`,
            r,
          ),
          r
        ),
      },
      runtimeReferenceRepository: {
        getExecutionRuntimeReferenceById: async () => ({
          id: "runtime.reference.1",
          runtimeKind: "python-sidecar",
          capabilityKind: "text-generation",
          status: "supported",
          selectedModelRecordId: "model.chat.local",
        }),
      },
      approvalRepository: {
        getExecutionApprovalById: async () => ({
          id: "a1",
          approvalStatus: "granted",
        }),
      },
    },
  };
}

function approvedSession() {
  return {
    id: "s1",
    workspaceId: "w1",
    sourceExecutionPlanId: "ep1",
    sourceCompositionPlanId: "cp1",
    sourceRuntimeReadinessBindingId: "rrb1",
    executionApprovalId: "a1",
    runtimeReferenceId: "runtime.reference.1",
    status: "approved",
    turnIds: [],
    blockers: [],
    diagnostics: [],
    provenance: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("submit turn persists lifecycle and response, with idempotent operation key", async () => {
  const m = inMemory();
  m.stores.sessions.set("s1", approvedSession());
  let n = 0;
  const uc = new SubmitConversationTurnUseCase({
    ...(m.ports as any),
    approvalValidityService: {
      isValidForInvocation: async () => ({ valid: true }),
    } as any,
    adapterSelectionService: {
      select: async () => ({ status: "supported", adapterId: "adapter.1" }),
    } as any,
    runtimeGuardService: {
      canInvoke: async () => ({ allowed: true, status: "ready" }),
    } as any,
    orchestrator: {
      invoke: async () => ({
        status: "completed",
        assistantResponseText: "hello",
      }),
    } as any,
    nextId: () => `id-${++n}`,
    now: () => "2026-01-02T00:00:00.000Z",
  });
  const first = await uc.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-1",
  });
  const second = await uc.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-1",
  });
  assert.equal(first.kind, "success");
  assert.equal(second.kind, "success");
  assert.equal(m.stores.msgs.size, 1);
  assert.equal(m.stores.turns.size, 1);
  assert.equal(m.stores.runs.size, 1);
  assert.equal(m.stores.responses.size, 1);
  assert.equal(m.stores.results.size, 1);
});

test("submit turn exits before acceptance when runtime preflight is unsupported", async () => {
  const m = inMemory();
  m.stores.sessions.set("s1", approvedSession());
  const uc = new SubmitConversationTurnUseCase({
    ...(m.ports as any),
    approvalValidityService: {
      isValidForInvocation: async () => ({ valid: true }),
    } as any,
    adapterSelectionService: {
      select: async () => ({ status: "unsupported" }),
    } as any,
    runtimeGuardService: {
      canInvoke: async () => ({ allowed: true, status: "ready" }),
    } as any,
    orchestrator: {
      invoke: async () => ({
        status: "completed",
        assistantResponseText: "hello",
      }),
    } as any,
    nextId: () => `id-x`,
    now: () => "2026-01-02T00:00:00.000Z",
  });
  const result = await uc.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-2",
  });
  assert.equal(result.kind, "failure");
  assert.equal(m.stores.msgs.size, 0);
  assert.equal(m.stores.turns.size, 0);
  assert.equal(m.stores.runs.size, 0);
  assert.equal(m.stores.responses.size, 0);
  assert.equal(m.stores.results.size, 0);
});

test("submit turn exits before persistence when the release-bound model association is absent", async () => {
  const m = inMemory();
  m.stores.sessions.set("s1", approvedSession());
  m.ports.runtimeReferenceRepository.getExecutionRuntimeReferenceById =
    async () => ({
      id: "runtime.reference.1",
      runtimeKind: "python-sidecar",
      capabilityKind: "text-generation",
      status: "supported",
    });
  const uc = new SubmitConversationTurnUseCase({
    ...(m.ports as any),
    approvalValidityService: {
      isValidForInvocation: async () => ({ valid: true }),
    } as any,
    adapterSelectionService: {
      select: async () => ({ status: "supported", adapterId: "adapter.1" }),
    } as any,
    runtimeGuardService: {
      canInvoke: async () => ({ allowed: true, status: "ready" }),
    } as any,
    orchestrator: {
      invoke: async () => ({
        status: "completed",
        assistantResponseText: "should not run",
      }),
    } as any,
    nextId: () => "id-missing-model",
    now: () => "2026-01-02T00:00:00.000Z",
  });
  const result = await uc.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-missing-model",
  });
  assert.equal(result.kind, "failure");
  assert.equal(m.stores.msgs.size, 0);
  assert.equal(m.stores.turns.size, 0);
  assert.equal(m.stores.runs.size, 0);
  assert.equal(m.stores.responses.size, 0);
});

test("submit turn exits before acceptance when approval is stale/invalidated", async () => {
  const m = inMemory();
  m.stores.sessions.set("s1", approvedSession());
  const uc = new SubmitConversationTurnUseCase({
    ...(m.ports as any),
    approvalValidityService: {
      isValidForInvocation: async () => ({
        valid: false,
        reason: "source-plan-stale",
      }),
    } as any,
    adapterSelectionService: {
      select: async () => ({ status: "supported", adapterId: "adapter.1" }),
    } as any,
    runtimeGuardService: {
      canInvoke: async () => ({ allowed: true, status: "ready" }),
    } as any,
    orchestrator: {
      invoke: async () => ({
        status: "completed",
        assistantResponseText: "hello",
      }),
    } as any,
    nextId: () => `id-y`,
    now: () => "2026-01-02T00:00:00.000Z",
  });
  const result = await uc.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-3",
  });
  assert.equal(result.kind, "failure");
  assert.equal(m.stores.msgs.size, 0);
  assert.equal(m.stores.turns.size, 0);
  assert.equal(m.stores.runs.size, 0);
  assert.equal(m.stores.responses.size, 0);
  assert.equal(m.stores.results.size, 0);
});

test("submit turn failure result is durable across use-case instances", async () => {
  const m = inMemory();
  m.stores.sessions.set("s1", approvedSession());
  let adapterSelections = 0;
  const deps = {
    ...(m.ports as any),
    approvalValidityService: {
      isValidForInvocation: async () => ({ valid: true }),
    } as any,
    adapterSelectionService: {
      select: async () => (adapterSelections++, { status: "unsupported" }),
    } as any,
    runtimeGuardService: {
      canInvoke: async () => ({ allowed: true, status: "ready" }),
    } as any,
    orchestrator: {
      invoke: async () => ({
        status: "completed",
        assistantResponseText: "hello",
      }),
    } as any,
    nextId: () => `id-z`,
    now: () => "2026-01-02T00:00:00.000Z",
  };
  const uc1 = new SubmitConversationTurnUseCase(deps);
  const uc2 = new SubmitConversationTurnUseCase(deps);
  const first = await uc1.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-durable",
  });
  const second = await uc2.execute({
    workspaceId: "w1",
    conversationSessionId: "s1",
    text: "Hi",
    operationId: "op-durable",
  });
  assert.equal(first.kind, "failure");
  assert.equal(second.kind, "failure");
  assert.equal(adapterSelections, 1);
});
