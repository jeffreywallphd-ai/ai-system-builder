import assert from "node:assert/strict";
import {test} from "node:test";
import {readConfirmedFailedContextBuild} from "../visual-composer/e2e/headless-context-failure-oracles";

function fixture() {
  const taskId = "20000000-0000-4000-8000-000000000001";
  const target = {workspaceId: "workspace.synthetic" as never, hostIncarnationId: "10000000-0000-4000-8000-000000000001" as never,
    fingerprint: "a".repeat(64), approvalRevision: 1, step: 1};
  const value = {kind: "started", operation: "context.generate-rag", reference: {workspaceId: target.workspaceId, taskId},
    fingerprint: target.fingerprint, approvalRevision: target.approvalRevision, step: target.step, expiresAt: 2_000_000_000_000};
  return {target, started: {ok: true, value}, terminal: {ok: true, operation: "context.task", value: {taskId, state: "failed", review: null}},
    replayed: {ok: true, value: {...value, kind: "replayed"}}};
}
test("only a correlated started, failed and exact replayed task supplies failure proof", () => {
  const input = fixture(), proof = readConfirmedFailedContextBuild(input);
  assert.deepEqual(proof, {taskId: input.terminal.value.taskId}); assert.ok(Object.isFrozen(proof));
});
test("refusals, unconfirmed starts and new-task replays cannot count as failed worker execution", () => {
  for (const code of ["headless.not-started", "headless.unavailable", "headless.operation-unconfirmed", "headless.forbidden"]) {
    const input = fixture();
    assert.equal(readConfirmedFailedContextBuild({...input, started: {ok: false, code}}), undefined);
    assert.equal(readConfirmedFailedContextBuild({...input, replayed: {ok: false, code}}), undefined);
  }
  for (const change of [
    (i: any) => {i.started.value.kind = "replayed";}, (i: any) => {i.started.value.operation = "context.generate-pack";},
    (i: any) => {i.replayed.value.kind = "started";},
    (i: any) => {i.replayed.value.reference = {...i.replayed.value.reference, taskId: "30000000-0000-4000-8000-000000000001"};},
    (i: any) => {i.replayed.value.expiresAt++;}, (i: any) => {i.replayed.value.fingerprint = "b".repeat(64);},
    (i: any) => {i.replayed.value.approvalRevision++;}, (i: any) => {i.replayed.value.step++;},
    (i: any) => {i.replayed.value.reference = {...i.replayed.value.reference, workspaceId: "workspace.foreign"};},
    (i: any) => {i.target.extra = "private";},
  ]) {const input = fixture(); change(input); assert.equal(readConfirmedFailedContextBuild(input), undefined);}
});
test("foreign, nonterminal, reviewable and private terminal payloads deny without disclosure", () => {
  for (const change of [
    (i: any) => {i.terminal.ok = false;}, (i: any) => {i.terminal.operation = "other";},
    (i: any) => {i.terminal.value = {...i.terminal.value, taskId: "30000000-0000-4000-8000-000000000001"};},
    ...["queued", "running", "succeeded", "review-required", "saved", "cancelled"].map(state => (i: any) => {i.terminal.value.state = state;}),
    (i: any) => {i.terminal.value.review = {};}, (i: any) => {delete i.terminal.value.review;},
    (i: any) => {i.terminal.value.localPath = "synthetic-private-path";},
    (i: any) => {i.terminal.value.error = "synthetic-private-error";}, (i: any) => {i.terminal.code = "private";},
  ]) {const input = fixture(); change(input); assert.equal(readConfirmedFailedContextBuild(input), undefined);}
});
