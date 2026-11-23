import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredHeadlessPlanReviewRepository} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareStructuredHeadlessPlanStepWithTraining, type CompileApprovedTrainingMetadata} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {PrepareHeadlessModelTrainingPlanUseCase} from "../../../../application/use-cases/model/headless-model-training-plan.use-case";
import {ReadHeadlessModelTrainingModelUseCase} from "../../../../application/use-cases/model/headless-model-training-model.use-case";
import {ReadHeadlessModelTrainingDatasetUseCase} from "../../../../application/use-cases/model/headless-model-training-dataset.use-case";
import {ReadHeadlessModelMetadataUseCase} from "../../../../application/use-cases/model/headless-model-metadata.use-case";
import {TrainModelUseCase} from "../../../../application/use-cases/model/train-model.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import type {ApprovedLocalTrainingDefinition, ApprovedLocalTrainingStagedInput, ApprovedLocalTrainingControl} from "../../../../application/ports/model";
import type {ArtifactObjectStoragePort} from "../../../../application/ports/storage";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, projectHeadlessDatasetVersion,
  readHeadlessModelTrainingInputsValue, type HeadlessModelTrainingInputsValue, type HeadlessModelTrainingPlanRequest} from "../../../../contracts/headless";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import {runPreparedHeadlessModelTraining, type RetainedHeadlessTrainingTask} from "../headlessModelTrainingExecution";
import {createOriginalHeadlessTrainingTaskOwner, type OriginalTrainingRunOptions, type OriginalTrainingTaskQuery} from "../headlessModelTrainingTasks";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = (value: Uint8Array | string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const encode = (value: string) => new TextEncoder().encode(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Prepared = NonNullable<Awaited<ReturnType<CompileApprovedTrainingMetadata>>>;
type RunOptions = Parameters<typeof runPreparedHeadlessModelTraining>[0];
const originalTemporary = {TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR};
const fixtureParent = tmpdir();

async function fixture(t: TestContext, engine: "Core" | "SQLite" = "Core", options: {port?: false; legacy?: boolean; split?: false} = {}) {
  const boundary = await realpath(fixtureParent), directory = await realpath(await mkdtemp(join(boundary, "tbridge-")));
  const identity = await lstat(directory, {bigint: true}), previous = originalTemporary;
  process.env.TEMP = directory; process.env.TMP = directory; process.env.TMPDIR = directory;
  const database = engine === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  const base = database?.documents ?? createInMemoryStructuredDocumentStore();
  const state = {current: true, host: true, allowed: true, business: true, now: 1000, gets: 0, resolves: 0,
    modelReads: 0, datasetReads: 0, starts: 0, creates: 0, prepares: 0, retained: 0, reads: 0, cancels: 0,
    status: "queued" as RuntimeTaskRecord["status"], issued: 0, retain: true, compiles: 0,
    onPolicy: undefined as (() => Promise<void>) | undefined,
    onPrepare: undefined as (() => Promise<void>) | undefined,
    onStart: undefined as (() => Promise<void>) | undefined,
    onPowerStart: undefined as (() => Promise<void>) | undefined,
    onRead: undefined as (() => Promise<void>) | undefined,
    onCancel: undefined as (() => Promise<void>) | undefined,
    progress: undefined as RuntimeTaskRecord["progress"],
    afterCommit: undefined as ((value: unknown) => Promise<void>) | undefined,
    dropWhen: undefined as ((value: unknown) => boolean) | undefined,
    transformModel: undefined as ((value: unknown) => unknown) | undefined,
    transformDataset: undefined as ((value: unknown) => unknown) | undefined};
  const releases: (() => void)[] = [], pending = new Set<Promise<unknown>>();
  const tracked = <T,>(promise: Promise<T>) => {pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;};
  const reconciler = new OwnedTaskReconcilerService({setTimeout: (() => ({unref() {}})) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout});
  t.after(async () => {
    reconciler.stopObservation(); for (const release of releases) release(); await Promise.allSettled([...pending]); await database?.close();
    const current = await lstat(directory, {bigint: true}); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(await realpath(directory), directory); assert.equal(dirname(directory), boundary);
    // Every session below is inert: no worker, reader, native handle or model
    // exists. All fake waits have settled before this exclusive fixture cleanup.
    await rm(directory, {recursive: true});
    for (const key of ["TEMP", "TMP", "TMPDIR"] as const) {if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}
  });
  const root = Object.create(base) as StructuredDocumentStore, transaction = base.runInOwnedTransaction!.bind(base);
  Object.defineProperty(root, "runInOwnedTransaction", {value: async <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void) => {
    const value = await transaction(visit, fence); await state.afterCommit?.(value);
    if (state.dropWhen?.(value)) {state.dropWhen = undefined; throw new Error("Synthetic lost committed reply.");} return value;
  }});
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const scope = {organizationId: createOrganizationId("org.training-bridge"), workspaceId: createWorkspaceId("workspace.training-bridge"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const at = "2026-11-23T00:00:00.000Z", modelDirectory = join(directory, "empty-model"); await mkdir(modelDirectory);
  const context = {organizationId: scope.organizationId, principalId: scope.principalId, workspaceId: scope.workspaceId};
  const modelRecord: ModelInventoryRecord = {workspaceId: scope.workspaceId, modelRecordId: "model.synthetic", displayName: "Synthetic base",
    createdAt: at, updatedAt: at, source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface",
    modelId: "fixture/base", localPath: modelDirectory, inferenceMode: "causal", serializationFormat: "safetensors", taskTags: ["chat"]};
  const modelMetadata = new ReadHeadlessModelMetadataUseCase({organizationId: scope.organizationId,
    models: {async listModels() {assert.fail("No model discovery.");}, async readRecordedModel() {return clone(modelRecord);}}});
  const modelOwner = new ReadHeadlessModelTrainingModelUseCase({organizationId: scope.organizationId, metadata: modelMetadata,
    models: {async readRecordedModel() {return clone(modelRecord);}}});
  const content = new Map<string, Uint8Array>();
  for (const role of ["dataset", "train", "validation", "test"]) content.set("saved/" + role + ".jsonl",
    encode(JSON.stringify({instruction: "Synthetic " + role, output: "Synthetic answer"}) + "\n"));
  content.set("saved/recipe.json", encode('{"synthetic":true}'));
  const version = normalizeDatasetVersionRecord({schemaVersion: "1.0", organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64),
    createdAt: at, createdBy: scope.principalId, totalRows: options.split === false ? 1 : 3,
    artifacts: [...(options.split === false ? ["dataset"] : ["dataset", "train", "validation", "test"]).map(role => ({role, artifactKey: "saved/" + role + ".jsonl",
      digest: sha(content.get("saved/" + role + ".jsonl")!), mediaType: "application/jsonl", sizeBytes: content.get("saved/" + role + ".jsonl")!.length, rowCount: 1})),
      {role: "recipe", artifactKey: "saved/recipe.json", digest: sha(content.get("saved/recipe.json")!), mediaType: "application/json", sizeBytes: content.get("saved/recipe.json")!.length}],
    lineage: {sources: [{artifactKey: "source/never-read.csv", digest: "sha256:" + "b".repeat(64), mediaType: "text/csv"}],
      recipe: {artifactKey: "saved/recipe.json", digest: sha(content.get("saved/recipe.json")!), implementationId: "synthetic.prepare", implementationVersion: "1"},
      ...(options.split === false ? {} : {split: {strategy: "random", seed: 0}}), quality: {policyId: "synthetic", policyVersion: "1", policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)}},
    documentation: {name: "Synthetic data", summary: "Feature-only inputs", intendedUses: ["Software test"], limitations: ["No model"], license: "CC0-1.0"}} as unknown as Parameters<typeof normalizeDatasetVersionRecord>[0]);
  const retrieved: string[] = [];
  const datasetOwner = new ReadHeadlessModelTrainingDatasetUseCase({organizationId: scope.organizationId,
    versions: {async execute(query, actor) {assert.deepEqual(actor, context); assert.equal(query.versionId, version.versionId); return clone(version);}},
    artifacts: {retrieveArtifact: (async (query: {key: string}) => {
      retrieved.push(query.key); const value = content.get(query.key); assert.ok(value);
      const artifact = version.artifacts.find(item => item.artifactKey === query.key)!;
      return {ok: true, value: {content: new Uint8Array(value), descriptor: {key: query.key, mediaType: artifact.mediaType, sizeBytes: artifact.sizeBytes}}};
    }) as ArtifactObjectStoragePort["retrieveArtifact"]}});
  const proposal = {hostIncarnationId: host, workspaceId: scope.workspaceId, steps: [{operation: "models.train", idempotencyKey: randomUUID(),
    name: "Private trial", model: {modelRecordId: modelRecord.modelRecordId, updatedAt: at},
    dataset: {datasetId: version.datasetId, versionId: version.versionId, versionDigest: version.versionDigest},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, batchSize: 1, seed: 0}, validation: {enabled: false}}}]};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelTraining: true}); assert.ok(parsed.ok);
  const request = parsed.requests[0]; assert.ok(request.operation === "models.train");
  const initial = await modelMetadata.execute({version: HEADLESS_CONTRACT_VERSION, operation: "models.record", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, modelRecordId: modelRecord.modelRecordId}}, {hostIncarnationId: host, context, isCurrent: () => true, stillAllowed: async () => true});
  assert.ok(initial.ok && initial.operation === "models.record");
  const inputs = readHeadlessModelTrainingInputsValue({workspaceId: scope.workspaceId, model: initial.value.model,
    dataset: {datasetId: version.datasetId, version: projectHeadlessDatasetVersion(version)},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, request.input); assert.ok(inputs);
  const compileValue = async (selected: HeadlessModelTrainingPlanRequest, value: HeadlessModelTrainingInputsValue) => {
    const result = await new PrepareHeadlessModelTrainingPlanUseCase({organizationId: scope.organizationId,
      inputs: {async execute() {return {ok: true, operation: "models.preview-training-inputs", value};}}}).execute(selected,
      {hostIncarnationId: host, context, clientId: scope.registeredClientId, isCurrent: () => state.current, stillAllowed: async () => state.allowed});
    assert.ok(result.ok); return result.prepared;
  };
  const compiled = await compileValue(request, inputs), binding = options.legacy
    ? {step: 1, inputs, proposalDigest: "sha256:" + digest({request, inputs})} : {step: 1, inputs: compiled.inputs, proposalDigest: compiled.proposalDigest};
  const target = {hostIncarnationId: host, scope, fingerprint: digest(parsed.preview)};
  const reviews = createStructuredHeadlessPlanReviewRepository(root, async () => state.allowed, () => state.now, async () => true,
    false, false, false, false, false, false, undefined, false, false, undefined, false, false, {bind: async () => [binding]});
  assert.ok((await reviews.propose({target, proposal, isCurrent: () => state.current})).ok);
  assert.ok((await new HeadlessBuildPlanReviewUseCase(reviews, () => state.now).decide({fingerprint: target.fingerprint, expectedRevision: 1,
    decision: {kind: "approve", mode: "whole-plan"}}, host, scope, {organizationId: scope.organizationId, principalId: scope.principalId,
      channel: "authenticated-chat", isCurrent: () => state.current, canDecide: async () => state.allowed})).ok);
  await root.forOrganization(scope.organizationId).writeDocument("qualification/training-bridge", "inputs", clone(inputs));
  const compile: CompileApprovedTrainingMetadata = async (owner, selected) => {
    state.compiles++; const row = await owner.forOrganization(scope.organizationId).readDocument<HeadlessModelTrainingInputsValue>("qualification/training-bridge", "inputs");
    return row ? compileValue(selected, row.value) : undefined;
  };
  const prepare = async () => {
    const args: Parameters<typeof prepareStructuredHeadlessPlanStepWithTraining> = [root, {target, approvalRevision: 2, step: 1, isCurrent: () => state.current}, async () => state.allowed, () => state.now];
    args[14] = compile; const value = await prepareStructuredHeadlessPlanStepWithTraining(...args); assert.ok(value?.kind === "model-training"); return value;
  };
  let definition: ApprovedLocalTrainingDefinition | undefined, staged: ApprovedLocalTrainingStagedInput | undefined;
  let control: ApprovedLocalTrainingControl | undefined;
  const train = new TrainModelUseCase({taskReconciler: reconciler,
    ...(options.port === false ? {} : {approvedLocalTraining: {createSession(value, originalControl) {
      state.creates++; definition = value; control = originalControl;
      return {requestId: value.requestId, workspaceId: value.workspaceId,
        async prepare() {state.prepares++; await state.onPrepare?.(); return "ready" as const;},
        async start(input, isCurrent) {assert.equal(isCurrent(), true); state.starts++; staged = input; await state.onStart?.();
          return {kind: "accepted" as const, requestId: value.requestId, workspaceId: value.workspaceId, status: "queued" as const};},
        async read() {state.reads++; await state.onRead?.(); return {requestId: value.requestId, workspaceId: value.workspaceId, taskType: TaskType.MODEL_TRAINING, status: state.status, concurrencyClass: "unknown" as const, ...(state.progress ? {progress: state.progress} : {})};},
        async cancel() {state.cancels++; await state.onCancel?.(); state.status = "cancelled"; return {requestId: value.requestId, cancelled: true, status: "cancelled" as const};},
        async settle() {return true;}};
    }}}),
    runtimeTaskRegistry: {async startTask() {assert.fail("No ordinary runtime.");}, async startTaskWithoutInstalling() {assert.fail("No generic installed-only fallback.");},
      async getTaskStatus() {assert.fail("No history discovery.");}, async cancelTask() {assert.fail("No ordinary cancel.");}, async listTasks() {assert.fail("No task list.");}},
    modelRegistry: {async listModels() {assert.fail();}, async getModelRecord() {assert.fail();}, async saveModelReference() {assert.fail();},
      async registerDownloadedModel() {assert.fail();}, async updateModelRecord() {assert.fail();}, async deleteModelRecord() {assert.fail();}, async registerGeneratedModel() {assert.fail("No automatic Save.");}},
    storageBindings: {async readArtifactStorageBindings() {assert.fail("No binding lookup.");}}, storage: {async retrieveArtifact() {assert.fail("Only private copies.");}},
    taskPowerLifecycle: {async startTask() {await state.onPowerStart?.();}, async completeTask() {}}, runtimeCapabilityGuard: {async requireCapabilityReady() {assert.fail("No installation.");}}});
  let retained: RetainedHeadlessTrainingTask | undefined;
  const modelReader = {async execute(...args: Parameters<ReadHeadlessModelTrainingModelUseCase["execute"]>) {
    assert.equal(this, modelReader); state.modelReads++; const reply = await modelOwner.execute(...args);
    return (state.transformModel ? state.transformModel(reply) : reply) as typeof reply;
  }};
  const datasetReader = {async execute(...args: Parameters<ReadHeadlessModelTrainingDatasetUseCase["execute"]>) {
    assert.equal(this, datasetReader); state.datasetReads++; const reply = await datasetOwner.execute(...args);
    return (state.transformDataset ? state.transformDataset(reply) : reply) as typeof reply;
  }};
  const selection: RunOptions["request"] = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step",
    input: {hostIncarnationId: host, workspaceId: scope.workspaceId, fingerprint: target.fingerprint, approvalRevision: 2, step: 1}};
  const makeOptions = async (): Promise<RunOptions> => ({prepared: await prepare(), request: selection, context,
    canUse: async () => {await state.onPolicy?.(); return state.allowed;}, isHostCurrent: () => state.host,
    stillBusinessAllowed: async () => state.business,
    getReaders: async () => {state.gets++; return {model: modelReader, dataset: datasetReader};},
    resolveStart: async () => {state.resolves++; return train.startApprovedLocal.bind(train);},
    retainTask(value) {state.retained++; retained = value; return state.retain;}});
  const run = async (changes: Partial<RunOptions> = {}) => tracked(runPreparedHeadlessModelTraining({...await makeOptions(), ...changes}));
  const gate = () => {let open!: () => void, entered!: () => void; const waiting = new Promise<void>(r => open = r), started = new Promise<void>(r => entered = r);
    releases.push(open); return {started, release: open, async wait() {entered(); await waiting;}};};
  return {state, scope, context, host, root, request, binding, inputs, version, content, retrieved, modelRecord, modelReader, datasetReader,
    train, prepare, makeOptions, run, gate, track: tracked, get retained() {return retained;}, get definition() {return definition;}, get staged() {return staged;},
    get control() {return control;}, rows: () => root.forOrganization(scope.organizationId).listDocuments<{phase: string}>("headless/models/training-plan-tasks")};
}

for (const engine of ["Core", "SQLite"] as const) {
  test(engine + ": approved training bridge composes real readers, original ledger and private application task once", async t => {
    const f = await fixture(t, engine), result = await f.run(); assert.ok(result.result.ok);
    assert.equal(result.result.value.kind, "started"); assert.equal(result.result.value.operation, "models.train");
    assert.equal(f.state.starts, 1); assert.equal(f.state.retained, 1); assert.equal(f.state.modelReads, 2); assert.equal(f.state.datasetReads, 1);
    assert.deepEqual(f.retrieved, ["saved/train.jsonl", "saved/validation.jsonl", "saved/recipe.json"]);
    assert.ok(f.retained); assert.equal(f.retained.task.requestId, result.result.value.reference.taskId);
    assert.deepEqual(f.definition!.inputs.map(row => [row.artifactId, row.role]), [["input-0", "train"], ["input-1", "validation"]]);
    assert.equal(f.definition!.proposalDigest, f.binding.proposalDigest); assert.equal(f.definition!.request.output.destination.local.enabled, false);
    assert.doesNotMatch(JSON.stringify(result.result), /empty-model|saved\/|instruction|Synthetic answer|recipeDigest/);
    assert.ok("publishIfCurrent" in result && result.publishIfCurrent); let sends = 0; assert.equal(await result.publishIfCurrent(() => {sends++; return true;}), true); assert.equal(sends, 1);
    const before = {...f.state}; const replay = await f.run(); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
    for (const name of ["starts", "gets", "resolves", "modelReads", "datasetReads", "compiles"] as const) assert.equal(f.state[name], before[name]);
    assert.equal((await f.rows()).length, 1);
    const action = {isCurrent: () => true, stillAllowed: async () => true};
    assert.equal((await f.retained.task.read(action)).runId, f.retained.task.requestId);
    assert.equal((await f.retained.task.cancel(action)).status, "cancelled");
  });

  test(engine + ": training bridge preserves complete legacy proposal identity", async t => {
    const f = await fixture(t, engine, {legacy: true}), result = await f.run(); assert.ok(result.result.ok);
    assert.equal(f.definition!.proposalDigest, f.binding.proposalDigest); assert.equal(f.retained!.proposalDigest, f.binding.proposalDigest);
  });

  test(engine + ": accepted private training task and ledger survive outward revocation during the original ACK", async t => {
    const f = await fixture(t, engine), held = f.gate(); f.state.onStart = held.wait;
    const running = f.run(); await held.started; f.state.current = false; f.state.now = 99999999; held.release();
    assert.deepEqual((await running).result, {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.starts, 1); assert.ok(f.retained); assert.equal((await f.rows())[0].value.phase, "accepted");
    assert.equal(await f.control!.stillAllowed(), true);
    assert.equal((await f.retained.task.read({isCurrent: () => true, stillAllowed: async () => true})).status, "queued");
    f.state.business = false; assert.equal(await f.control!.stillAllowed(), false);
    await assert.rejects(f.retained.task.read({isCurrent: () => true, stillAllowed: async () => true}));
  });

  test(engine + ": lost training reserve and issue replies do not dispatch or retry", async t => {
    for (const phase of ["new", "issued"]) {
      const f = await fixture(t, engine); f.state.dropWhen = value => phase === "new" ? (value as {kind?: string})?.kind === "new" : value === "issued";
      assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"}); assert.equal(f.state.starts, 0);
      assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"}); assert.equal(f.state.starts, 0);
      assert.equal((await f.rows()).length, 1); assert.equal((await f.rows())[0].value.phase, phase === "new" ? "reserved" : "issued");
    }
  });

  test(engine + ": lost acceptance retains the original private task before replay and never starts another", async t => {
    const f = await fixture(t, engine); f.state.dropWhen = value => f.state.retained === 1 && value === true;
    assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"});
    assert.ok(f.retained); assert.equal(f.state.starts, 1); assert.equal((await f.rows())[0].value.phase, "accepted");
    const replay = await f.run(); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed"); assert.equal(f.state.starts, 1);
  });

  test(engine + ": unconfigured private training port records terminal known non-start without stages or ordinary fallback", async t => {
    const f = await fixture(t, engine, {port: false}); assert.deepEqual((await f.run()).result, {ok: false, code: "headless.not-started"});
    assert.equal(f.state.creates, 0); const before = {...f.state}; assert.deepEqual((await f.run()).result, {ok: false, code: "headless.not-started"});
    for (const name of ["starts", "gets", "resolves", "modelReads", "datasetReads"] as const) assert.equal(f.state[name], before[name]);
    assert.equal((await f.rows())[0].value.phase, "not-started");
  });

  test(engine + ": training bridge denies permission loss during private preparation before issue", async t => {
    const f = await fixture(t, engine), held = f.gate(); f.state.onPrepare = held.wait;
    const running = f.run(); await held.started; f.state.current = false; held.release();
    assert.deepEqual((await running).result, {ok: false, code: "headless.forbidden"}); assert.equal(f.state.starts, 0);
    assert.equal((await f.rows())[0].value.phase, "not-started");
  });
}

test("training bridge refuses foreign, transient, inactive and missing-reader requests before a reservation", async t => {
  const f = await fixture(t);
  for (const change of [
    {context: {...f.context, principalId: "foreign"}},
    {request: {...(await f.makeOptions()).request, transient: {contextQuery: "Synthetic"}}},
    {isHostCurrent: () => false}, {getReaders: async () => undefined}, {resolveStart: async () => undefined},
    {stillBusinessAllowed: async () => false}, {canUse: async () => false},
  ]) assert.equal((await f.run(change)).result.ok, false);
  assert.equal((await f.rows()).length, 0); assert.equal(f.state.starts, 0);
});

test("training bridge copies returned Dataset bytes before later policy callbacks can mutate them", async t => {
  const f = await fixture(t); let source: Uint8Array | undefined, recipe: Uint8Array | undefined;
  f.state.transformDataset = value => {const row = value as {ok: true; prepared: {contents: {content: Uint8Array}[]; recipe: {content: Uint8Array}}};
    source = row.prepared.contents[0].content; recipe = row.prepared.recipe.content;
    f.state.onPolicy = async () => {source!.fill(0); recipe!.fill(0);}; return row;};
  const result = await f.run(); assert.ok(result.result.ok); assert.ok(source!.every(byte => byte === 0)); assert.ok(recipe!.every(byte => byte === 0));
  assert.equal(f.definition!.inputs[0].digest, sha(f.content.get("saved/train.jsonl")!));
  assert.equal(f.definition!.dataset.recipeDigest, sha(f.content.get("saved/recipe.json")!));
});

test("training bridge refuses valid changed private Model and Dataset facts before application effects", async t => {
  for (const kind of ["model", "version", "recipe", "content"] as const) {
    const f = await fixture(t);
    if (kind === "model") f.modelRecord.taskTags = [];
    else f.state.transformDataset = value => {
      const row = value as {prepared: {version: typeof f.version; contents: {content: Uint8Array}[]; recipe: {content: Uint8Array}}};
      if (kind === "version") return {...row, prepared: {...row.prepared, version: {...row.prepared.version, totalRows: 4}}};
      if (kind === "recipe") row.prepared.recipe.content.fill(0); else row.prepared.contents[0].content.fill(0); return row;
    };
    assert.deepEqual((await f.run()).result, {ok: false, code: "headless.not-started"}); assert.equal(f.state.creates, 0); assert.equal(f.state.starts, 0);
  }
});

test("training bridge retains a task synchronously before awaiting accepted ledger state", async t => {
  const f = await fixture(t), held = f.gate(); f.state.afterCommit = async value => {if (f.state.retained === 1 && value === true) await held.wait();};
  const running = f.run(); await held.started; assert.ok(f.retained); assert.equal(f.state.retained, 1); assert.equal(f.state.starts, 1);
  f.state.current = false; held.release(); assert.deepEqual((await running).result, {ok: false, code: "headless.forbidden"});
  assert.equal((await f.rows())[0].value.phase, "accepted");
});

test("training bridge unknown or asynchronous task retention preserves issuance and never repeats a start", async t => {
  for (const retainTask of [() => false, () => {throw new Error("Synthetic private detail");}, () => Promise.resolve(true)]) {
    const f = await fixture(t); assert.deepEqual((await f.run({retainTask: retainTask as RunOptions["retainTask"]})).result, {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal(f.state.starts, 1); assert.equal((await f.rows())[0].value.phase, "issued");
    assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"}); assert.equal(f.state.starts, 1);
  }
});

test("training bridge captures original methods and rejects active reader and prepared objects without hooks", async t => {
  const f = await fixture(t); let hooks = 0;
  const readers = {};
  Object.defineProperty(readers, "model", {enumerable: true, get() {hooks++; throw new Error("Do not invoke.");}});
  Object.defineProperty(readers, "dataset", {enumerable: true, value: f.datasetReader});
  assert.equal((await f.run({getReaders: async () => readers as Awaited<ReturnType<RunOptions["getReaders"]>>})).result.ok, false);
  const options = await f.makeOptions();
  Object.defineProperty(options.prepared, "scope", {get() {hooks++; throw new Error("Do not invoke.");}});
  assert.equal((await runPreparedHeadlessModelTraining(options)).result.ok, false); assert.equal(hooks, 0); assert.equal(f.state.starts, 0);
});

for (const engine of ["Core", "SQLite"] as const) {
  test(engine + ": concurrent training bridge requests preserve one original admission", async t => {
    const f = await fixture(t, engine), held = f.gate(); f.state.onPrepare = held.wait;
    const first = f.run(); await held.started;
    assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal(f.state.resolves, 1); assert.equal(f.state.gets, 1); assert.equal(f.state.starts, 0);
    held.release(); assert.ok((await first).result.ok); assert.equal(f.state.starts, 1); assert.equal((await f.rows()).length, 1);
  });

  test(engine + ": fresh valid metadata change after private preparation refuses physical dispatch", async t => {
    const f = await fixture(t, engine);
    f.state.onPrepare = async () => {
      const changed = {...clone(f.inputs), model: {...f.inputs.model, taskTags: []}};
      assert.ok(readHeadlessModelTrainingInputsValue(changed, f.request.input));
      await f.root.forOrganization(f.scope.organizationId).writeDocument("qualification/training-bridge", "inputs", changed);
    };
    assert.deepEqual((await f.run()).result, {ok: false, code: "headless.not-started"});
    assert.equal(f.state.starts, 0); assert.equal((await f.rows())[0].value.phase, "not-started");
  });
}

test("training bridge preserves an unknown original application start without replacing its task", async t => {
  const f = await fixture(t); f.state.onStart = async () => {throw new Error("Synthetic private worker detail");};
  assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(f.state.starts, 1); assert.equal((await f.rows())[0].value.phase, "issued"); assert.equal(f.state.retained, 0);
  assert.deepEqual((await f.run()).result, {ok: false, code: "headless.operation-unconfirmed"}); assert.equal(f.state.starts, 1);
});

test("training bridge retains original reader methods and start functions across policy waits without function-property hooks", async t => {
  const f = await fixture(t); let hooks = 0;
  const options = await f.makeOptions(), resolve = options.resolveStart;
  const start = await resolve(); assert.ok(start);
  for (const key of ["call", "name", "length"]) Object.defineProperty(start, key, {get() {hooks++; throw new Error("Do not inspect function properties.");}});
  f.state.onPolicy = async () => {if (f.state.gets) {
    f.modelReader.execute = async () => {hooks++; throw new Error("Do not replace the original reader.");};
    f.datasetReader.execute = async () => {hooks++; throw new Error("Do not replace the original reader.");};
  }};
  const result = await runPreparedHeadlessModelTraining({...options, resolveStart: async () => start});
  assert.ok(result.result.ok); assert.equal(hooks, 0); assert.equal(f.state.starts, 1);
});

test("training bridge rejects held-out rows disguised as a training artifact even when their own digest is valid", async t => {
  const f = await fixture(t); f.state.transformDataset = value => {
    const row = value as {prepared: {contents: unknown[]}};
    const artifact = f.version.artifacts.find(item => item.role === "test")!;
    return {...row, prepared: {...row.prepared, contents: [{role: "train", artifact, content: f.content.get(artifact.artifactKey)}, row.prepared.contents[1]]}};
  };
  assert.deepEqual((await f.run()).result, {ok: false, code: "headless.not-started"}); assert.equal(f.state.creates, 0);
});

test("training bridge keeps the original callback receivers", async t => {
  const f = await fixture(t);
  const options: {-readonly [Key in keyof RunOptions]: RunOptions[Key]} = {...await f.makeOptions()};
  const readers = options.getReaders, start = options.resolveStart, retain = options.retainTask;
  options.canUse = async function(this: RunOptions) {assert.equal(this, options); return true;};
  options.isHostCurrent = function(this: RunOptions) {assert.equal(this, options); return true;};
  options.stillBusinessAllowed = async function(this: RunOptions) {assert.equal(this, options); return true;};
  options.getReaders = async function(this: RunOptions) {assert.equal(this, options); return readers();};
  options.resolveStart = async function(this: RunOptions) {assert.equal(this, options); return start();};
  options.retainTask = function(this: RunOptions, value) {assert.equal(this, options); return retain(value);};
  assert.ok((await runPreparedHeadlessModelTraining(options)).result.ok); assert.equal(f.state.starts, 1);
});

test("training bridge preserves the existing unsplit prepared Dataset training profile", async t => {
  const f = await fixture(t, "Core", {split: false}); assert.ok((await f.run()).result.ok);
  assert.deepEqual(f.retrieved, ["saved/dataset.jsonl", "saved/recipe.json"]);
  assert.deepEqual(f.definition!.inputs.map(row => [row.artifactId, row.role]), [["input-0", "train"]]);
  assert.equal(f.state.starts, 1);
});

test("accepted training business control survives caller expiry while the original post-ACK power hook waits", async t => {
  const f = await fixture(t), held = f.gate(); f.state.onPowerStart = held.wait;
  const running = f.run(); await held.started; f.state.current = false;
  assert.equal(f.state.starts, 1); assert.equal(await f.control!.stillAllowed(), true);
  held.release(); assert.deepEqual((await running).result, {ok: false, code: "headless.forbidden"});
  assert.ok(f.retained); assert.equal((await f.rows())[0].value.phase, "accepted");
});

test("training bridge publication rechecks the captured caller policy separately from historical business control", async t => {
  const f = await fixture(t); let queryAllowed = true;
  const result = await runPreparedHeadlessModelTraining({...await f.makeOptions(), canUse: async () => queryAllowed});
  assert.ok(result.result.ok && "publishIfCurrent" in result && result.publishIfCurrent);
  f.state.business = false; let sends = 0;
  assert.equal(await result.publishIfCurrent(() => {sends++; return true;}), true, "Authorized history does not acquire business-write authority.");
  queryAllowed = false;
  assert.equal(await result.publishIfCurrent(() => {sends++; return true;}), false); assert.equal(sends, 1);
});

test("a new training attempt checks business policy before resolving an application owner", async t => {
  const f = await fixture(t); f.state.business = false;
  assert.equal((await f.run()).result.ok, false); assert.equal(f.state.resolves, 0); assert.equal(f.state.gets, 0);
  assert.equal((await f.rows()).length, 0);
});

async function bookOptions(f: Awaited<ReturnType<typeof fixture>>): Promise<OriginalTrainingRunOptions> {
  const {retainTask: _retentionIsOwnedByBook, ...options} = await f.makeOptions(); return options;
}
function taskQuery(f: Awaited<ReturnType<typeof fixture>>, operation: "models.training-task" | "models.cancel-training" = "models.training-task"): OriginalTrainingTaskQuery {
  return {documents: f.root, hostIncarnationId: f.host, scope: f.scope, isCurrent: () => f.state.host,
    authorize: async () => f.state.allowed, request: {version: HEADLESS_CONTRACT_VERSION, operation,
      input: {hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, selection: {kind: "task", taskId: f.definition!.requestId}}}};
}
for (const engine of ["Core", "SQLite"] as const) {
  test(engine + ": original training book composes actual ledger and private App progress/cancellation without Save or raw data", async t => {
    const f = await fixture(t, engine), book = createOriginalHeadlessTrainingTaskOwner();
    const started = await book.runPrepared(await bookOptions(f)); assert.ok(started.result.ok, JSON.stringify(started));
    assert.equal(f.state.starts, 1); f.state.status = "running";
    f.state.progress = {message: "PRIVATE MESSAGE", details: {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4, path: "PRIVATE"}};
    const observed = await book.read(taskQuery(f)); assert.ok(observed.ok, JSON.stringify(observed));
    assert.equal(observed.value.state, "running"); assert.equal(observed.value.percent, 50);
    assert.deepEqual(observed.value.progress, {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4});
    assert.equal(observed.value.outputQuality, "not-evaluated"); assert.equal(observed.value.runtimeReadiness, "not-checked");
    assert.equal(observed.value.registration, "requires-separate-approval");
    assert.equal(JSON.stringify(observed).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(observed).includes(f.staged!.outputDirectory), false);
    const cancelled = await book.cancel(taskQuery(f, "models.cancel-training")); assert.ok(cancelled.ok);
    assert.equal(cancelled.value.state, "cancelled"); assert.equal(f.state.cancels, 1);
    assert.deepEqual(await book.cancel(taskQuery(f, "models.cancel-training")), {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal(f.state.cancels, 1); assert.equal(f.state.starts, 1);
  });

  test(engine + ": lost ledger acceptance preserves book custody before replay and new caller observation", async t => {
    const f = await fixture(t, engine), book = createOriginalHeadlessTrainingTaskOwner();
    const options = await bookOptions(f);
    f.state.dropWhen = value => f.state.starts === 1 && value === true;
    assert.deepEqual((await book.runPrepared(options)).result, {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal((await f.rows())[0].value.phase, "accepted");
    f.state.current = false;
    const observed = await book.read(taskQuery(f)); assert.ok(observed.ok, JSON.stringify(observed));
    assert.equal(observed.value.taskId, f.definition!.requestId);
    const query = taskQuery(f), rawRequest = query.request as {input: object};
    const byPlan = await book.read({...query, request: {...rawRequest, input: {...rawRequest.input,
      selection: {kind: "plan-step", fingerprint: options.request.input.fingerprint, step: options.request.input.step}}}});
    assert.deepEqual(byPlan, observed);
    f.state.current = true; const before = {gets: f.state.gets, resolves: f.state.resolves, starts: f.state.starts};
    const replay = await book.runPrepared(await bookOptions(f)); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
    assert.deepEqual({gets: f.state.gets, resolves: f.state.resolves, starts: f.state.starts}, before);
  });

  test(engine + ": fresh book never adopts an accepted private task by generic ID or replay", async t => {
    const f = await fixture(t, engine); assert.ok((await f.run()).result.ok);
    const book = createOriginalHeadlessTrainingTaskOwner(), before = {...f.state};
    assert.deepEqual(await book.read(taskQuery(f)), {ok: false, code: "headless.unavailable"});
    const replay = await book.runPrepared(await bookOptions(f)); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
    assert.deepEqual(await book.cancel(taskQuery(f, "models.cancel-training")), {ok: false, code: "headless.unavailable"});
    for (const name of ["reads", "cancels", "starts", "gets", "resolves"] as const) assert.equal(f.state[name], before[name]);
  });

  test(engine + ": training control rejects foreign actor/client/workspace/host and changed proposal before App actions", async t => {
    const f = await fixture(t, engine), book = createOriginalHeadlessTrainingTaskOwner();
    assert.ok((await book.runPrepared(await bookOptions(f))).result.ok);
    const query = taskQuery(f), before = f.state.reads;
    for (const scope of [{...f.scope, principalId: "foreign"}, {...f.scope, registeredClientId: randomUUID()},
      {...f.scope, organizationId: createOrganizationId("org.foreign")}, {...f.scope, workspaceId: createWorkspaceId("workspace.foreign")}])
      assert.equal((await book.read({...query, scope})).ok, false);
    const host = randomUUID(), request = query.request as {input: object};
    assert.equal((await book.read({...query, hostIncarnationId: host, request: {...request, input: {...request.input, hostIncarnationId: host}}})).ok, false);
    assert.equal(f.state.reads, before);
    const row = (await f.rows())[0];
    await f.root.forOrganization(f.scope.organizationId).writeDocument("headless/models/training-plan-tasks", row.key,
      {...row.value, proposalDigest: "sha256:" + "f".repeat(64)}, {expectedRevision: row.revision});
    assert.equal((await book.read(query)).ok, false); assert.equal(f.state.reads, before);
  });
}

test("book reserves retention before resolver wait and denies another task before owner resolution", async t => {
  const first = await fixture(t), second = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks: 1});
  const original = await bookOptions(first), held = first.gate();
  const running = first.track(book.runPrepared({...original, async resolveStart() {await held.wait(); return original.resolveStart();}}));
  try {
    await held.started; assert.equal(first.state.starts, 0);
    assert.equal((await book.runPrepared(await bookOptions(second))).result.ok, false);
    assert.equal(second.state.resolves, 0); assert.equal(second.state.gets, 0); assert.equal(second.state.starts, 0);
    assert.equal((await second.rows()).length, 0);
  } finally {held.release();}
  assert.ok((await running).result.ok);
});

test("book releases only its own never-started slot while unknown application starts remain retained", async t => {
  const first = await fixture(t), second = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks: 1});
  assert.equal((await book.runPrepared({...await bookOptions(first), resolveStart: async () => undefined})).result.ok, false);
  second.state.onStart = async () => {throw Error("Synthetic lost original App ACK");};
  assert.deepEqual((await book.runPrepared(await bookOptions(second))).result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(second.state.starts, 1);
  assert.equal((await book.runPrepared(await bookOptions(first))).result.ok, false);
  assert.equal(first.state.starts, 0);
  assert.deepEqual((await book.runPrepared(await bookOptions(second))).result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(second.state.starts, 1);
});

test("book cancellation remains one original effect through held and lost acknowledgements", async t => {
  const f = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner();
  assert.ok((await book.runPrepared(await bookOptions(f))).result.ok);
  const held = f.gate(); f.state.onCancel = async () => {await held.wait(); throw Error("PRIVATE lost cancellation ACK");};
  const first = f.track(book.cancel(taskQuery(f, "models.cancel-training")));
  try {
    await held.started;
    assert.deepEqual(await book.cancel(taskQuery(f, "models.cancel-training")), {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal(f.state.cancels, 1);
  } finally {held.release();}
  assert.deepEqual(await first, {ok: false, code: "headless.operation-unconfirmed"});
  assert.deepEqual(await book.cancel(taskQuery(f, "models.cancel-training")), {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal(f.state.cancels, 1);
});

test("book checks fresh business/caller policy and denies disclosure after a held App read", async t => {
  const f = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner();
  assert.ok((await book.runPrepared(await bookOptions(f))).result.ok);
  const held = f.gate(); f.state.onRead = held.wait;
  const reading = f.track(book.read(taskQuery(f)));
  try {await held.started; f.state.allowed = false;} finally {held.release();}
  assert.equal((await reading).ok, false);
  assert.equal((await book.cancel(taskQuery(f, "models.cancel-training"))).ok, false); assert.equal(f.state.cancels, 0);
  f.state.allowed = true; f.state.business = false; f.state.onRead = undefined;
  assert.equal((await book.read(taskQuery(f))).ok, false);
});

for (const engine of ["Core", "SQLite"] as const) {
  test(engine + ": positive original App non-start releases host capacity without granting a Native lease", async t => {
    const first = await fixture(t, engine, {port: false}), second = await fixture(t, engine);
    const book = createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks: 1});
    assert.deepEqual((await book.runPrepared(await bookOptions(first))).result, {ok: false, code: "headless.not-started"});
    assert.equal((await first.rows())[0].value.phase, "not-started"); assert.equal(first.state.creates, 0);
    assert.ok((await book.runPrepared(await bookOptions(second))).result.ok); assert.equal(second.state.starts, 1);
  });
}

test("book captures original callback receivers before policy and resolver waits", async t => {
  const f = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner();
  const options: {-readonly [K in keyof OriginalTrainingRunOptions]: OriginalTrainingRunOptions[K]} = {...await bookOptions(f)};
  const readers = options.getReaders, resolver = options.resolveStart, held = f.gate();
  let first = true;
  options.canUse = async function(this: OriginalTrainingRunOptions) {assert.equal(this, options); if (first) {first = false; await held.wait();} return true;};
  options.getReaders = async function(this: OriginalTrainingRunOptions) {assert.equal(this, options); return readers();};
  options.resolveStart = async function(this: OriginalTrainingRunOptions) {assert.equal(this, options); return resolver();};
  const running = f.track(book.runPrepared(options));
  try {
    await held.started;
    options.getReaders = async () => {assert.fail("Replaced reader resolver.");};
    options.resolveStart = async () => {assert.fail("Replaced application resolver.");};
    options.canUse = async () => {assert.fail("Replaced caller policy.");};
  } finally {held.release();}
  assert.ok((await running).result.ok);
});

test("book candidate availability never exposes private candidate metadata or measured quality", async t => {
  const f = await fixture(t), book = createOriginalHeadlessTrainingTaskOwner(), options = await bookOptions(f);
  const resolved = await options.resolveStart(); assert.ok(resolved);
  const result = await book.runPrepared({...options, resolveStart: async () => async (...args) => {
    const started = await resolved(...args); if (started.kind !== "accepted") return started;
    const read = started.task.read;
    return {...started, task: {...started.task, async read(control) {
      await read(control);
      // Controlled fields only: no loss computation, output scoring or model.
      return {runId: started.task.requestId, status: "succeeded", reviewPending: true, outputDirectory: "PRIVATE-DIRECTORY",
        generatedModelCandidate: {displayName: "PRIVATE-CANDIDATE", localPath: "PRIVATE-PATH", metadata: {prompt: "PRIVATE-PROMPT"}},
        logs: ["PRIVATE-LOG"], metrics: {loss: 0.123}};
    }}};
  }});
  assert.ok(result.result.ok); const observed = await book.read(taskQuery(f)); assert.ok(observed.ok);
  assert.equal(observed.value.resultReview, "pending"); assert.equal(observed.value.outputQuality, "not-evaluated");
  assert.equal(observed.value.runtimeReadiness, "not-checked"); assert.equal(observed.value.registration, "requires-separate-approval");
  assert.equal(JSON.stringify(observed).includes("PRIVATE"), false); assert.equal(JSON.stringify(observed).includes("loss"), false);
});
