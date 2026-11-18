import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, readHeadlessContextPackPlanRequest, parseHeadlessBuildPlanProposal,
  serializeHeadlessMutationInput} from "../../../../contracts/headless";
import {createStructuredHeadlessPlanReviewRepository} from "../createStructuredHeadlessPlanReviewRepository";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {readStructuredOwnedDatasetPlanTask} from "../../ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {inspectStructuredContextPlanTask, reserveStructuredContextPlanTask, issueStructuredContextPlanTask,
  acceptStructuredContextPlanTask, recordStructuredContextTaskNotStarted, readStructuredOwnedContextPlanTask, readStructuredOwnedContextPlanTaskByPlan,
  readStructuredPresentableContextPlanTask, readStructuredOwnedContextPlanTaskSourceDigest,
  readStructuredContextPlanTaskLineage,
  type ContextPlanTaskEffect} from "../createStructuredHeadlessContextPlanTaskStore";

function fixture() {
  const root = createInMemoryStructuredDocumentStore();
  const organizationId = createOrganizationId("organization.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const decoded = readHeadlessContextPackPlanRequest({version: "aisb-headless-v1", operation: "context.generate-pack", input: {
    hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), name: "Support reference", sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 3}],
    settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]}}}, host);
  assert.ok(decoded.ok);
  const target = {hostIncarnationId: host, fingerprint: "a".repeat(64),
    scope: {organizationId, workspaceId, principalId: "principal.synthetic", registeredClientId: randomUUID()}};
  const effect: ContextPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 2, step: 1, request: decoded.request};
  const owner = root.forOrganization(organizationId), sourceDigest = "b".repeat(64);
  const transaction = <T>(work: (partition: typeof owner) => Promise<T>, fence: () => void = () => {}) =>
    root.runInOwnedTransaction!(part => work(part.forOrganization(organizationId)), fence);
  return {root, owner, target, effect, sourceDigest, transaction};
}

test("private build lineage requires accepted exact ownership and both intact point indexes", async () => {
  const f = fixture(), first = await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.ok("taskId" in first);
  const read = (owner = f.owner, scope = f.target.scope, host = f.target.hostIncarnationId) =>
    readStructuredContextPlanTaskLineage(owner, scope, host, first.taskId);
  assert.equal(await read(), undefined);
  assert.ok(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
  assert.equal(await read(), undefined, "Issued work is not adopted as accepted ancestry.");
  assert.ok(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 3)));
  assert.deepEqual(await read(), {target: f.target, step: 1, sourceDigest: f.sourceDigest,
    inputDigest: createHash("sha256").update(serializeHeadlessMutationInput(f.effect.request), "utf8").digest("hex")});
  for (const scope of [{...f.target.scope, registeredClientId: randomUUID()}, {...f.target.scope, principalId: "another.actor"},
    {...f.target.scope, organizationId: createOrganizationId("another.organization")},
    {...f.target.scope, workspaceId: createWorkspaceId("another.workspace")}]) assert.equal(await read(f.owner, scope), undefined);
  assert.equal(await read(f.owner, f.target.scope, randomUUID() as typeof f.target.hostIncarnationId), undefined);
  for (const namespace of ["headless/context/pack-plan-task-index", "headless/context/pack-plan-task-plan-index"]) {
    const missing = {...f.owner, async readDocument(selected: string, key: string) {
      return selected === namespace ? undefined : f.owner.readDocument(selected, key);
    }} as typeof f.owner;
    assert.equal(await read(missing), undefined);
    const changed = {...f.owner, async readDocument(selected: string, key: string) {
      const document = await f.owner.readDocument(selected, key);
      return document && selected === namespace ? {...document, value: {...document.value as object, identityDigest: "f".repeat(64)}} : document;
    }} as typeof f.owner;
    assert.equal(await read(changed), undefined);
  }
});

test("new RAG proposals require a closed private witness for every exact model step and never publish it", async () => {
  const at = "2026-11-18T00:00:00.000Z";
  const model = {modelRecordId: "model.synthetic", modelUpdatedAt: at, modelId: "synthetic/embedding", recordDigest: "sha256:" + "e".repeat(64)};
  const variants = [undefined, [], [{step: 0, model}], [{step: 1, model: {...model, modelRecordId: "model.other"}}],
    [{step: 1, model: {...model, modelUpdatedAt: "2026-11-18T00:00:01.000Z"}}],
    [{step: 1, model: {...model, localModelReference: "private/model"}}], [{step: 1, model}, {step: 1, model}], [{step: 1, model}]];
  for (const [index, bindings] of variants.entries()) {
    const f = fixture();
    const proposal = {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.target.scope.workspaceId,
      steps: [{operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Synthetic RAG",
        sources: f.effect.request.input.sources, settings: {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50,
          maximumChunks: 100, textFields: ["text"], modelRecordId: model.modelRecordId, modelUpdatedAt: at,
          device: "cpu", batchSize: 4, sourceChecks: {preset: "recommended", allowedLanguages: ["en"],
            requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true}}}]};
    const plan = parseHeadlessBuildPlanProposal(proposal, f.target.hostIncarnationId, {allowLocalFileSave: false, allowContextRagGeneration: true});
    assert.ok(plan.ok);
    const target = {...f.target, fingerprint: createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex")};
    const reviews = createStructuredHeadlessPlanReviewRepository(f.root, async () => true, () => 1, async () => true,
      false, false, false, false, false, true, bindings === undefined ? undefined : async () => bindings as never);
    const result = await reviews.propose({target, proposal, isCurrent: () => true});
    const expected = index === variants.length - 1;
    assert.equal(result.ok, expected, `binding variant ${index}`);
    const records = await f.owner.listDocuments("headless/system-builder/plan-reviews");
    assert.equal(records.length, expected ? 1 : 0);
    if (result.ok) {
      assert.doesNotMatch(JSON.stringify(result), /contextModels|recordDigest|sha256:eeee/);
      assert.equal((records[0].value as {version: number}).version, 2);
      assert.deepEqual((records[0].value as {contextModels: unknown}).contextModels, bindings);
      const decisions = new HeadlessBuildPlanReviewUseCase(reviews, () => 1);
      const actor = {organizationId: target.scope.organizationId, principalId: target.scope.principalId,
        isCurrent: () => true, canDecide: async () => true};
      assert.equal((await decisions.decide({fingerprint: target.fingerprint, expectedRevision: 1,
        decision: {kind: "approve", mode: "whole-plan"}}, target.hostIncarnationId, target.scope,
        {...actor, channel: "app-popup"})).ok, true);
      assert.equal((await decisions.decide({fingerprint: target.fingerprint, expectedRevision: 2,
        decision: {kind: "revoke"}}, target.hostIncarnationId, target.scope,
        {...actor, channel: "authenticated-chat"})).ok, true);
      const after = (await f.owner.listDocuments("headless/system-builder/plan-reviews"))[0].value as {version: number; contextModels: unknown; state: {revision: number}};
      assert.equal(after.version, 2); assert.equal(after.state.revision, 3); assert.deepEqual(after.contextModels, bindings);
    }
  }
});

test("an exact task moves once from reserved to issued to accepted, with a private opaque ID and point-owned replay", async () => {
  const f = fixture();
  const first = await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.equal(first.kind, "new"); assert.ok("taskId" in first);
  assert.notEqual(first.taskId, f.effect.key);
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "unconfirmed"});
  assert.deepEqual(await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 2)), {kind: "unconfirmed"});
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, "c".repeat(64), 2)), false);
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)), true);
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 3)), false);
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, randomUUID(), 3)), false);
  assert.equal(await readStructuredOwnedContextPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 3)), true);
  const reference = {workspaceId: f.target.scope.workspaceId, taskId: first.taskId};
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "accepted", reference});
  assert.deepEqual(await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 4)), {kind: "accepted", reference});
  assert.deepEqual(await readStructuredOwnedContextPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), reference);
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), undefined,
    "A Context receipt cannot become a Data task receipt.");
  const {registeredClientId: _client, ...actor} = f.target.scope;
  assert.deepEqual(await readStructuredPresentableContextPlanTask(f.owner, actor, f.target.hostIncarnationId, first.taskId), reference);
  // Presentation consent is independent, but it must not weaken execution ownership.
  assert.equal(await readStructuredOwnedContextPlanTask(f.owner, actor as never, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredOwnedContextPlanTaskSourceDigest(f.owner, actor as never, f.target.hostIncarnationId, first.taskId), undefined);
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, {...f.effect, approvalRevision: 3}), {kind: "accepted", reference});
  assert.deepEqual(await readStructuredOwnedContextPlanTaskByPlan(f.owner, f.target.scope, f.target.hostIncarnationId,
    f.target.fingerprint, f.effect.step), reference);
  assert.equal(await readStructuredOwnedContextPlanTaskByPlan(f.owner, f.target.scope, f.target.hostIncarnationId,
    f.target.fingerprint, f.effect.step + 1), undefined);
  for (const scope of [{...f.target.scope, registeredClientId: randomUUID()}, {...f.target.scope, principalId: "another.actor"},
    {...f.target.scope, organizationId: createOrganizationId("another.organization")}, {...f.target.scope, workspaceId: createWorkspaceId("another.workspace")}])
    assert.equal(await readStructuredOwnedContextPlanTask(f.owner, scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredOwnedContextPlanTask(f.owner, f.target.scope, randomUUID(), first.taskId), undefined);
  for (const scope of [{...actor, principalId: "another.actor"}, {...actor, workspaceId: createWorkspaceId("another.workspace")},
    {...actor, organizationId: createOrganizationId("another.organization")}])
    assert.equal(await readStructuredPresentableContextPlanTask(f.owner, scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredPresentableContextPlanTask(f.owner, actor, randomUUID(), first.taskId), undefined);
});

test("root-owned rollback leaves no reservation and a lost acknowledgement never supplies a fresh start", async () => {
  const f = fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1), () => {throw new Error("Synthetic rollback.");}));
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "absent"});
  await assert.rejects((async () => {
    await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
    throw new Error("Synthetic lost reservation acknowledgement.");
  })());
  assert.deepEqual(await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 2)), {kind: "unconfirmed"});
  await assert.rejects(reserveStructuredContextPlanTask(f.owner, {...f.effect, key: randomUUID()}, f.sourceDigest, 2));
});

for (const issued of [false, true]) test(`an exact proven non-start after ${issued ? "issue" : "reservation"} is terminal, versioned and never an accepted task`, async () => {
  const f = fixture(), first = await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.ok("taskId" in first);
  if (issued) assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)), true);
  assert.equal(await f.transaction(owner => recordStructuredContextTaskNotStarted(owner, f.effect, randomUUID(), f.sourceDigest, 3)), false);
  assert.equal(await f.transaction(owner => recordStructuredContextTaskNotStarted(owner, f.effect, first.taskId, "f".repeat(64), 3)), false);
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "unconfirmed"}, "Unknown history alone remains unconfirmed.");
  assert.equal(await f.transaction(owner => recordStructuredContextTaskNotStarted(owner, f.effect, first.taskId, f.sourceDigest, 3)), true);
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "not-started"});
  assert.equal(await f.transaction(owner => recordStructuredContextTaskNotStarted(owner, f.effect, first.taskId, f.sourceDigest, 4)), true);
  assert.deepEqual(await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 4)), {kind: "not-started"});
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 4)), false);
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 4)), false);
  assert.equal(await readStructuredOwnedContextPlanTask(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), undefined);
  assert.equal(await readStructuredOwnedContextPlanTaskSourceDigest(f.owner, f.target.scope, f.target.hostIncarnationId, first.taskId), undefined);
  const foreign = {...f.effect, target: {...f.target, scope: {...f.target.scope, registeredClientId: randomUUID()}}};
  await assert.rejects(inspectStructuredContextPlanTask(f.owner, foreign));
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, {...f.effect, approvalRevision: 3}), {kind: "not-started"});
  const records = await f.owner.listDocuments("headless/context/pack-plan-tasks");
  assert.equal((records[0].value as {version: number}).version, 2);
});

test("a proven non-start cannot overwrite an already accepted Context task", async () => {
  const f = fixture(), first = await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.ok("taskId" in first);
  assert.ok(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
  assert.ok(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 3)));
  assert.equal(await f.transaction(owner => recordStructuredContextTaskNotStarted(owner, f.effect, first.taskId, f.sourceDigest, 4)), false);
  assert.equal((await inspectStructuredContextPlanTask(f.owner, f.effect)).kind, "accepted");
});

test("a changed operation identity cannot take another reservation or accepted task", async () => {
  const f = fixture();
  const first = await f.transaction(owner => reserveStructuredContextPlanTask(owner, f.effect, f.sourceDigest, 1));
  assert.ok("taskId" in first);
  const foreign = {...f.effect, target: {...f.target, scope: {...f.target.scope, registeredClientId: randomUUID()}}};
  await assert.rejects(inspectStructuredContextPlanTask(f.owner, foreign));
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, randomUUID(), f.sourceDigest, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredContextPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)), true);
  // Outcome recording is trusted business continuation after issuance; outward
  // access/replay remains the host's separate current-permission boundary.
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 3)), true);
  assert.equal(await f.transaction(owner => acceptStructuredContextPlanTask(owner, f.effect, first.taskId, 4)), true);
  assert.deepEqual(await inspectStructuredContextPlanTask(f.owner, f.effect), {kind: "accepted", reference: {workspaceId: f.target.scope.workspaceId, taskId: first.taskId}});
});
