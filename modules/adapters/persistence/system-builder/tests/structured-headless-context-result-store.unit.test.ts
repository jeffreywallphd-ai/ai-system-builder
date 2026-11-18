import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, readHeadlessContextPackPlanRequest} from "../../../../contracts/headless";
import {CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, type ContextSavedArtifactReference} from "../../../../contracts/context-management";
import type {PreparedContextResultReview} from "../../../../application/ports/context-management";
import {reserveStructuredContextPlanTask, issueStructuredContextPlanTask, acceptStructuredContextPlanTask,
  type ContextPlanTaskEffect} from "../createStructuredHeadlessContextPlanTaskStore";
import {reserveStructuredContextResultSave, issueStructuredContextResultSave, commitStructuredContextResultSave,
  readCommittedStructuredContextResult, inspectStructuredContextResultSave, type ContextResultSaveEffect}
  from "../createStructuredHeadlessContextResultStore";
import {readStructuredSavedContextMetadata, readStructuredSavedContextOrigin} from "../createStructuredHeadlessContextResultStore";
import {createLocalArtifactCatalogPersistenceAdapter} from "../../../storage/filesystem/artifact-catalog/createLocalArtifactCatalogAdapter";
import {createLocalArtifactStorageBindingAdapter} from "../../../storage/filesystem/artifact-catalog/createLocalArtifactStorageBindingAdapter";
import {composeHeadlessContextResultSave} from "../../../../hosts/shared/composition/headlessContextResults";

async function fixture(accepted = true) {
  const root = createInMemoryStructuredDocumentStore(), rootDirectory = process.cwd();
  const organizationId = createOrganizationId("org.context-save"), workspaceId = createWorkspaceId("workspace.context-save");
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const scope = {organizationId, workspaceId, principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const target = {hostIncarnationId: host, fingerprint: "a".repeat(64), scope};
  const parsed = readHeadlessContextPackPlanRequest({version: "aisb-headless-v1", operation: "context.generate-pack", input: {
    hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), name: "Synthetic context",
    sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 3}],
    settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500, overlapCharacters: 50,
      maximumChunks: 100, textFields: ["text"]}}}, host);
  assert.ok(parsed.ok);
  const taskEffect: ContextPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 2, step: 1, request: parsed.request};
  const tx = <T>(work: (owner: StructuredDocumentStore) => Promise<T>, beforeCommit = () => {}) =>
    root.runInOwnedTransaction!(owner => work(owner.forOrganization(organizationId)), beforeCommit);
  const sourceDigest = "b".repeat(64);
  const reserved = await tx(owner => reserveStructuredContextPlanTask(owner, taskEffect, sourceDigest, 1));
  assert.equal(reserved.kind, "new"); assert.ok("taskId" in reserved);
  assert.ok(await tx(owner => issueStructuredContextPlanTask(owner, taskEffect, reserved.taskId, sourceDigest, 2)));
  if (accepted) assert.ok(await tx(owner => acceptStructuredContextPlanTask(owner, taskEffect, reserved.taskId, 3)));
  const commandDigest = `sha256:${"c".repeat(64)}`, outputDigest = `sha256:${"d".repeat(64)}`, sizeBytes = 3;
  const reportFingerprint = createHash("sha256").update(JSON.stringify({requestId: reserved.taskId, outputDigest, sizeBytes,
    commandDigest, sourceCount: 1, chunkCount: 1})).digest("hex");
  const prepared: PreparedContextResultReview = {review: {reportFingerprint, kind: "markdown-context-pack", sourceCount: 1,
    chunkCount: 1, sizeBytes, requiresExplicitSave: true}, name: "Synthetic context", commandDigest,
    output: {name: "synthetic.context.zip", outputHandle: "synthetic.context.zip", mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, sizeBytes, digest: outputDigest}};
  const effect: ContextResultSaveEffect = {key: randomUUID(), target: {...target, fingerprint: "e".repeat(64)}, approvalRevision: 2,
    step: 1, taskId: reserved.taskId, reportFingerprint};
  const owner = root.forOrganization(organizationId), catalog = createLocalArtifactCatalogPersistenceAdapter({rootDirectory, documents: owner});
  const bindings = createLocalArtifactStorageBindingAdapter({rootDirectory, documents: owner});
  const candidate = (saveId: string): ContextSavedArtifactReference => {
    const key = `workspaces/${workspaceId}/artifacts/context/${saveId.replace(/-/g, "")}`;
    return {artifactId: key, storageKey: key, kind: "markdown-context-pack", name: prepared.name, mediaType: prepared.output.mediaType,
      sizeBytes: prepared.output.sizeBytes, digest: prepared.output.digest};
  };
  async function reserve() {const result = await tx(owner => reserveStructuredContextResultSave(owner, effect, prepared, sourceDigest, 4));
    assert.equal(result.kind, "new"); assert.ok("saveId" in result); return result.saveId;}
  async function issue(saveId: string) {assert.ok(await tx(owner => issueStructuredContextResultSave(owner, effect, saveId, sourceDigest, 5)));}
  return {root, rootDirectory, owner, scope, target, taskEffect, effect, sourceDigest, prepared, tx, reserve, issue, candidate, catalog, bindings};
}

test("Context result commits catalog, primary binding and exact causal receipt together and replays without adoption", async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId);
  assert.deepEqual(await inspectStructuredContextResultSave(f.owner, f.rootDirectory, f.effect), {kind: "unconfirmed"});
  assert.equal((await f.catalog.readArtifactCatalogRecord({workspaceId: f.scope.workspaceId, storageKey: candidate.storageKey}, f.scope)).ok, false);
  await f.issue(saveId);
  assert.equal(await f.tx(owner => issueStructuredContextResultSave(owner, f.effect, saveId, f.sourceDigest, 6)), false);
  const committed = await f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6));
  assert.deepEqual(committed, {contextId: saveId, artifact: candidate, created: true});
  assert.deepEqual(await readCommittedStructuredContextResult(f.owner, f.rootDirectory, f.effect), {contextId: saveId, artifact: candidate});
  assert.deepEqual(await f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 7)),
    {contextId: saveId, artifact: candidate, created: false});
  const rebound = {...f.effect, approvalRevision: 3};
  assert.deepEqual(await readCommittedStructuredContextResult(f.owner, f.rootDirectory, rebound), {contextId: saveId, artifact: candidate});
});

test("Context result reserve, issue, commit and replay survive database-reordered persisted fields", async () => {
  const f = await fixture();
  function reordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reordered);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => b.localeCompare(a)).map(([key, entry]) => [key, reordered(entry)]));
  }
  // A JSONB-like read projection, not a claim of physical PostgreSQL coverage.
  const jsonb = (owner: StructuredDocumentStore): StructuredDocumentStore => ({...owner,
    async readDocument<T>(namespace: string, key: string) {
      const document = await owner.readDocument<T>(namespace, key);
      return document ? {...document, value: reordered(document.value) as T} : undefined;
    },
  });
  const reserved = await f.tx(owner => reserveStructuredContextResultSave(jsonb(owner), f.effect, f.prepared, f.sourceDigest, 4));
  assert.equal(reserved.kind, "new"); assert.ok("saveId" in reserved);
  const saveId = reserved.saveId, candidate = f.candidate(saveId);
  assert.equal(await f.tx(owner => issueStructuredContextResultSave(jsonb(owner), f.effect, saveId, f.sourceDigest, 5)), true);
  assert.deepEqual(await f.tx(owner => commitStructuredContextResultSave(jsonb(owner), f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6)),
    {contextId: saveId, artifact: candidate, created: true});
  assert.deepEqual(await readCommittedStructuredContextResult(jsonb(f.owner), f.rootDirectory, f.effect), {contextId: saveId, artifact: candidate});
  assert.deepEqual(await f.tx(owner => commitStructuredContextResultSave(jsonb(owner), f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 7)),
    {contextId: saveId, artifact: candidate, created: false});
});

test("Context result cannot reserve an unaccepted task or a foreign client and cannot change the verified review", async () => {
  const unaccepted = await fixture(false);
  await assert.rejects(unaccepted.reserve);
  const f = await fixture();
  const foreign = {...f.effect, target: {...f.effect.target, scope: {...f.scope, registeredClientId: randomUUID()}}};
  await assert.rejects(f.tx(owner => reserveStructuredContextResultSave(owner, foreign, f.prepared, f.sourceDigest, 4)));
  for (const patch of [{output: {...f.prepared.output, digest: `sha256:${"f".repeat(64)}`}},
    {review: {...f.prepared.review, chunkCount: 2}}, {commandDigest: `sha256:${"f".repeat(64)}`}])
    await assert.rejects(f.tx(owner => reserveStructuredContextResultSave(owner, f.effect, {...f.prepared, ...patch}, f.sourceDigest, 4)));
  await assert.rejects(f.tx(owner => reserveStructuredContextResultSave(owner, f.effect, f.prepared, "f".repeat(64), 4)));
  await assert.rejects(reserveStructuredContextResultSave(f.root, f.effect, f.prepared, f.sourceDigest, 4));
});

test("Context result permits only one issued save per accepted task, even across two separately reserved effects", async () => {
  const f = await fixture(), first = await f.reserve();
  const other = {...f.effect, key: randomUUID(), target: {...f.target, fingerprint: "f".repeat(64)}};
  const second = await f.tx(owner => reserveStructuredContextResultSave(owner, other, f.prepared, f.sourceDigest, 4));
  assert.equal(second.kind, "new"); assert.ok("saveId" in second);
  await f.issue(first);
  assert.equal(await f.tx(owner => issueStructuredContextResultSave(owner, other, second.saveId, f.sourceDigest, 5)), false);
});

test("Context metadata rollback removes catalog and binding together without deleting or manufacturing a receipt", async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId); await f.issue(saveId);
  await assert.rejects(f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6),
    () => {throw new Error("Synthetic precommit authority loss");}));
  assert.equal((await f.catalog.readArtifactCatalogRecord({workspaceId: f.scope.workspaceId, storageKey: candidate.storageKey}, f.scope)).ok, false);
  const bindings = await f.bindings.readArtifactStorageBindings({workspaceId: f.scope.workspaceId, artifactId: candidate.artifactId}, f.scope);
  assert.ok(bindings.ok); assert.deepEqual(bindings.value.bindings, []);
  assert.equal(await readCommittedStructuredContextResult(f.owner, f.rootDirectory, f.effect), undefined);
  assert.equal(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId), undefined);
  assert.deepEqual(await inspectStructuredContextResultSave(f.owner, f.rootDirectory, f.effect), {kind: "unconfirmed"});
});

for (const collision of ["catalog", "binding", "saved-index"] as const) test(`ordinary ${collision} metadata is not adopted by an approved Context save`, async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId); await f.issue(saveId);
  if (collision === "catalog") assert.ok((await f.catalog.createArtifactCatalogRecordIfAbsent({record: {workspaceId: f.scope.workspaceId,
    storageKey: candidate.storageKey, artifactFamily: "binary", mediaType: candidate.mediaType, sizeBytes: 3}}, f.scope)).ok);
  else if (collision === "binding") assert.ok((await f.bindings.createArtifactStorageBindingIfAbsent({binding: {workspaceId: f.scope.workspaceId, artifactId: candidate.artifactId,
    role: "primary", backing: {kind: "artifact-object", provider: "local-filesystem", locator: candidate.storageKey}}}, f.scope)).ok);
  else await f.owner.writeDocument("headless/context/saved-contexts", `${f.scope.workspaceId}/${saveId}`,
    {effectKey: randomUUID(), identityDigest: "f".repeat(64)}, {expectedRevision: 0});
  await assert.rejects(f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6)));
  assert.equal(await readCommittedStructuredContextResult(f.owner, f.rootDirectory, f.effect), undefined);
  if (collision !== "catalog") assert.equal((await f.catalog.readArtifactCatalogRecord({workspaceId: f.scope.workspaceId, storageKey: candidate.storageKey}, f.scope)).ok, false);
});

test("saved Context index exposes only committed finite workspace metadata with no original actor or storage keys", async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId);
  assert.equal(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId), undefined);
  await f.issue(saveId);
  assert.equal(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId), undefined);
  await f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6));
  assert.deepEqual(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId), {
    reference: {workspaceId: f.scope.workspaceId, contextId: saveId, taskId: f.effect.taskId,
      kind: "markdown-context-pack", artifactDigest: candidate.digest},
    name: f.prepared.name, sizeBytes: 3, sourceCount: 1, chunkCount: 1, byteAvailability: "not-checked",
  });
  assert.equal((await readStructuredSavedContextOrigin(f.owner, f.rootDirectory, f.scope.workspaceId, saveId))?.effect.key, f.effect.key);
  assert.equal(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, "workspace.foreign", saveId), undefined);
  assert.equal(await readStructuredSavedContextMetadata(f.root.forOrganization(createOrganizationId("org.foreign")),
    f.rootDirectory, f.scope.workspaceId, saveId), undefined);
  assert.equal(await readStructuredSavedContextMetadata(f.root, f.rootDirectory, f.scope.workspaceId, saveId), undefined);
});

test("saved Context pointer corruption and missing underlying bindings cannot assert saved availability", async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId); await f.issue(saveId);
  await f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6));
  const key = `${f.scope.workspaceId}/${saveId}`, namespace = "headless/context/saved-contexts";
  const index = await f.owner.readDocument(namespace, key); assert.ok(index);
  for (const value of [{...(index.value as object), identityDigest: "f".repeat(64)},
    {...(index.value as object), effectKey: randomUUID()}, {...(index.value as object), path: "private"}]) {
    const corrupt: StructuredDocumentStore = {...f.owner, async readDocument<T>(name: string, selected: string) {
      return name === namespace && selected === key ? {...index, value: value as T} : f.owner.readDocument<T>(name, selected);
    }};
    await assert.rejects(readStructuredSavedContextMetadata(corrupt, f.rootDirectory, f.scope.workspaceId, saveId));
    await assert.rejects(readCommittedStructuredContextResult(corrupt, f.rootDirectory, f.effect));
  }
  assert.ok((await f.bindings.deleteArtifactStorageBindings({workspaceId: f.scope.workspaceId, artifactId: candidate.artifactId}, f.scope)).ok);
  await assert.rejects(readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId));
});

test("legacy private save receipts remain replayable without creating a public saved Context index", async () => {
  const f = await fixture();
  // Simulate the former writer on an isolated metadata store. No application
  // adoption or revision rewriting of an already committed historical row.
  const legacy = (owner: StructuredDocumentStore): StructuredDocumentStore => ({...owner,
    async writeDocument<T>(namespace: string, key: string, value: T, options) {
      return owner.writeDocument(namespace, key, namespace === "headless/context/result-saves" ? {...value, version: 1} : value, options);
    },
  });
  const reserved = await f.tx(owner => reserveStructuredContextResultSave(legacy(owner), f.effect, f.prepared, f.sourceDigest, 4));
  assert.equal(reserved.kind, "new"); assert.ok("saveId" in reserved);
  const saveId = reserved.saveId, candidate = f.candidate(saveId);
  assert.equal(await f.tx(owner => issueStructuredContextResultSave(legacy(owner), f.effect, saveId, f.sourceDigest, 5)), true);
  assert.deepEqual(await f.tx(owner => commitStructuredContextResultSave(legacy(owner), f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6)),
    {contextId: saveId, artifact: candidate, created: true});
  assert.deepEqual(await readCommittedStructuredContextResult(f.owner, f.rootDirectory, f.effect), {contextId: saveId, artifact: candidate});
  assert.equal(await readStructuredSavedContextMetadata(f.owner, f.rootDirectory, f.scope.workspaceId, saveId), undefined);
  assert.equal(await f.owner.readDocument("headless/context/saved-contexts", `${f.scope.workspaceId}/${saveId}`), undefined);
});

test("Context commit rejects changed candidates and exact receipt reads detect deleted binding metadata", async () => {
  const f = await fixture(), saveId = await f.reserve(), candidate = f.candidate(saveId); await f.issue(saveId);
  for (const patch of [{storageKey: "foreign/key"}, {sizeBytes: 4}, {digest: `sha256:${"f".repeat(64)}`}, {name: "Changed"}, {extra: true}])
    await assert.rejects(f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest,
      {...candidate, ...patch}, 6)));
  await f.tx(owner => commitStructuredContextResultSave(owner, f.rootDirectory, f.effect, saveId, f.sourceDigest, candidate, 6));
  assert.ok((await f.bindings.deleteArtifactStorageBindings({workspaceId: f.scope.workspaceId, artifactId: candidate.artifactId}, f.scope)).ok);
  await assert.rejects(readCommittedStructuredContextResult(f.owner, f.rootDirectory, f.effect));
});

test("private shared Context save composition rechecks exact current authority and review around metadata effects", async () => {
  const f = await fixture();
  let allowed = true, prepared = f.prepared, checks = 0;
  const options = {documents: f.root, rootDirectory: f.rootDirectory, effect: f.effect, processor: {peekAdmittedContextSaveInputs: () => prepared},
    isCurrent: () => allowed, now: () => 10, async authorizeExactSave(owner: StructuredDocumentStore, effect: ContextResultSaveEffect) {
      checks++; assert.equal(owner.organizationId, undefined); assert.equal(owner.runInOwnedTransaction, undefined);
      assert.deepEqual(effect, f.effect); return allowed;
    }};
  const owner = composeHeadlessContextResultSave(options), reserved = await owner.reserve();
  assert.ok(reserved && reserved.kind === "new");
  prepared = {...prepared, name: "Changed review"};
  assert.equal(await owner.issue(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest), "denied");
  prepared = f.prepared;
  assert.equal(await owner.issue(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest), "issued");
  allowed = false;
  await assert.rejects(owner.commit(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest, f.candidate(reserved.saveId)));
  assert.equal(await owner.readReceipt(), undefined);
  allowed = true;
  const saved = await owner.commit(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest, f.candidate(reserved.saveId));
  assert.equal(saved.created, true); assert.equal(saved.contextId, reserved.saveId);
  assert.ok(checks >= 5);
  // Saved receipt replay no longer requires a live runtime review.
  prepared = undefined as never;
  assert.equal((await owner.inspect())?.kind, "committed");
});

test("Context shared composition confirms one exact lost commit acknowledgement with a read only reconciliation", async () => {
  const f = await fixture();
  let loseReply = false, transactionCalls = 0;
  const documents: StructuredDocumentStore = {...f.root, async runInOwnedTransaction(work, beforeCommit) {
    transactionCalls++; const result = await f.root.runInOwnedTransaction!(work, beforeCommit);
    if (loseReply) {loseReply = false; throw new Error("Synthetic lost metadata reply");}
    return result;
  }};
  const owner = composeHeadlessContextResultSave({documents, rootDirectory: f.rootDirectory, effect: f.effect,
    processor: {peekAdmittedContextSaveInputs: () => f.prepared}, isCurrent: () => true, authorizeExactSave: async () => true, now: () => 10});
  const reserved = await owner.reserve(); assert.ok(reserved && reserved.kind === "new");
  assert.equal(await owner.issue(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest), "issued");
  loseReply = true; const before = transactionCalls;
  const saved = await owner.commit(reserved.saveId, reserved.sourceDigest, reserved.reviewDigest, f.candidate(reserved.saveId));
  assert.equal(saved.created, false); assert.equal(transactionCalls - before, 2);
  assert.equal((await owner.inspect())?.kind, "committed");
});
