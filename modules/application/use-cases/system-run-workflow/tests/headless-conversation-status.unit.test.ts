import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConversationMessageId, normalizeConversationSessionId, normalizeConversationTurnId,
  type ConversationSessionRecord, type ConversationTurnRecord } from "../../../../contracts/conversations";
import { normalizeExecutionRunId, type ExecutionRunRecord } from "../../../../contracts/execution-runs";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { HeadlessConversationStatusUseCase } from "../headless-conversation-status.use-case";

const workspaceId = createWorkspaceId("owned-workspace");
const sessionId = normalizeConversationSessionId("conversation.fixture");
const turnId = normalizeConversationTurnId("turn.fixture");
const runId = normalizeExecutionRunId("run.fixture");
const at = "2026-11-13T00:00:00Z";
const metadata = { workspaceId, sourceExecutionPlanId: "plan.fixture", blockers: [], diagnostics: [],
  provenance: [], createdAt: at, updatedAt: at };
const session: ConversationSessionRecord = {
  ...metadata, id: sessionId, status: "approved", systemLabel: "Private name", sourceCompositionPlanId: "compose.fixture",
  sourceRuntimeReadinessBindingId: "readiness.fixture", turnIds: [turnId],
};
const turn: ConversationTurnRecord = {
  ...metadata, id: turnId, conversationSessionId: sessionId, executionRunId: runId,
  userMessageId: normalizeConversationMessageId("message.fixture"), status: "generating", sequence: 1,
};
const run: ExecutionRunRecord = { ...metadata, id: runId, sourceContextKind: "conversation-turn", sourceContextId: turnId,
  status: "running", attemptIds: [], eventIds: [], resultIds: [], runtimeReferenceId: "private.runtime" };

function setup(options: { wrongTurn?: boolean; wrongRun?: boolean; revokeOnRun?: boolean; runless?: boolean } = {}) {
  let allowed = true;
  let reads = 0;
  const status = new HeadlessConversationStatusUseCase({
    sessions: { async getConversationSessionById(scope, id) { reads++; return scope === workspaceId && id === sessionId ? session : undefined; } },
    turns: { async getConversationTurnById() {
      reads++;
      return { ...turn, ...(options.wrongTurn ? { conversationSessionId: normalizeConversationSessionId("other.session") } : {}),
        ...(options.runless ? { executionRunId: undefined } : {}) };
    } },
    runs: { async getExecutionRunById() {
      reads++;
      if (options.revokeOnRun) allowed = false;
      return { ...run, ...(options.wrongRun ? { sourceContextId: "other.turn" } : {}) };
    } },
  });
  return { status, reads: () => reads, allowed: async () => allowed };
}

test("projects only saved lifecycle values and an authoritative run handle", async () => {
  const fixture = setup();
  assert.deepEqual(await fixture.status.read(workspaceId, sessionId, turnId, fixture.allowed), {
    ok: true, value: { sessionId, turnId, turnStatus: "generating", run: { runId, status: "running" } },
  });
  const early = setup({ runless: true });
  assert.deepEqual(await early.status.read(workspaceId, sessionId, turnId, early.allowed),
    { ok: true, value: { sessionId, turnId, turnStatus: "generating", run: null } });
  assert.equal(early.reads(), 2);
});

test("denies missing scope, inconsistent turn ownership and revocation before returning run status", async () => {
  const fixture = setup();
  assert.deepEqual(await fixture.status.read(workspaceId, sessionId, turnId, async () => false), { ok: false, code: "headless.forbidden" });
  assert.equal(fixture.reads(), 0);
  const wrong = setup({ wrongTurn: true });
  assert.deepEqual(await wrong.status.read(workspaceId, sessionId, turnId, wrong.allowed), { ok: false, code: "headless.not-found" });
  assert.equal(wrong.reads(), 2);
  const mismatch = setup({ wrongRun: true });
  assert.deepEqual(await mismatch.status.read(workspaceId, sessionId, turnId, mismatch.allowed), { ok: false, code: "headless.unavailable" });
  const revoked = setup({ revokeOnRun: true });
  assert.deepEqual(await revoked.status.read(workspaceId, sessionId, turnId, revoked.allowed), { ok: false, code: "headless.forbidden" });
});
