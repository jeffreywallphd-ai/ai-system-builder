import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, realpath, rm, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {createLocalTrainingModelFilesAdapter} from "../../../../adapters/model/local/createLocalTrainingModelFilesAdapter";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId} from "../../../../contracts/headless";
import {organizationId, workspaceId, principalId, createdAt, version as datasetVersion} from "../../dataset-version/tests/headless-dataset-metadata.fixture";
import {ReadHeadlessModelMetadataUseCase} from "../headless-model-metadata.use-case";
import {ReadHeadlessModelTrainingModelUseCase} from "../headless-model-training-model.use-case";
import {InspectHeadlessLocalTrainingModelUseCase} from "../headless-model-training-local-files.use-case";

async function fixture(t: TestContext, storage: "Core" | "SQLite" = "Core") {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "mt-")));
  const identity = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {await database?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});});
  const documents = (database?.documents ?? createInMemoryStructuredDocumentStore()).forOrganization(organizationId);
  const localPath = path.join(directory, "model"); await mkdir(localPath);
  for (const name of ["config.json", "tokenizer.json", "model.safetensors"]) await writeFile(path.join(localPath, name), "synthetic layout presence only");
  const registry = createLocalModelRegistryAdapter({documents, rootDirectory: directory, filePath: path.join(directory, "unused.json"), discovery: {enabled: false}, now: () => createdAt});
  await registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Private model label",
    provider: "huggingface", source: "local", modelId: "fixture/model", localPath, artifactForm: "full-model", inferenceMode: "causal", serializationFormat: "safetensors"});
  const metadata = new ReadHeadlessModelMetadataUseCase({organizationId, models: {readRecordedModel: registry.readRecordedModel!.bind(registry),
    async listModels() {assert.fail("No discovery.");}}});
  const model = new ReadHeadlessModelTrainingModelUseCase({organizationId, metadata, models: registry});
  const adapter = createLocalTrainingModelFilesAdapter({allowedRootDirectories: [localPath]});
  const state = {current: true, allowed: true, inspections: 0, onInspection: undefined as ((count: number) => Promise<void>) | undefined};
  const files = {async inspectExistingDirectory(value: string) {
    assert.equal(this, files); state.inspections++; await state.onInspection?.(state.inspections);
    return adapter.inspectExistingDirectory(value);
  }};
  const context = {organizationId, workspaceId, principalId};
  const hostIncarnationId = randomUUID(); assert(isHeadlessHostIncarnationId(hostIncarnationId));
  const authority = {hostIncarnationId, clientId: randomUUID(), context,
    isCurrent() {assert.equal(this, authority); return state.current;},
    async stillAllowed() {assert.equal(this, authority); return state.allowed;}};
  const dataset = datasetVersion(1);
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "models.train", input: {hostIncarnationId, workspaceId,
    model: {modelRecordId: "model.synthetic", updatedAt: createdAt}, dataset: {datasetId: dataset.datasetId, versionId: dataset.versionId, versionDigest: dataset.versionDigest},
    idempotencyKey: randomUUID(), name: "synthetic-training", training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, batchSize: 1, maxSequenceLength: 64}}}};
  const dependencies = {organizationId, model, files};
  return {state, registry, files, model, context, authority, request, localPath, dependencies, owner: new InspectHeadlessLocalTrainingModelUseCase(dependencies)};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}: exact saved Model and actual layout produce only private frozen preparation hints`, async t => {
    const f = await fixture(t, storage), result = await f.owner.execute(f.request, f.authority);
    assert(result.ok); assert.equal(f.state.inspections, 2);
    assert.equal(result.prepared.localFiles.localModelReference, f.localPath);
    assert.equal(result.prepared.selection.model.modelRecordId, "model.synthetic");
    assert.equal(result.prepared.verification.localLayout, "observed");
    for (const key of ["modelBytes", "nativeCustody", "runtimeReadiness", "resourceAdmission", "licenseRights"] as const)
      assert.equal(result.prepared.verification[key], "not-checked");
    assert.equal(result.prepared.trainingApprovalRequired, true); assert.equal(result.prepared.resultSaveApprovalRequired, true);
    assert(Object.isFrozen(result.prepared.localFiles)); assert(Object.isFrozen(result.prepared.selection.request));
    assert.equal("started" in result.prepared, false);
  });
  test(`${storage}: missing ModelRead permission refuses before file inspection`, async t => {
    const f = await fixture(t, storage); f.state.allowed = false;
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.inspections, 0);
  });
  test(`${storage}: revocation during inspection withholds every private path`, async t => {
    const f = await fixture(t, storage); f.state.onInspection = async () => {f.state.allowed = false;};
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.inspections, 1);
  });
  test(`${storage}: saved Model replacement during inspection cannot be adopted`, async t => {
    const f = await fixture(t, storage); f.state.onInspection = async count => {
      // Ordinary record updates deliberately cannot change storage identity.
      // Re-registration is a real replacement at the same fixed timestamp.
      if (count === 1) await f.registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Replacement",
        source: "local", provider: "huggingface", modelId: "fixture/model", localPath: path.join(f.localPath, "other"),
        artifactForm: "full-model", inferenceMode: "causal", serializationFormat: "safetensors"});
    };
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"});
  });
  test(`${storage}: removed files cannot retain a successful earlier observation`, async t => {
    const f = await fixture(t, storage); f.state.onInspection = async count => {if (count === 2) await unlink(path.join(f.localPath, "model.safetensors"));};
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"});
  });
  test(`${storage}: replacement during the final inspection requires a fresh final Model read`, async t => {
    const f = await fixture(t); f.state.onInspection = async count => {
      if (count === 2) await f.registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Late replacement",
        source: "local", provider: "huggingface", modelId: "fixture/model", localPath: path.join(f.localPath, "other"),
        artifactForm: "full-model", inferenceMode: "causal", serializationFormat: "safetensors"});
    };
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"});
  });
}

for (const changed of ["clientId", "context", "hostIncarnationId", "isCurrent", "stillAllowed", "principalId"] as const)
  test(`changing original ${changed} during file IO cannot replace the original actor`, async t => {
    const f = await fixture(t); f.state.onInspection = async () => {
      if (changed === "principalId") f.context.principalId = "other";
      else if (changed === "context") f.authority.context = {...f.context};
      else if (changed === "clientId") f.authority.clientId = randomUUID();
      else if (changed === "hostIncarnationId") f.authority.hostIncarnationId = randomUUID() as typeof f.authority.hostIncarnationId;
      else if (changed === "isCurrent") f.authority.isCurrent = () => true;
      else f.authority.stillAllowed = async () => true;
    };
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.inspections, 1);
  });

test("captured methods retain their real owners despite later property replacement", async t => {
  const f = await fixture(t); f.state.onInspection = async () => {
    f.files.inspectExistingDirectory = async () => assert.fail("A replacement method cannot run.");
    f.model.execute = async () => assert.fail("A replacement model reader cannot run.");
  };
  const result = await f.owner.execute(f.request, f.authority); assert(result.ok); assert.equal(f.state.inspections, 2);
});

test("active dependency methods and authority getters are refused without invocation", async t => {
  const f = await fixture(t); let invoked = 0;
  const files = Object.defineProperty({}, "inspectExistingDirectory", {get() {invoked++; throw Error("private");}});
  const owner = new InspectHeadlessLocalTrainingModelUseCase({...f.dependencies, files: files as never});
  assert.deepEqual(await owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  const authority = Object.defineProperty({...f.authority}, "clientId", {get() {invoked++; throw Error("private");}});
  assert.deepEqual(await f.owner.execute(f.request, authority), {ok: false, code: "headless.forbidden"});
  assert.equal(invoked, 0);
});

test("a malformed request or stale selected revision cannot trigger file inspection", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.owner.execute({...f.request, operation: "other"}, f.authority), {ok: false, code: "headless.invalid-request"});
  const stale = structuredClone(f.request); stale.input.model.updatedAt = "2026-11-20T00:00:00.000Z";
  assert.deepEqual(await f.owner.execute(stale, f.authority), {ok: false, code: "headless.stale"});
  assert.equal(f.state.inspections, 0);
});

test("final policy withdrawal cannot publish an earlier successful observation", async t => {
  const f = await fixture(t); f.state.onInspection = async count => {if (count === 2) f.state.current = false;};
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(f.state.inspections, 2);
});

test("supplier errors and active observation fields do not expose private values", async t => {
  const f = await fixture(t); let getters = 0;
  const failures = [async () => {throw new Error("synthetic-private-path");},
    async () => ({localModelReference: f.localPath, layoutProfile: "wrong"}),
    async () => Object.defineProperty({layoutProfile: "unsharded-training-safetensors-layout-v1"}, "localModelReference",
      {enumerable: true, get() {getters++; throw Error("private");}})];
  for (const inspect of failures) {
    const owner = new InspectHeadlessLocalTrainingModelUseCase({...f.dependencies, files: {inspectExistingDirectory: inspect as never}});
    assert.deepEqual(await owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  }
  assert.equal(getters, 0);
});

test("a native Promise from a synchronous lifetime check cannot supply a grant", async t => {
  const f = await fixture(t);
  f.authority.isCurrent = (() => Promise.reject(new Error("synthetic-private"))) as never;
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(f.state.inspections, 0);
  await new Promise(resolve => setImmediate(resolve));
});

test("an active model-reader response is rejected before inspecting its data properties", async t => {
  const f = await fixture(t); let reads = 0;
  const getter = Object.defineProperty({}, "ok", {enumerable: true, get() {reads++; return true;}});
  // Promise resolution probes `then` inside the test provider before the
  // response reaches the use case. Count data inspection, not that protocol.
  const proxy = new Proxy({}, {get(_target, key) {if (key === "then") return undefined; reads++; throw Error("private");}, getPrototypeOf() {reads++; throw Error("private");}});
  for (const value of [getter, proxy]) {
    const model = {async execute() {return value as never;}};
    const owner = new InspectHeadlessLocalTrainingModelUseCase({...f.dependencies, model});
    assert.deepEqual(await owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  }
  assert.equal(reads, 0); assert.equal(f.state.inspections, 0);
});

test("a held first policy check cannot select replacement Model or file methods", async t => {
  const f = await fixture(t); let policyCalls = 0, replacements = 0;
  let release: (value: boolean) => void = () => assert.fail("The first policy must be suspended.");
  f.authority.stillAllowed = () => ++policyCalls === 1 ? new Promise<boolean>(resolve => {release = resolve;}) : Promise.resolve(true);
  const pending = f.owner.execute(f.request, f.authority);
  f.model.execute = async () => {replacements++; return {ok: false, code: "headless.unavailable"};};
  f.files.inspectExistingDirectory = async () => {replacements++; return undefined;};
  release(true);
  const result = await pending; assert(result.ok); assert.equal(replacements, 0); assert.equal(f.state.inspections, 2);
});

test("awaited policy handoffs cannot enter ports or publish after retirement", async t => {
  const f = await fixture(t), selected = await f.model.execute(f.request, f.authority); assert(selected.ok);
  async function run(retireAtCheck = 0, retireAfterPolicy = 0) {
    let live = true, checks = 0, policies = 0, queued = false;
    const calls: {port: string; current: boolean}[] = [];
    const authority = {...f.authority,
      isCurrent() {
        checks++;
        if (!queued && (checks === retireAtCheck || retireAfterPolicy > 0 && policies === retireAfterPolicy)) {
          queued = true; queueMicrotask(() => {live = false;});
        }
        return live;
      },
      async stillAllowed() {policies++; return true;}};
    const model = {async execute() {calls.push({port: "model", current: live}); return selected;}};
    const files = {async inspectExistingDirectory() {calls.push({port: "files", current: live});
      return {localModelReference: f.localPath, layoutProfile: "unsharded-training-safetensors-layout-v1" as const};}};
    const result = await new InspectHeadlessLocalTrainingModelUseCase({organizationId, model, files}).execute(f.request, authority);
    return {result, calls, policies, live};
  }
  const control = await run(); assert(control.result.ok); assert(control.policies >= 5); assert(control.calls.length >= 4);
  for (const point of [3, 5, 7, 9, 11]) {
    const observed = await run(point);
    assert.equal(observed.live, false); assert(observed.calls.every(row => row.current), `A port entered after retirement at check ${point}.`);
    assert.deepEqual(observed.result, {ok: false, code: "headless.forbidden"});
  }
  // Targets the last policy handoff dynamically; adding earlier checks cannot
  // hide a missing caller fence immediately before publication.
  const publication = await run(0, control.policies);
  assert.equal(publication.live, false); assert(publication.calls.every(row => row.current));
  assert.deepEqual(publication.result, {ok: false, code: "headless.forbidden"});
});

test("a mutable file reply is copied before a later policy callback can retarget it", async t => {
  const f = await fixture(t); let returned = false;
  const reply = {localModelReference: f.localPath, layoutProfile: "unsharded-training-safetensors-layout-v1" as const};
  f.files.inspectExistingDirectory = async () => {returned = true; return reply;};
  f.authority.stillAllowed = async () => {if (returned) reply.localModelReference = path.join(f.localPath, "other"); return true;};
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"});
});

for (const key of ["isCurrent", "stillAllowed"] as const)
  test(`the original ${key} function is invoked without reading an overridden call property`, async t => {
    const f = await fixture(t); let getters = 0;
    if (key === "isCurrent") f.state.current = false; else f.state.allowed = false;
    Object.defineProperty(f.authority[key], "call", {get() {getters++; return () => true;}});
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(getters, 0); assert.equal(f.state.inspections, 0);
  });
