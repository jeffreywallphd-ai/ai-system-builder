import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION} from "../../../../contracts/headless";
import {runPreparedHeadlessContextQuery} from "../headlessContextQueryExecution";

/** Controlled collaborators isolate exact ACK/accept/request-lifetime handoffs.
 * Actual Core + SQLite + both host journeys live in headless-context-result-execution.unit.test.ts. */
function fixture() {
  const question = "Synthetic transient query", taskId = randomUUID();
  const state = {caller: true, host: true, owned: true, accepted: false, acceptAcknowledged: true,
    issue: "issued" as "issued" | "denied" | "unconfirmed", closeBeforeAccept: false,
    observation: "absent" as "absent" | "accepted" | "unconfirmed" | "not-started"};
  const calls = {owner: 0, reserve: 0, issue: 0, accept: 0, nonstart: 0, owned: 0};
  const input = {hostIncarnationId: randomUUID(), workspaceId: "workspace.synthetic", fingerprint: "a".repeat(64), approvalRevision: 2, step: 1};
  const context = {organizationId: "org.synthetic", principalId: "principal.synthetic", workspaceId: input.workspaceId};
  const compiled = {artifactId: "private/context", artifactDigest: "sha256:" + "b".repeat(64), artifactSizeBytes: 32,
    embeddingModel: {modelRecordId: "model.one", modelUpdatedAt: "2026-11-18T00:00:00.000Z", modelId: "synthetic/embedding", recordDigest: "sha256:" + "c".repeat(64)},
    sources: [{artifactId: "private/source", digest: "sha256:" + "d".repeat(64)}], publicSources: []};
  const prepared = {kind: "context-query", request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.query", input: {
    queryDigest: "sha256:" + createHash("sha256").update(question).digest("hex"), workspaceId: input.workspaceId,
    maximumResults: 3, embeddingDevice: "cpu"}}, expiresAt: Date.now() + 60_000,
    isCurrent: () => state.caller, stillAllowed: async () => state.caller, validateInputs: async () => state.caller,
    inspect: async () => state.observation === "accepted" ? {kind: "accepted", reference: {workspaceId: input.workspaceId, taskId}}
      : {kind: state.observation},
    reserve: async () => {calls.reserve++; return {kind: "new", taskId, sourceDigest: "e".repeat(64), compiled};},
    issue: async () => {calls.issue++; return state.issue;},
    accept: async (selected: string) => {calls.accept++; assert.equal(selected, taskId); state.accepted = true; return state.acceptAcknowledged;},
    recordNotStarted: async () => {calls.nonstart++; return true;},
    readReceipt: async () => ({workspaceId: input.workspaceId, taskId}), publishIfCurrent: async () => state.caller};
  const options: Parameters<typeof runPreparedHeadlessContextQuery>[0] = {prepared: prepared as never,
    request: {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step", input} as never, question, context,
    canUse: async () => state.caller, isHostCurrent: () => state.host,
    ownedPolicy: () => async () => {calls.owned++; return state.owned;},
    resolveOwner: async () => {calls.owner++; return {async startAdmittedContextQuery(command, actor, admission) {
      assert.equal(command.query, question); assert.deepEqual(actor, context);
      const issue = await admission.issue();
      if (issue !== "issued") return {kind: issue === "denied" ? "not-started" : "unconfirmed"};
      if (state.closeBeforeAccept) state.caller = false;
      const accepted = await admission.accept(taskId);
      if (!accepted) return {kind: "unconfirmed"};
      assert.equal(admission.isCurrent(), state.host);
      assert.equal(await admission.stillAllowed(), state.host && state.owned);
      return {kind: "accepted", taskId};
    }, async readAdmittedContextQueryTask() {assert.fail("Start cannot observe/adopt status.");}};}};
  return {options, state, calls};
}

test("query ACK is recorded after caller closure, then owned policy replaces request lifetime without releasing the start reply", async () => {
  const f = fixture(); f.state.closeBeforeAccept = true;
  const result = await runPreparedHeadlessContextQuery(f.options);
  assert.deepEqual(result.result, {ok: false, code: "headless.forbidden"});
  assert.equal(f.state.accepted, true); assert.equal(f.calls.accept, 1); assert.equal(f.calls.owned, 1);
});

test("lost acceptance acknowledgement cannot switch policy or become a successful start", async () => {
  const f = fixture(); f.state.acceptAcknowledged = false;
  const result = await runPreparedHeadlessContextQuery(f.options);
  assert.deepEqual(result.result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(f.calls.accept, 1); assert.equal(f.calls.owned, 0);
});

test("unknown issue never records acceptance or authorizes replacement work", async () => {
  const f = fixture(); f.state.issue = "unconfirmed";
  assert.deepEqual((await runPreparedHeadlessContextQuery(f.options)).result, {ok: false, code: "headless.operation-unconfirmed"});
  f.state.observation = "unconfirmed";
  assert.deepEqual((await runPreparedHeadlessContextQuery({...f.options, question: undefined})).result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(f.calls.issue, 1); assert.equal(f.calls.reserve, 1); assert.equal(f.calls.accept, 0);
});

test("query text bounds/hash are checked before resolving any owner or reserving work; replay needs no question", async () => {
  const f = fixture();
  for (const question of [undefined, "Other", "x".repeat(2001), "\ud800"])
    assert.equal((await runPreparedHeadlessContextQuery({...f.options, question})).result.ok, false);
  assert.equal(f.calls.owner + f.calls.reserve, 0);
  f.state.observation = "accepted";
  const replay = await runPreparedHeadlessContextQuery({...f.options, question: undefined});
  assert.equal(replay.result.ok, true); assert.equal(f.calls.owner + f.calls.reserve, 0);
});
