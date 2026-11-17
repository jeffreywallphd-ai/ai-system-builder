import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { InitialConversationTurnWrites } from "../../../../application/ports/conversations/delegated-conversation-turn-admission.port";
import { normalizeConversationMessageId, normalizeConversationSessionId, normalizeConversationTurnId } from "../../../../contracts/conversations";
import { normalizeExecutionApprovalId, normalizeExecutionAttemptId, normalizeExecutionEventId, normalizeExecutionRunId, normalizeExecutionRuntimeReferenceId } from "../../../../contracts/execution-runs";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalExecutionRunRepositoryAdapters } from "../../execution-runs";
import type { StructuredDocumentStore } from "../../shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../sqlite";
import { createLocalConversationRepositoryAdapters } from "../createLocalConversationRepositoryAdapters";
import { createLocalDelegatedConversationTurnAdmission } from "../createLocalDelegatedConversationTurnAdmission";

const workspaceId = createWorkspaceId("fixture-workspace");
const sessionId = normalizeConversationSessionId("fixture-session");
const turnId = normalizeConversationTurnId("fixture-turn");
const messageId = normalizeConversationMessageId("fixture-message");
const runId = normalizeExecutionRunId("fixture-run");
const attemptId = normalizeExecutionAttemptId("fixture-attempt");
const eventId = normalizeExecutionEventId("fixture-event");
const approvalId = normalizeExecutionApprovalId("fixture-approval");
const runtimeReferenceId = normalizeExecutionRuntimeReferenceId("fixture-runtime");
const at = "2026-11-13T00:00:00.000Z";
const lifecycle = { workspaceId, createdAt: at, updatedAt: at, blockers: [], diagnostics: [], provenance: [] };

async function persistInitialRecords(repositories: InitialConversationTurnWrites) {
  await repositories.messageRepository.saveConversationMessage({ id: messageId, workspaceId, conversationSessionId: sessionId,
    conversationTurnId: turnId, role: "user", contentKind: "plain-text", text: "Synthetic input", createdAt: at });
  await repositories.turnRepository.saveConversationTurn({ ...lifecycle, id: turnId, conversationSessionId: sessionId,
    sourceExecutionPlanId: "fixture-plan", userMessageId: messageId, executionRunId: runId, status: "generating", sequence: 1 });
  await repositories.executionRunRepository.saveExecutionRun({ ...lifecycle, id: runId, sourceExecutionPlanId: "fixture-plan",
    sourceContextKind: "conversation-turn", sourceContextId: turnId, status: "running", attemptIds: [attemptId], eventIds: [], resultIds: [] });
  await repositories.executionAttemptRepository.saveExecutionAttempt({ ...lifecycle, id: attemptId, executionRunId: runId,
    attemptNumber: 1, status: "started", runtimeReferenceId });
  await repositories.executionEventRepository.appendExecutionEvent({ id: eventId, workspaceId, executionRunId: runId,
    executionAttemptId: attemptId, conversationSessionId: sessionId, conversationTurnId: turnId,
    kind: "run-start-requested", category: "lifecycle", message: "Synthetic start requested", at });
}

test("owned SQLite admission compares exact saved authority and rolls back every initial record together", async () => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "delegated-turn-")));
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory }) });
    const documents = db.documents.forOrganization(createOrganizationId("fixture-org"));
    const options = { rootDir: directory, documents, now: () => at };
    const conversations = createLocalConversationRepositoryAdapters(options);
    const execution = createLocalExecutionRunRepositoryAdapters(options);
    const sessions = conversations.conversationSessionRepository;
    const approvals = execution.executionApprovalRepository;
    const approved = await sessions.saveConversationSession({ ...lifecycle, id: sessionId, sourceExecutionPlanId: "fixture-plan",
      executionApprovalId: approvalId, runtimeReferenceId, status: "approved", systemLabel: "Synthetic", turnIds: [] });
    const permission = await approvals.saveExecutionApproval({ ...lifecycle, id: approvalId, sourceExecutionPlanId: "fixture-plan",
      conversationSessionId: sessionId, approvalKind: "conversation-session-execution", approvalStatus: "granted", label: "Synthetic approval",
      runtimeReferenceId, sourcePlanRevision: "fixture-plan-r1" });
    let current = true;
    let writes = 0;
    const request = { session: approved, approval: permission, turnId, operationId: "fixture-op", updatedAt: at,
      isCurrent: () => current, async writeInitialRecords(repositories: InitialConversationTurnWrites) {
        writes++;
        await persistInitialRecords(repositories);
      } };
    const admission = createLocalDelegatedConversationTurnAdmission(options);
    const assertAbsent = async () => {
      assert.deepEqual(await conversations.conversationTurnRepository.listConversationTurnsBySession(workspaceId, sessionId), []);
      assert.deepEqual(await conversations.conversationMessageRepository.listConversationMessagesBySession(workspaceId, sessionId), []);
      assert.equal(await execution.executionRunRepository.getExecutionRunById(workspaceId, runId), undefined);
      assert.equal(await execution.executionAttemptRepository.getExecutionAttemptById(workspaceId, attemptId), undefined);
      assert.deepEqual((await execution.executionEventRepository.listExecutionEventsByRun(workspaceId, runId, 10)).events, []);
      assert.equal(await conversations.conversationOperationRepository.getConversationOperationById(workspaceId, sessionId, request.operationId), undefined);
    };

    assert.equal(await admission.isStillCurrent(request), true);
    await assertAbsent();
    const closed = await sessions.updateConversationSession({ ...approved, status: "closed", closedAt: at });
    assert.equal(await admission.isStillCurrent(request), false);
    assert.equal(await admission.admit(request), undefined);
    assert.equal(writes, 0);
    assert.deepEqual(await sessions.getConversationSessionById(workspaceId, sessionId), closed);
    await assertAbsent();
    await sessions.updateConversationSession(approved);

    await approvals.saveExecutionApproval({ ...permission, approvalStatus: "revoked", revokedAt: at });
    assert.equal(await admission.isStillCurrent(request), false);
    assert.equal(await admission.admit(request), undefined);
    assert.equal(writes, 0);
    await assertAbsent();
    await approvals.saveExecutionApproval(permission);

    const platformNamespace = "test-delegated-admission";
    await db.documents.writeDocument(platformNamespace, "policy", { active: false }, { expectedRevision: 0 });
    const platformAdmission = createLocalDelegatedConversationTurnAdmission({
      ...options,
      platform: { documents: db.documents, async authorize(owner, workspace, plan, revision) {
        assert.equal(owner.organizationId, undefined);
        assert.deepEqual([workspace, plan, revision], [workspaceId, "fixture-plan", "fixture-plan-r1"]);
        return (await owner.readDocument<{ active: boolean }>(platformNamespace, "policy"))?.value.active === true;
      } },
    });
    assert.equal(await platformAdmission.admit(request), undefined);
    assert.equal(await platformAdmission.isStillCurrent(request), false);
    await assertAbsent();
    await db.documents.writeDocument(platformNamespace, "policy", { active: true }, { expectedRevision: 1 });
    assert.equal(await platformAdmission.isStillCurrent(request), true);

    const wrapped: StructuredDocumentStore = { ...documents,
      runInOwnedTransaction: (work, beforeCommit) => documents.runInOwnedTransaction!(work, () => { current = false; beforeCommit(); }),
    };
    const closingAdmission = createLocalDelegatedConversationTurnAdmission({ ...options, documents: wrapped });
    assert.equal(await closingAdmission.isStillCurrent(request), false);
    current = true;
    assert.equal(await closingAdmission.admit(request), undefined);
    assert.equal(writes, 1);
    assert.deepEqual(await sessions.getConversationSessionById(workspaceId, sessionId), approved);
    await assertAbsent();

    current = true;
    const [linked, duplicate] = await Promise.all([platformAdmission.admit(request), platformAdmission.admit(request)]);
    assert.deepEqual(linked, { ...approved, status: "active", turnIds: [turnId] });
    assert.equal(duplicate, undefined);
    assert.equal(writes, 2);
    assert.equal(await admission.admit({ ...request, session: linked!, turnId: normalizeConversationTurnId("other-turn") }), undefined);
    assert.equal(writes, 2);
    assert.equal((await conversations.conversationOperationRepository.getConversationOperationById(workspaceId, sessionId, request.operationId))?.status, "pending");
    assert.deepEqual((await conversations.conversationTurnRepository.listConversationTurnsBySession(workspaceId, sessionId)).map(turn => turn.id), [turnId]);
    assert.deepEqual((await conversations.conversationMessageRepository.listConversationMessagesBySession(workspaceId, sessionId)).map(message => message.id), [messageId]);
    assert.equal((await execution.executionRunRepository.getExecutionRunById(workspaceId, runId))?.sourceContextId, turnId);
    assert.equal((await execution.executionAttemptRepository.getExecutionAttemptById(workspaceId, attemptId))?.executionRunId, runId);
    assert.deepEqual((await execution.executionEventRepository.listExecutionEventsByRun(workspaceId, runId, 10)).events.map(event => event.id), [eventId]);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
