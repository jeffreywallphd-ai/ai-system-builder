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

import { exerciseComposedTextWorkflow, summarizeTextRuntimeStatus } from "./headless-text-workflow.fixture";

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

// Only the Python boundary is controlled in the default software cases.
for (const engine of ["Core", "SQLite"] as const) {
  test(`${engine} composed approved text turn saves the original response and replays one runtime task`,
    { timeout: 15_000 }, async t => { await exerciseComposedTextWorkflow(t, engine); });
}

test("text recording may outlast the shutdown-drain timer without restarting the accepted task",
  { timeout: 15_000 }, async t => {
    const unexpected = async (): Promise<never> => { throw new Error("Unexpected runtime operation."); };
    const runtime: PythonRuntimePort = {
      async startTask(request) {
        return { requestId: request.requestId, taskType: request.taskType, status: "running", accepted: true };
      },
      async readTaskStatus(requestId) {
        await new Promise<void>(resolve => setTimeout(resolve, 6_000));
        return { requestId, status: "succeeded", data: { assistantResponseText: "Delayed synthetic response." } };
      },
      async getHealthStatus() { return { healthy: true, status: { runtimeId: "python-sidecar", status: "ready" } }; },
      async getCapabilities() { return { runtimeId: "python-sidecar", capabilities: ["conversation-text-generation"] }; },
      cancelTask: unexpected, ensureModelDownloaded: unexpected, resolveModelDownloadTaskResult: unexpected,
      getModelStatus: unexpected, unloadModels: unexpected,
    };
    const facts = await exerciseComposedTextWorkflow(t, "Core", {runtime});
    assert.equal(facts.starts, 1);
    assert.equal(facts.statusReads, 1);
    assert.equal(facts.responseCharacters, "Delayed synthetic response.".length);
  });

test("text diagnostics retain only closed failure classifications", () => {
  const privateText = "Private prompt, model output, credential and local path must never be copied";
  assert.deepEqual(summarizeTextRuntimeStatus({requestId: privateText, status: "failed", data: privateText,
    metadata: {privateText}, error: {code: privateText, message: privateText,
      details: {diagnosticClass: privateText, privateText}}}),
    {status: "failed", failureCode: "other", failureClass: "other"});
  assert.deepEqual(summarizeTextRuntimeStatus({requestId: privateText, status: "failed",
    error: {code: "task_failed", message: privateText, details: {diagnosticClass: "GenerationModelLoadError", privateText}}}),
    {status: "failed", failureCode: "task_failed", failureClass: "GenerationModelLoadError"});
  assert.deepEqual(summarizeTextRuntimeStatus({requestId: privateText, status: "succeeded", data: privateText}),
    {status: "succeeded"});
});

test("original failed text task remains failed and produces only closed diagnostics", async t => {
  const unexpected = async (): Promise<never> => { throw new Error("Unexpected runtime operation."); };
  const observations: ReturnType<typeof summarizeTextRuntimeStatus>[] = [];
  let starts = 0, cleaned = false;
  const runtime: PythonRuntimePort = {
    async startTask(request) {
      starts++;
      return {requestId: request.requestId, taskType: request.taskType, status: "running", accepted: true};
    },
    async readTaskStatus(requestId) {
      return {requestId, status: "failed", error: {code: "task_failed", message: "Private failure detail",
        details: {diagnosticClass: "GenerationModelLoadError", raw: "Private payload"}}};
    },
    async getHealthStatus() { return {healthy: true, status: {runtimeId: "python-sidecar", status: "ready"}}; },
    async getCapabilities() { return {runtimeId: "python-sidecar", capabilities: ["conversation-text-generation"]}; },
    cancelTask: unexpected, ensureModelDownloaded: unexpected, resolveModelDownloadTaskResult: unexpected,
    getModelStatus: unexpected, unloadModels: unexpected,
  };
  let cleanup: (() => Promise<void>) | undefined;
  try {
    await assert.rejects(exerciseComposedTextWorkflow(t, "Core", {runtime,
      onRuntimeObservation(value) {observations.push(value);}, onCleanup() {cleaned = true;},
      registerCleanup(value) {cleanup = value;}}));
  } finally {await cleanup?.();}
  assert.equal(starts, 1);
  assert.equal(cleaned, true);
  assert.deepEqual(observations, [{status: "failed", failureCode: "task_failed", failureClass: "GenerationModelLoadError"}]);
});
