import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, readHeadlessLocalDatasetPlanRequest} from "../../../../contracts/headless";
import {inspectStructuredDatasetPlanTask, reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask,
  acceptStructuredDatasetPlanTask, readStructuredOwnedDatasetPlanTask, readStructuredOwnedDatasetPlanTaskByPlan,
  readStructuredPresentableDatasetPlanTask, readStructuredOwnedDatasetPlanTaskSourceDigest,
  type DatasetPlanTaskEffect} from "../createStructuredHeadlessDatasetPlanTaskStore";

function fixture() {
  const root = createInMemoryStructuredDocumentStore();
  const organizationId = createOrganizationId("organization.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const decoded = readHeadlessLocalDatasetPlanRequest({version: "aisb-headless-v1", operation: "data.prepare-local-dataset", input: {
    hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), sources: [{taskId: "source.task", fileId: "source.file", taskRevision: 3}],
    recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}}, host);
  assert.ok(decoded.ok);
  const target = {hostIncarnationId: host, fingerprint: "a".repeat(64),
    scope: {organizationId, workspaceId, principalId: "principal.synthetic", registeredClientId: randomUUID()}};
  const effect: DatasetPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 2, step: 1, request: decoded.request};
  const owner = root.forOrganization(organizationId), sourceDigest = "b".repeat(64);
  const transaction = <T>(work: (partition: typeof owner) => Promise<T>, fence: () => void = () => {}) =>
    root.runInOwnedTransaction!(part => work(part.forOrganization(organizationId)), fence);
  return {root, owner, target, effect, sourceDigest, transaction};
}

test("an exact task moves once from reserved to issued to accepted, with a private opaque ID and point-owned replay", async () => {
  const f = fixture();
  const first = await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.equal(first.kind, "new"); assert.ok("taskId" in first);
  assert.notEqual(first.taskId, f.effect.key);
  assert.deepEqual(await inspectStructuredDatasetPlanTask(f.owner, f.effect), {kind: "unconfirmed"});
  assert.deepEqual(await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 2)), {kind: "unconfirmed"});
  assert.equal(await f.transaction(owner => issueStructuredDatasetPlanTask(owner, f.effect, first.taskId, "c".repeat(64), 2)), false);
  assert.equal(await f.transaction(owner => acceptStructuredDatasetPlanTask(owner, f.effect, first.taskId, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredDatasetPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)), true);
  assert.equal(await f.transaction(owner => issueStructuredDatasetPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 3)), false);
  assert.equal(await f.transaction(owner => acceptStructuredDatasetPlanTask(owner, f.effect, randomUUID(), 3)), false);
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await f.transaction(owner => acceptStructuredDatasetPlanTask(owner, f.effect, first.taskId, 3)), true);
  const reference = {workspaceId: f.target.scope.workspaceId, taskId: first.taskId};
  assert.deepEqual(await inspectStructuredDatasetPlanTask(f.owner, f.effect), {kind: "accepted", reference});
  assert.deepEqual(await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 4)), {kind: "accepted", reference});
  assert.deepEqual(await readStructuredOwnedDatasetPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), reference);
  const {registeredClientId: _client, ...actor} = f.target.scope;
  assert.deepEqual(await readStructuredPresentableDatasetPlanTask(f.owner, actor, f.target.hostIncarnationId, first.taskId), reference);
  // Presentation consent is independent, but it must not weaken execution ownership.
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.owner, actor as never, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredOwnedDatasetPlanTaskSourceDigest(f.owner, actor as never, f.target.hostIncarnationId, first.taskId), undefined);
  assert.deepEqual(await inspectStructuredDatasetPlanTask(f.owner, {...f.effect, approvalRevision: 3}), {kind: "accepted", reference});
  assert.deepEqual(await readStructuredOwnedDatasetPlanTaskByPlan(f.owner, f.target.scope, f.target.hostIncarnationId,
    f.target.fingerprint, f.effect.step), reference);
  assert.equal(await readStructuredOwnedDatasetPlanTaskByPlan(f.owner, f.target.scope, f.target.hostIncarnationId,
    f.target.fingerprint, f.effect.step + 1), undefined);
  for (const scope of [{...f.target.scope, registeredClientId: randomUUID()}, {...f.target.scope, principalId: "another.actor"},
    {...f.target.scope, organizationId: createOrganizationId("another.organization")}, {...f.target.scope, workspaceId: createWorkspaceId("another.workspace")}])
    assert.equal(await readStructuredOwnedDatasetPlanTask(f.owner, scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.owner, f.target.scope, randomUUID(), first.taskId), undefined);
  for (const scope of [{...actor, principalId: "another.actor"}, {...actor, workspaceId: createWorkspaceId("another.workspace")},
    {...actor, organizationId: createOrganizationId("another.organization")}])
    assert.equal(await readStructuredPresentableDatasetPlanTask(f.owner, scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredPresentableDatasetPlanTask(f.owner, actor, randomUUID(), first.taskId), undefined);
});

test("root-owned rollback leaves no reservation and a lost acknowledgement never supplies a fresh start", async () => {
  const f = fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 1), () => {throw new Error("Synthetic rollback.");}));
  assert.deepEqual(await inspectStructuredDatasetPlanTask(f.owner, f.effect), {kind: "absent"});
  await assert.rejects((async () => {
    await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 1));
    throw new Error("Synthetic lost reservation acknowledgement.");
  })());
  assert.deepEqual(await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 2)), {kind: "unconfirmed"});
  await assert.rejects(reserveStructuredDatasetPlanTask(f.owner, {...f.effect, key: randomUUID()}, f.sourceDigest, 2));
});

test("a changed operation identity cannot take another reservation or accepted task", async () => {
  const f = fixture();
  const first = await f.transaction(owner => reserveStructuredDatasetPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.ok("taskId" in first);
  const foreign = {...f.effect, target: {...f.target, scope: {...f.target.scope, registeredClientId: randomUUID()}}};
  await assert.rejects(inspectStructuredDatasetPlanTask(f.owner, foreign));
  assert.equal(await f.transaction(owner => issueStructuredDatasetPlanTask(owner, f.effect, randomUUID(), f.sourceDigest, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredDatasetPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)), true);
  // Outcome recording is trusted business continuation after issuance; outward
  // access/replay remains the host's separate current-permission boundary.
  assert.equal(await f.transaction(owner => acceptStructuredDatasetPlanTask(owner, f.effect, first.taskId, 3)), true);
  assert.equal(await f.transaction(owner => acceptStructuredDatasetPlanTask(owner, f.effect, first.taskId, 4)), true);
  assert.deepEqual(await inspectStructuredDatasetPlanTask(f.owner, f.effect), {kind: "accepted", reference: {workspaceId: f.target.scope.workspaceId, taskId: first.taskId}});
});
