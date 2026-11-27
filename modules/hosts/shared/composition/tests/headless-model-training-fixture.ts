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
import type {ApprovedLocalTrainingDefinition, ApprovedLocalTrainingStagedInput, ApprovedLocalTrainingControl,
  ApprovedLocalTrainingModelReader, ApprovedLocalTrainingSaveSession, ReviewedGeneratedModelControl} from "../../../../application/ports/model";
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
import {composeHeadlessModelTrainingStart} from "../composeHeadlessModelTrainingStart";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = (value: Uint8Array | string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const encode = (value: string) => new TextEncoder().encode(value);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Prepared = NonNullable<Awaited<ReturnType<CompileApprovedTrainingMetadata>>>;
type RunOptions = Parameters<typeof runPreparedHeadlessModelTraining>[0];
const originalTemporary = {TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR};
const fixtureParent = tmpdir();

export async function fixture(t: TestContext, engine: "Core" | "SQLite" = "Core", options: {port?: false; legacy?: boolean; split?: false; deferred?: boolean; runtime?: {modelDirectory: string; port: import("../../../../application/ports/model").ApprovedLocalModelTrainingPort;
  temporaryRoot?: string; registerCleanup?(cleanup: () => Promise<void>): void; beforeCleanup(): Promise<boolean>}} = {}) {
  const boundary = await realpath(options.runtime?.temporaryRoot ?? fixtureParent), directory = await realpath(await mkdtemp(join(boundary, "tbridge-")));
  const identity = await lstat(directory, {bigint: true}), previous = originalTemporary;
  process.env.TEMP = directory; process.env.TMP = directory; process.env.TMPDIR = directory;
  const database = engine === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  const base = database?.documents ?? createInMemoryStructuredDocumentStore();
  const state = {current: true, host: true, allowed: true, business: true, modelRead: true, now: 1000, gets: 0, resolves: 0,
    modelReads: 0, datasetReads: 0, starts: 0, creates: 0, prepares: 0, retained: 0, reads: 0, cancels: 0,
    status: "queued" as RuntimeTaskRecord["status"], issued: 0, retain: true, compiles: 0,
    configurations: 0, onConfiguration: undefined as (() => Promise<void>) | undefined,
    onPolicy: undefined as (() => Promise<void>) | undefined,
    onPrepare: undefined as (() => Promise<void>) | undefined,
    onStart: undefined as (() => Promise<void>) | undefined,
    onPowerStart: undefined as (() => Promise<void>) | undefined,
    onRead: undefined as (() => Promise<void>) | undefined,
    onCancel: undefined as (() => Promise<void>) | undefined,
    progress: undefined as RuntimeTaskRecord["progress"],
    completionMetrics: undefined as Record<string, number> | undefined,
    completionComparison: undefined as unknown,
    afterCommit: undefined as ((value: unknown) => Promise<void>) | undefined,
    dropWhen: undefined as ((value: unknown) => boolean) | undefined,
    transformModel: undefined as ((value: unknown) => unknown) | undefined,
    transformDataset: undefined as ((value: unknown) => unknown) | undefined};
  const releases: (() => void)[] = [], pending = new Set<Promise<unknown>>();
  const tracked = <T,>(promise: Promise<T>) => {pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;};
  const reconciler = new OwnedTaskReconcilerService({setTimeout: (() => ({unref() {}})) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout});
  const cleanup = async () => {
    if (options.runtime && !await options.runtime.beforeCleanup()) throw Error("Original training runtime closure is unconfirmed; fixture retained.");
    reconciler.stopObservation(); for (const release of releases) release(); await Promise.allSettled([...pending]); await database?.close();
    const current = await lstat(directory, {bigint: true}); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(await realpath(directory), directory); assert.equal(dirname(directory), boundary);
    // Controlled sessions are inert. A real runtime must separately prove its
    // original worker and IO closure above before exclusive fixture cleanup.
    await rm(directory, {recursive: true});
    for (const key of ["TEMP", "TMP", "TMPDIR"] as const) {if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];}
  };
  if (options.runtime?.registerCleanup) options.runtime.registerCleanup(cleanup); else t.after(cleanup);
  const root = Object.create(base) as StructuredDocumentStore, transaction = base.runInOwnedTransaction!.bind(base);
  Object.defineProperty(root, "runInOwnedTransaction", {value: async <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void) => {
    const value = await transaction(visit, fence); await state.afterCommit?.(value);
    if (state.dropWhen?.(value)) {state.dropWhen = undefined; throw new Error("Synthetic lost committed reply.");} return value;
  }});
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const scope = {organizationId: createOrganizationId("org.training-bridge"), workspaceId: createWorkspaceId("workspace.training-bridge"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const at = "2026-11-23T00:00:00.000Z", modelDirectory = options.runtime?.modelDirectory ?? join(directory, "empty-model"); if (!options.runtime) await mkdir(modelDirectory);
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
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, batchSize: 1, seed: 0, ...(options.runtime ? {maxSequenceLength: 64} : {})},
      ...(options.runtime ? {advancedParameters: {checkpointIntervalSteps: 1, saveTotalLimit: 1, lora: {rank: 2, alpha: 4, dropout: 0}}} : {}), validation: {enabled: false}}}]};
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
  let modelSource: ApprovedLocalTrainingModelReader | undefined;
  const dependencies: ConstructorParameters<typeof TrainModelUseCase>[0] = {taskReconciler: reconciler,
    ...(options.runtime ? {approvedLocalTraining: options.runtime.port} : options.port === false ? {} : {approvedLocalTraining: {createSession(value, originalControl, source) {
      assert.equal(this, approvedLocalTraining);
      state.creates++; definition = value; control = originalControl; modelSource = source;
      return {requestId: value.requestId, workspaceId: value.workspaceId,
        async prepare() {state.prepares++; await state.onPrepare?.(); return "ready" as const;},
        async start(input, isCurrent) {assert.equal(isCurrent(), true); state.starts++; staged = input; await state.onStart?.();
          return {kind: "accepted" as const, requestId: value.requestId, workspaceId: value.workspaceId, status: "queued" as const};},
        async read() {state.reads++; await state.onRead?.(); return {requestId: value.requestId, workspaceId: value.workspaceId, taskType: TaskType.MODEL_TRAINING,
          status: state.status, concurrencyClass: "unknown" as const, ...(state.progress ? {progress: state.progress} : {}),
          ...(state.status === "succeeded" ? {data: {runId: value.requestId, status: "succeeded", outputDirectory: staged!.outputDirectory,
            ...(state.completionMetrics ? {metrics: state.completionMetrics} : {}),
            generatedModelCandidate: {displayName: "Controlled candidate", artifactForm: "adapter", localPath: staged!.outputDirectory,
              serializationFormat: "adapter-safetensors", metadata: {privatePath: staged!.outputDirectory, privateData: "PRIVATE TRAINING TEXT",
                ...(state.completionComparison !== undefined ? {validationComparison: state.completionComparison} : {})}}}} : {})};},
        async cancel() {state.cancels++; await state.onCancel?.(); state.status = "cancelled"; return {requestId: value.requestId, cancelled: true, status: "cancelled" as const};},
        async settle() {return true;}};
    }}}),
    runtimeTaskRegistry: {async startTask() {assert.fail("No ordinary runtime.");}, async startTaskWithoutInstalling() {assert.fail("No generic installed-only fallback.");},
      async getTaskStatus() {assert.fail("No history discovery.");}, async cancelTask() {assert.fail("No ordinary cancel.");}, async listTasks() {assert.fail("No task list.");}},
    modelRegistry: {async listModels() {assert.fail();}, async getModelRecord() {assert.fail();}, async saveModelReference() {assert.fail();},
      async registerDownloadedModel() {assert.fail();}, async updateModelRecord() {assert.fail();}, async deleteModelRecord() {assert.fail();}, async registerGeneratedModel() {assert.fail("No automatic Save.");}},
    storageBindings: {async readArtifactStorageBindings() {assert.fail("No binding lookup.");}}, storage: {async retrieveArtifact() {assert.fail("Only private copies.");}},
    taskPowerLifecycle: {async startTask() {await state.onPowerStart?.();}, async completeTask() {}}, runtimeCapabilityGuard: {async requireCapabilityReady() {assert.fail("No installation.");}}};
  const train = new TrainModelUseCase(dependencies);
  const {approvedLocalTraining, generatedModelStorage, ...baseDependencies} = dependencies;
  const configuration = {async getConfiguration() {
    assert.equal(this, configuration); assert.equal(arguments.length, 0); state.configurations++; await state.onConfiguration?.();
    return approvedLocalTraining ? {approvedLocalTraining, ...(generatedModelStorage ? {generatedModelStorage} : {})} : undefined;
  }};
  const resolveStart = composeHeadlessModelTrainingStart({dependencies: baseDependencies,
    getConfiguration: (...args) => Reflect.apply(configuration.getConfiguration, configuration, args)});
  let retained: RetainedHeadlessTrainingTask | undefined;
  const modelReader = {async execute(...args: Parameters<ReadHeadlessModelTrainingModelUseCase["execute"]>) {
    assert.equal(this, modelReader); state.modelReads++;
    const authority = args[1], policy = authority.stillAllowed;
    const reply = await modelOwner.execute(args[0], {...authority,
      stillAllowed: async () => state.modelRead && await policy.call(authority) && state.modelRead});
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
    resolveStart: async () => {state.resolves++; return options.deferred ? resolveStart() : train.startApprovedLocal.bind(train);},
    retainTask(value) {state.retained++; retained = value; return state.retain;}});
  const run = async (changes: Partial<RunOptions> = {}) => tracked(runPreparedHeadlessModelTraining({...await makeOptions(), ...changes}));
  const gate = () => {let open!: () => void, entered!: () => void; const waiting = new Promise<void>(r => open = r), started = new Promise<void>(r => entered = r);
    releases.push(open); return {started, release: open, async wait() {entered(); await waiting;}};};
  return {state, scope, context, host, root, request, binding, inputs, version, content, retrieved, modelRecord, modelReader, datasetReader,
    train, approvedLocalTraining, prepare, makeOptions, run, gate, track: tracked, get retained() {return retained;}, get definition() {return definition;}, get staged() {return staged;},
    get control() {return control;}, get modelSource() {return modelSource;},
    rows: () => root.forOrganization(scope.organizationId).listDocuments<{phase: string}>("headless/models/training-plan-tasks")};
}
