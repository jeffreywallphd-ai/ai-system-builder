import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { normalizeConversationSessionRecord, normalizeConversationSessionId, normalizeConversationTurnId } from "../../../../contracts/conversations";
import { HEADLESS_READ_OPERATIONS, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeDesktopHeadlessConversation } from "../composeDesktopHeadlessConversation";
import { composeDesktopWorkspaceAuthorization } from "../composeDesktopWorkspaceAuthorization";

import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalAssetCompositionPlanRepositoryAdapter } from "../../../../adapters/persistence/asset-composition";
import { createLocalConversationRepositoryAdapters } from "../../../../adapters/persistence/conversations";
import { createLocalDelegatedConversationTurnAdmission } from "../../../../adapters/persistence/conversations/createLocalDelegatedConversationTurnAdmission";
import { createLocalExecutionPlanRepositoryAdapter } from "../../../../adapters/persistence/execution-plans";
import { createLocalExecutionRunRepositoryAdapters } from "../../../../adapters/persistence/execution-runs";
import { createLocalModelRegistryAdapter } from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import { createLocalRuntimeReadinessBindingRepositoryAdapter } from "../../../../adapters/persistence/runtime-readiness";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../adapters/persistence/sqlite";
import { createPythonConversationalRuntimeAdapterCatalog, createPythonConversationalRuntimeGuard,
  createPythonConversationalTextGenerationInvocationAdapter } from "../../../../adapters/runtime/conversational-text-generation";
import type { PythonRuntimePort } from "../../../../application/ports/runtime";
import { HeadlessConversationStatusUseCase } from "../../../../application/use-cases/system-run-workflow/headless-conversation-status.use-case";
import { normalizeAssetCompositionNodeId, normalizeAssetCompositionPlanId } from "../../../../contracts/asset-composition";
import { normalizeEffectiveAssetProjectionId } from "../../../../contracts/effective-asset-projections";
import { normalizeExecutionAdapterReferenceId, normalizeExecutionPlanId } from "../../../../contracts/execution-plans";
import { normalizeExecutionApprovalId, normalizeExecutionRuntimeReferenceId } from "../../../../contracts/execution-runs";
import { normalizeRuntimeReadinessBindingId } from "../../../../contracts/runtime-readiness";
import { composeConversationExecutionServices } from "../../../shared/composition/composeConversationExecutionServices";
import { composeSystemRunWorkflow } from "../../../shared/composition/composeSystemRunWorkflow";
import { createConversationWorkflowHandler } from "../../../../application/services/system-run-workflow/conversation-workflow-handler.service";
import { HeadlessWorkflowMetadataUseCase } from "../../../../application/use-cases/system-run-workflow/headless-workflow-metadata.use-case";

test("desktop binds saved handles to the current client and holds one existing runtime invocation per session", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const now = "2026-11-13T00:00:00.000Z";
  let id = 0;
  const identity = await initializeLocalIdentityProfile({
    documents, organizationDisplayName: "Synthetic org", principalDisplayName: "Synthetic operator",
    now: () => now, createId: () => `synthetic.${++id}`,
  });
  const workspaceId = createWorkspaceId("synthetic-workspace");
  const workspaces = createLocalWorkspaceRepository({ rootDirectory: ".", documents: documents.forOrganization(identity.organizationId) });
  await workspaces.saveWorkspace({ workspaceId, organizationId: identity.organizationId, status: "active",
    displayName: "Synthetic workspace", createdAt: now, updatedAt: now });
  const hostIncarnationId = "f06f4016-f0ee-43fa-808f-09f815df8d6b";
  assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const input = { workspaceId, planId: "fixture-plan", planRevision: "plan-r1", sessionId: "fixture-session",
    snapshotRevision: "snapshot-r1", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic input" };
  let open = true;
  let allowed = true;
  let calls = 0;
  let revision = input.snapshotRevision;
  let session = normalizeConversationSessionRecord({ id: input.sessionId, workspaceId, sourceExecutionPlanId: input.planId,
    executionApprovalId: "fixture-approval", runtimeReferenceId: "fixture-runtime", status: "approved", systemLabel: "Synthetic",
    turnIds: [], blockers: [], diagnostics: [], provenance: [], createdAt: now, updatedAt: now });
  let release!: () => void;
  const running = new Promise<void>(resolve => { release = resolve; });
  let resolveRuntime!: () => void;
  const started = new Promise<void>(resolve => { resolveRuntime = resolve; });
  const reference = { turnId: "fixture-turn", runId: "fixture-run" };
  const host = composeDesktopHeadlessConversation({
    hostIncarnationId, identity, platformDocuments: documents, rootDirectory: ".", workspaces,
    authorization: composeDesktopWorkspaceAuthorization({ documents, localIdentity: identity }),
    isOpen: () => open, readRole: async () => "owner",
    sessions: { async getConversationSessionById() { return session; } },
    workflows: { async prepare(workspace, target, access) {
      assert.equal(workspace, workspaceId);
      assert.deepEqual(target, { profileId: "builtin.workflow.conversation@1.0.0", source: { kind: "reviewed-execution-plan", sourceId: input.planId, sourceRevision: input.planRevision } });
      if (!await access.canRead(workspace, "reviewed-execution-plan")) return { ok: false, code: "headless.forbidden" };
      return { ok: true, value: { profile: { profileId: "builtin.workflow.conversation@1.0.0", source: { kind: "reviewed-execution-plan" as const, sourceId: input.planId, sourceRevision: input.planRevision }, title: "Controlled conversation", availability: "available", blockers: [] },
        snapshotRevision: revision, approvedSessionIds: [input.sessionId], actions: [] } };
    } },
    submit: { async execute(command, delegation) {
      calls++;
      assert.ok(delegation);
      assert.equal(command.conversationSessionId, input.sessionId);
      const prepared = { workspaceId, planId: input.planId, planRevision: input.planRevision,
        snapshotRevision: input.snapshotRevision, sessionId: input.sessionId, approvalId: "fixture-approval",
        runtimeReferenceId: "fixture-runtime" };
      assert.equal(await delegation.validate({ ...prepared, phase: "before-record" }), true);
      session = normalizeConversationSessionRecord({ ...session, status: "active", turnIds: [reference.turnId] });
      revision = "snapshot-after-admission";
      assert.equal(await delegation.onAdmitted?.(reference), true);
      assert.equal(await delegation.validate({ ...prepared, phase: "before-runtime", turnId: reference.turnId }), true);
      resolveRuntime();
      await running;
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId, status: "succeeded" } };
    } },
  });
  const grant = {
    organizationId: identity.organizationId, principalId: identity.principalId, registeredClientId: "06f56324-2051-462c-b45b-d9b49bf6dd4a",
    conversation: true as const, workspaceIds: [workspaceId] as const, operations: HEADLESS_READ_OPERATIONS, isCurrent: () => allowed,
  };
  const authority = { grant, currentGrant: async () => allowed ? grant : undefined,
    fingerprint: (value: string) => createHmac("sha256", "fixture-key").update(value).digest("hex") };
  try {
    const forbidden = { ok: false, code: "headless.forbidden" };
    assert.deepEqual(await host.execute(input, { ...authority, grant: { ...grant, conversation: undefined } }), forbidden);
    assert.deepEqual(await host.execute({ ...input, workspaceId: createWorkspaceId("foreign-workspace") }, authority), forbidden);
    assert.deepEqual(await host.execute({ ...input, snapshotRevision: "stale" }, authority), forbidden);
    assert.equal(calls, 0);
    const expected = { ok: true, value: reference };
    assert.deepEqual(await host.execute(input, authority), expected);
    await started;
    assert.deepEqual(await host.execute(input, authority), expected);
    assert.deepEqual(await host.execute({ ...input, text: "Different synthetic input" }, authority),
      { ok: false, code: "headless.idempotency-conflict" });
    assert.equal(calls, 1);
    allowed = false;
    assert.deepEqual(await host.execute(input, authority), forbidden);
    open = false;
    host.stopAdmission();
    assert.deepEqual(await host.execute(input, authority), forbidden);
  } finally { release(); await host.drain(); }
});

// Composed software workflow: only the Python task boundary is controlled.
// No real model, worker or output-quality claim.
for (const engine of ["Core", "SQLite"] as const) {
  test(`${engine} composed approved text turn saves the original response and replays one runtime task`, { timeout: 15_000 }, async t => {
    const parent = await realpath(tmpdir());
    const root = await realpath(await mkdtemp(path.join(parent, "headless-text-")));
    const identityBefore = await lstat(root, { bigint: true });
    let database: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
    let host: ReturnType<typeof composeDesktopHeadlessConversation> | undefined;
    let hostOpen = true, clientCurrent = true, released = false;
    let runtimeObserved!: () => void;
    const originalRuntimeObserved = new Promise<void>(resolve => { runtimeObserved = resolve; });
    t.after(async () => {
      released = true;
      await host?.drain();
      hostOpen = false; host?.stopAdmission();
      await database?.close();
      const current = await lstat(root, { bigint: true });
      assert.ok(current.isDirectory() && !current.isSymbolicLink());
      assert.equal(current.dev, identityBefore.dev); assert.equal(current.ino, identityBefore.ino);
      assert.equal(await realpath(root), root); assert.equal(path.dirname(root), parent);
      await rm(root, { recursive: true });
    });
    database = engine === "SQLite" ? await openLocalSqliteDatabase({
      policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root }),
    }) : undefined;
    const platform = database?.documents ?? createInMemoryStructuredDocumentStore();
    let starts = 0, statusReads = 0;
    let runtimeRequest: Parameters<PythonRuntimePort["startTask"]>[0] | undefined;
    const at = "2026-11-27T10:00:00.000Z";
    let sequence = 0;
    const identity = await initializeLocalIdentityProfile({ documents: platform,
      organizationDisplayName: "Synthetic text org", principalDisplayName: "Synthetic text operator",
      now: () => at, createId: () => `text.synthetic.${++sequence}` });
    const documents = platform.forOrganization(identity.organizationId);
    const options = { rootDir: root, documents, now: () => at };
    const conversations = createLocalConversationRepositoryAdapters(options);
    const execution = createLocalExecutionRunRepositoryAdapters(options);
    const workspaces = createLocalWorkspaceRepository({ rootDirectory: root, documents });
    const workspaceId = createWorkspaceId("synthetic-text-workspace");
    await workspaces.saveWorkspace({ workspaceId, organizationId: identity.organizationId, status: "active",
      displayName: "Synthetic text workspace", createdAt: at, updatedAt: at });
    const stamps = { createdAt: at, updatedAt: at };
    const lifecycle = { ...stamps, blockers: [], diagnostics: [], provenance: [] };
    const compositionPlanId = normalizeAssetCompositionPlanId("text-composition");
    const readinessBindingId = normalizeRuntimeReadinessBindingId("text-readiness");
    const planId = normalizeExecutionPlanId("text-plan");
    const adapterId = normalizeExecutionAdapterReferenceId("text-adapter");
    const sessionId = normalizeConversationSessionId("text-session");
    const approvalId = normalizeExecutionApprovalId("text-approval");
    const runtimeId = normalizeExecutionRuntimeReferenceId("text-runtime");
    const selection = { targetWorkspaceId: workspaceId, projectionId: normalizeEffectiveAssetProjectionId("text-projection") };
    const compositions = createLocalAssetCompositionPlanRepositoryAdapter(options);
    await compositions.saveAssetCompositionPlanRecord({ ...stamps, planId: compositionPlanId, targetWorkspaceId: workspaceId,
      name: "Synthetic text composition", status: "draft", selectedProjections: [selection],
      nodes: [{ ...stamps, nodeId: normalizeAssetCompositionNodeId("text-node"), targetWorkspaceId: workspaceId,
        selectedProjection: selection, role: "ui-surface", status: "planned", requiredCapabilities: [],
        providedCapabilities: [{ kind: "text-output", key: "text-output" }], diagnostics: [], blockers: [] }],
      relationships: [], compatibilityDiagnostics: [], blockers: [], provenance: [],
      planningSummary: { totalNodes: 1, compatibleNodeCount: 1, blockedNodeCount: 0, conflictedNodeCount: 0,
        missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0,
        compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "ready" } });
    const readiness = createLocalRuntimeReadinessBindingRepositoryAdapter(options);
    await readiness.saveRuntimeReadinessBindingRecord({ ...lifecycle, readinessBindingId, targetWorkspaceId: workspaceId,
      compositionPlanId, status: "ready-for-setup", requirements: [], providerCandidates: [], bindingCandidates: [], bindings: [] });
    const plans = createLocalExecutionPlanRepositoryAdapter(options);
    await plans.saveExecutionPlan({ ...lifecycle, id: planId, workspaceId, sourceCompositionPlanId: compositionPlanId,
      sourceRuntimeReadinessBindingId: readinessBindingId, sourceReadinessStatus: "ready-for-setup", status: "ready-for-review",
      steps: [], dependencies: [], inputs: [], outputs: [], safetyGates: [], resourceEstimates: [],
      adapterReferences: [{ id: adapterId, kind: "provider-capability", status: "available-by-readiness",
        capabilityKind: "text-generation", sourceRuntimeReadinessBindingId: readinessBindingId,
        label: "Synthetic text adapter", blockers: [], diagnostics: [] }] });
    const registry = createLocalModelRegistryAdapter({ rootDirectory: root, filePath: path.join(root, "models.json"), documents,
      now: () => at, discovery: { enabled: false } });
    const model = await registry.saveModelReference({ workspaceId, modelRecordId: "model.synthetic-text",
      provider: "huggingface", modelId: "qualification/controlled-text", displayName: "Controlled text model",
      inferenceMode: "chat", taskTags: ["text-generation"], artifactForm: "full-model" });
    await registry.registerDownloadedModel({ workspaceId, modelRecordId: model.model.modelRecordId, provider: "huggingface",
      modelId: "qualification/controlled-text", displayName: "Controlled text model", source: "local", artifactForm: "full-model",
      inferenceMode: "chat", taskTags: ["text-generation"], localPath: path.join(root, "unused-controlled-model") });
    await execution.executionRuntimeReferenceRepository.saveExecutionRuntimeReference({ id: runtimeId, workspaceId,
      sourceExecutionPlanAdapterReferenceId: adapterId, sourceRuntimeReadinessBindingId: readinessBindingId,
      runtimeKind: "python-sidecar", capabilityKind: "text-generation", selectedModelRecordId: model.model.modelRecordId,
      label: "Synthetic runtime", status: "supported", blockers: [], diagnostics: [] });
    await execution.executionApprovalRepository.saveExecutionApproval({ ...lifecycle, id: approvalId, workspaceId,
      sourceExecutionPlanId: planId, conversationSessionId: sessionId, approvalKind: "conversation-session-execution",
      approvalStatus: "granted", label: "Synthetic text approval", runtimeReferenceId: runtimeId,
      sourcePlanRevision: at, sourceReadinessRevision: at, grantedAt: at });
    await conversations.conversationSessionRepository.saveConversationSession({ ...lifecycle, id: sessionId, workspaceId,
      sourceExecutionPlanId: planId, sourceCompositionPlanId: compositionPlanId, sourceRuntimeReadinessBindingId: readinessBindingId,
      status: "approved", systemLabel: "Synthetic text conversation", executionApprovalId: approvalId,
      executionApprovalStatus: "granted", runtimeReferenceId: runtimeId, turnIds: [] });
    const notUsed = async (): Promise<never> => { throw new Error("Unexpected runtime effect in composed software fixture."); };
    const runtime: PythonRuntimePort = {
      async startTask(request) { starts++; assert.equal(starts, 1); runtimeRequest = structuredClone(request);
        return { requestId: request.requestId, taskType: request.taskType, status: "running", accepted: true }; },
      async readTaskStatus(requestId) { statusReads++; assert.equal(requestId, runtimeRequest?.requestId);
        runtimeObserved();
        return { requestId, status: released ? "succeeded" : "running",
          ...(released ? { data: { assistantResponseText: "Synthetic saved assistant result." } } : {}) }; },
      async getHealthStatus() { return { healthy: true, status: { runtimeId: "python-sidecar", status: "ready" } }; },
      async getCapabilities() { return { runtimeId: "python-sidecar", capabilities: ["conversation-text-generation"] }; },
      cancelTask: notUsed, ensureModelDownloaded: notUsed, resolveModelDownloadTaskResult: notUsed,
      getModelStatus: notUsed, unloadModels: notUsed,
    };
    const services = composeConversationExecutionServices({ ...conversations, ...execution, executionPlanRepository: plans,
      runtimeReadinessBindingRepository: readiness, assetCompositionPlanRepository: compositions,
      delegatedTurnAdmission: createLocalDelegatedConversationTurnAdmission(options),
      adapterCatalog: createPythonConversationalRuntimeAdapterCatalog(), runtimeGuard: createPythonConversationalRuntimeGuard(runtime),
      invocationPort: createPythonConversationalTextGenerationInvocationAdapter(runtime, registry),
      hostCapabilities: { submitTurn: "supported", cancelTurn: "unsupported", retryTurn: "unsupported", streaming: false }, now: () => at });
    const hostIncarnationId = "f06f4016-f0ee-43fa-808f-09f815df8d6b";
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const workflows = new HeadlessWorkflowMetadataUseCase(composeSystemRunWorkflow({ handlers: [
      createConversationWorkflowHandler({ executionPlans: plans, conversations: services, now: () => at }),
    ] }).useCases);
    const prepared = await workflows.prepare(workspaceId, { profileId: "builtin.workflow.conversation@1.0.0",
      source: { kind: "reviewed-execution-plan", sourceId: planId, sourceRevision: at } }, {
      context: { actorId: identity.principalId, organizationId: identity.organizationId, authenticated: true, roles: ["owner"] },
      canRead: async target => target === workspaceId && clientCurrent,
      canDiscoverApprovedTurns: async target => target === workspaceId && clientCurrent,
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    if (!prepared.ok) throw new Error("Original text workflow is unavailable.");
    assert.deepEqual(prepared.value.approvedSessionIds, [sessionId]);
    const input = { workspaceId, planId, planRevision: at, sessionId, snapshotRevision: prepared.value.snapshotRevision,
      key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic approved text input" };
    host = composeDesktopHeadlessConversation({ hostIncarnationId, identity, platformDocuments: platform, rootDirectory: root,
      workspaces, authorization: composeDesktopWorkspaceAuthorization({ documents: platform, localIdentity: identity }),
      readRole: async () => "owner", isOpen: () => hostOpen, sessions: conversations.conversationSessionRepository,
      submit: services.submitTurn, workflows });
    const grant = { organizationId: identity.organizationId, principalId: identity.principalId,
      registeredClientId: "06f56324-2051-462c-b45b-d9b49bf6dd4a", conversation: true as const,
      workspaceIds: [workspaceId] as const, operations: HEADLESS_READ_OPERATIONS, isCurrent: () => clientCurrent };
    const authority = { grant, currentGrant: async () => clientCurrent ? grant : undefined,
      fingerprint: (value: string) => createHmac("sha256", "synthetic-text-reservation-key").update(value).digest("hex") };
    assert.deepEqual(await host.execute({ ...input, key: "56f56324-2051-462c-b45b-d9b49bf6dd4a", planRevision: "stale-revision" }, authority),
      { ok: false, code: "headless.forbidden" });
    assert.equal(starts, 0);
    const accepted = await host.execute(input, authority);
    assert.ok(accepted.ok, JSON.stringify(accepted));
    if (!accepted.ok) throw new Error("No accepted text task.");
    const handle = accepted.value;
    const status = new HeadlessConversationStatusUseCase({ sessions: conversations.conversationSessionRepository,
      turns: conversations.conversationTurnRepository, runs: execution.executionRunRepository });
    const running = await status.read(workspaceId, sessionId, handle.turnId, async () => clientCurrent);
    assert.deepEqual(running, { ok: true, value: { sessionId, turnId: handle.turnId, turnStatus: "generating",
      run: { runId: handle.runId, status: "running" } } });
    for (const value of [prepared, accepted, running]) {
      assert.equal(JSON.stringify(value).includes(input.text), false);
      assert.equal(JSON.stringify(value).includes("Synthetic saved assistant result."), false);
    }
    assert.deepEqual(await host.execute(input, authority), accepted);
    assert.deepEqual(await host.execute({ ...input, text: "Different input" }, authority), { ok: false, code: "headless.idempotency-conflict" });
    // The actual adapter declares no cancellation support. Check that truth
    // while the task is running, before a terminal-state refusal can apply.
    const cancelled = await services.cancelTurn.execute({ workspaceId, conversationSessionId: sessionId,
      conversationTurnId: handle.turnId, operationId: "synthetic-cancel" });
    assert.equal(cancelled.kind, "success");
    if (cancelled.kind === "success") assert.equal(cancelled.value.status, "not-supported");
    await originalRuntimeObserved;
    // Withdrawal suppresses outward access; the already accepted original task
    // still owns recording its result. It is neither restarted nor abandoned.
    clientCurrent = false;
    assert.deepEqual(await status.read(workspaceId, sessionId, handle.turnId, async () => clientCurrent),
      { ok: false, code: "headless.forbidden" });
    released = true;
    await host.drain();
    assert.equal(starts, 1); assert.ok(statusReads >= 1);
    assert.equal(runtimeRequest?.taskType, "conversation-text-generation");
    assert.deepEqual(runtimeRequest?.payload, { messages: [{ role: "user", content: input.text }],
      generation: undefined, selectedModelId: "qualification/controlled-text" });
    // Read through new repository objects rather than the submitting objects.
    const saved = createLocalConversationRepositoryAdapters(options);
    const runs = createLocalExecutionRunRepositoryAdapters(options);
    const turn = await saved.conversationTurnRepository.getConversationTurnById(workspaceId, normalizeConversationTurnId(handle.turnId));
    assert.equal(turn?.status, "succeeded"); assert.equal(turn?.executionRunId, handle.runId);
    assert.ok(turn?.assistantResponseId);
    const response = await saved.assistantResponseRepository.getAssistantResponseById(workspaceId, turn!.assistantResponseId!);
    assert.equal(response?.text, "Synthetic saved assistant result."); assert.equal(response?.status, "completed");
    assert.equal(response?.conversationTurnId, handle.turnId); assert.equal(response?.executionRunId, handle.runId);
    assert.ok(response?.executionResultId);
    const result = await runs.executionResultRepository.getExecutionResultById(workspaceId, response!.executionResultId);
    assert.equal(result?.assistantResponseId, response!.id); assert.equal(result?.conversationTurnId, handle.turnId);
    assert.equal(result?.executionRunId, handle.runId);
    const transcript = await services.readTranscript.readTranscript({ workspaceId, conversationSessionId: sessionId });
    assert.ok(transcript.ok);
    if (!transcript.ok) throw new Error("Saved transcript is unavailable.");
    assert.equal(transcript.turns.length, 1);
    assert.equal(transcript.turns[0]?.assistantResponse?.id, response!.id);
    assert.equal(transcript.turns[0]?.assistantResponse?.text, response!.text);
    assert.deepEqual(await host.execute(input, authority), { ok: false, code: "headless.forbidden" });
    clientCurrent = true;
    assert.deepEqual(await host.execute(input, authority), accepted);
    assert.deepEqual(await status.read(workspaceId, sessionId, handle.turnId, async () => clientCurrent),
      { ok: true, value: { sessionId, turnId: handle.turnId, turnStatus: "succeeded",
        run: { runId: handle.runId, status: "succeeded" } } });
    clientCurrent = false;
    assert.deepEqual(await status.read(workspaceId, sessionId, handle.turnId, async () => clientCurrent), { ok: false, code: "headless.forbidden" });
    assert.equal((await saved.conversationTurnRepository.listConversationTurnsBySession(workspaceId, sessionId)).length, 1);
    assert.equal(starts, 1);
  });
}
