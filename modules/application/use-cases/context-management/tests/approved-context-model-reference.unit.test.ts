import assert from "node:assert/strict";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import {compileApprovedContextEmbeddingModel, readApprovedContextEmbeddingModelWitness} from "../approved-context-embedding-model";
import {ResolveApprovedContextEmbeddingModelUseCase} from "../resolve-approved-context-embedding-model.use-case";

const context = {workspaceId: createWorkspaceId("workspace.synthetic"), organizationId: createOrganizationId("org.synthetic"), principalId: "principal.synthetic"};
const recorded: ModelInventoryRecord = {workspaceId: context.workspaceId, modelRecordId: "model.synthetic", displayName: "Synthetic embedding",
  source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", modelId: "synthetic/embedding",
  localPath: "private/synthetic/model", createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:01:00.000Z",
  taskTags: ["embeddings"], serializationFormat: "safetensors", sizeBytes: 100,
  metadata: {private: "Synthetic private metadata that must not cross this boundary."}};

test("recorded embedding witnesses bind only selected facts and omit private paths and metadata", () => {
  const witness = compileApprovedContextEmbeddingModel(recorded, context.workspaceId);
  assert.ok(witness); assert.equal(witness.modelId, recorded.modelId);
  assert.match(witness.recordDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(witness).includes("private"), false);
  assert.deepEqual(readApprovedContextEmbeddingModelWitness(witness), witness);
  for (const patch of [{localPath: "private/replacement"}, {sizeBytes: 101}, {updatedAt: "2026-11-18T00:02:00.000Z"}])
    assert.notEqual(compileApprovedContextEmbeddingModel({...recorded, ...patch}, context.workspaceId)?.recordDigest, witness.recordDigest);
  for (const patch of [{workspaceId: createWorkspaceId("foreign")}, {localPath: undefined}, {taskTags: ["text-generation"] as never},
    {artifactForm: "adapter" as const}, {validationStatus: "invalid" as const}, {storageScope: "shared" as const},
    {serializationFormat: "gguf" as never}])
    assert.equal(compileApprovedContextEmbeddingModel({...recorded, ...patch}, context.workspaceId), undefined);
  let getterCalls = 0;
  const getter = Object.defineProperty({...recorded}, "localPath", {get() {getterCalls++; return "private/other";}});
  assert.equal(compileApprovedContextEmbeddingModel(getter, context.workspaceId), undefined); assert.equal(getterCalls, 0);
  assert.equal(readApprovedContextEmbeddingModelWitness({...witness, localModelReference: "private/leak"}), undefined);
});

test("model admission rechecks exact recorded identity and authority around existing-file inspection", async () => {
  const witness = compileApprovedContextEmbeddingModel(recorded, context.workspaceId)!;
  let current = true, model: ModelInventoryRecord | undefined = {...recorded}, reads = 0, inspections = 0;
  let afterInspection = () => {};
  const owner = new ResolveApprovedContextEmbeddingModelUseCase({async readRecordedModel(workspaceId, recordId) {
    reads++; assert.equal(workspaceId, context.workspaceId); assert.equal(recordId, witness.modelRecordId); return model;
  }}, {async inspectExistingDirectory(localPath) {inspections++; assert.equal(localPath, recorded.localPath); afterInspection();
    return {localModelReference: "private/canonical/model"};}});
  const resolve = () => owner.resolveExistingModel(witness, context, async () => current);
  assert.deepEqual(await resolve(), {localModelReference: "private/canonical/model"});
  assert.equal(reads, 2); assert.equal(inspections, 1);
  current = false; assert.equal(await resolve(), undefined); assert.equal(reads, 2); assert.equal(inspections, 1);
  current = true; model = {...recorded, localPath: "private/replacement"};
  assert.equal(await resolve(), undefined); assert.equal(inspections, 1);
  model = {...recorded}; afterInspection = () => {model = {...recorded, sizeBytes: 101};};
  assert.equal(await resolve(), undefined); assert.equal(inspections, 2);
  model = {...recorded}; afterInspection = () => {current = false;};
  assert.equal(await resolve(), undefined); assert.equal(inspections, 3);
  current = true; model = undefined; assert.equal(await resolve(), undefined); assert.equal(inspections, 3);
});

test("model resolution fails closed on unavailable metadata, private failures and invalid actor scope", async () => {
  const witness = compileApprovedContextEmbeddingModel(recorded, context.workspaceId)!;
  let inspections = 0;
  const files = {async inspectExistingDirectory() {inspections++; throw new Error("private/synthetic/path");}};
  assert.equal(await new ResolveApprovedContextEmbeddingModelUseCase({}, files).resolveExistingModel(witness, context, async () => true), undefined);
  const owner = new ResolveApprovedContextEmbeddingModelUseCase({async readRecordedModel() {return recorded;}}, files);
  assert.equal(await owner.resolveExistingModel(witness, {...context, principalId: undefined}, async () => true), undefined);
  assert.equal(inspections, 0);
  assert.equal(await owner.resolveExistingModel(witness, context, async () => true), undefined); assert.equal(inspections, 1);
});

test("model substitution while the final permission check waits cannot reuse the earlier record", async () => {
  const witness = compileApprovedContextEmbeddingModel(recorded, context.workspaceId)!;
  let model = {...recorded}, reads = 0, checks = 0;
  let announceHeld!: () => void, releasePolicy!: () => void;
  const held = new Promise<void>(resolve => {announceHeld = resolve;});
  const released = new Promise<void>(resolve => {releasePolicy = resolve;});
  const owner = new ResolveApprovedContextEmbeddingModelUseCase({async readRecordedModel() {reads++; return model;}},
    {async inspectExistingDirectory() {return {localModelReference: "private/canonical/model"};}});
  const pending = owner.resolveExistingModel(witness, context, async () => {
    if (++checks === 4) {announceHeld(); await released;}
    return true;
  });
  await held;
  model = {...recorded, localPath: "private/replacement", sizeBytes: 101};
  releasePolicy();
  assert.equal(await pending, undefined);
  assert.equal(reads, 2);
});
