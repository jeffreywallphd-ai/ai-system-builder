import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {TaskType, type RuntimeTaskRecord, type CancelRuntimeTaskResult} from "../../../../contracts/runtime";
import type {ModelTrainingRequest} from "../../../../contracts/model";
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingAdmission, ApprovedLocalTrainingDefinition,
  ApprovedLocalTrainingSession, ApprovedLocalTrainingStagedInput, ApprovedLocalTrainingStartAck,
  ApprovedLocalTrainingControl, ApprovedLocalTrainingStart, ApprovedLocalTrainingModelReader, TrainingResultVerifiedFiles} from "../../../ports/model";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import {TrainModelUseCase} from "../train-model.use-case";

const digest = (value: Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const mutableVerification = (value: TrainingResultVerifiedFiles) => ({...value, files: value.files.map(file => ({...file}))});
const exists = async (path: string | undefined) => Boolean(path && await lstat(path).catch(() => undefined));
async function fixture(t: TestContext, options: {port?: false; reconciler?: false; verification?: boolean} = {}) {
  const boundary = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(boundary, "approved-training-test-")));
  const identity = await lstat(root, {bigint: true}); const old = {TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR};
  process.env.TEMP = root; process.env.TMP = root; process.env.TMPDIR = root;
  const releases: (() => void)[] = [], pending = new Set<Promise<unknown>>();
  const track = <T,>(promise: Promise<T>) => {pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;};
  // No actual worker/model/native resources exist in this controlled fixture.
  // Explicit reconciliation keeps test timers from starting background work.
  const reconciler = new OwnedTaskReconcilerService({setTimeout: (() => ({unref() {}})) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout});
  t.after(async () => {
    reconciler.stopObservation(); for (const release of releases) release();
    await Promise.allSettled([...pending]);
    const current = await lstat(root, {bigint: true}); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(await realpath(root), root); assert.equal(dirname(root), boundary);
    // Only the exclusively created fixture root, after all fake operations finish.
    await rm(root, {recursive: true});
    for (const key of ["TEMP", "TMP", "TMPDIR"] as const) {if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];}
  });
  const model = join(root, "model"); await mkdir(model);
  const workspaceId = createWorkspaceId("workspace.private-training"), requestId = randomUUID();
  const input = text('{"instruction":"Synthetic input","output":"Synthetic answer"}\n'), recipe = text('{"synthetic":true}');
  const request: ModelTrainingRequest = {workspaceId, trainingTask: "llm-instruction", baseModel: {modelRecordId: "model.synthetic", localPath: model},
    datasets: [{artifactId: "input-0", splitRole: "train", format: "jsonl"}], method: "lora", commonParameters: {maxSteps: 1, batchSize: 1},
    output: {outputModelName: "Private candidate", destination: {local: {enabled: false}}}, validation: {enabled: false}};
  const state = {host: true, allowed: true, admission: true, reader: true, readAllowed: true, settled: true,
    status: "running" as RuntimeTaskRecord["status"], creates: 0, prepares: 0, starts: 0, reads: 0, cancels: 0, settles: 0, issues: 0, verifies: 0,
    onPrepare: undefined as (() => Promise<void>) | undefined,
    onStart: undefined as (() => Promise<void>) | undefined,
    onRead: undefined as (() => Promise<void>) | undefined,
    onSettle: undefined as (() => Promise<void>) | undefined,
    onVerify: undefined as ((control: ApprovedLocalTrainingControl) => Promise<void>) | undefined};
  const admission: ApprovedLocalTrainingAdmission = {requestId, organizationId: "organization.private-training", principalId: "principal.synthetic",
    clientId: randomUUID(), hostIncarnationId: randomUUID(), modelUpdatedAt: "2026-11-22T00:00:00.000Z",
    datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64), proposalDigest: "sha256:" + "b".repeat(64),
    inputs: [{artifactId: "input-0", role: "train", mediaType: "application/x-ndjson", digest: digest(input), content: input}],
    recipe: {digest: digest(recipe), content: recipe}, control: {isCurrent: () => state.host, stillAllowed: async () => state.allowed},
    isAdmissionCurrent: () => state.admission, acknowledgeIssued: async () => {state.issues++; return true;}};
  let definition: ApprovedLocalTrainingDefinition | undefined, staged: ApprovedLocalTrainingStagedInput | undefined, nativeControl: ApprovedLocalTrainingControl | undefined;
  let modelSource: ApprovedLocalTrainingModelReader | undefined;
  let ack: ApprovedLocalTrainingStartAck | undefined, record: RuntimeTaskRecord | undefined, cancellation: CancelRuntimeTaskResult | undefined;
  let startAdmission: (() => boolean) | undefined;
  let verified: unknown;
  const verification = (): TrainingResultVerifiedFiles => {
    const publicationId = "c".repeat(32), adapter = ["lora", "qlora"].includes(definition!.request.method);
    const names = adapter ? ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"] : ["config.json", "model.safetensors", "tokenizer.json"];
    const snapshot = {schema: "training-result-finalized-files-v1" as const, publicationId, totalBytes: 6,
      files: names.map((name, fileIndex) => ({fileIndex, groupIndex: 0, name, role: "candidate" as const,
        mediaType: name.endsWith(".json") ? "application/json" as const : "application/octet-stream" as const,
        expectedSizeBytes: 2, expectedSha256: digest(text("{}")), key: `workspaces/${workspaceId}/artifacts/training-results/${publicationId}/${fileIndex}`}))};
    return {...snapshot, verification: "sha256-current-local-v1", manifestDigest: digest(text(JSON.stringify(snapshot)))};
  };
  const session: ApprovedLocalTrainingSession = {requestId, workspaceId,
    async prepare() {state.prepares++; await state.onPrepare?.(); return "ready";},
    async start(value, admit) {state.starts++; staged = value; startAdmission = admit; await state.onStart?.(); return ack ?? {kind: "accepted", requestId, workspaceId, status: "queued"};},
    async read() {state.reads++; await state.onRead?.(); return record ?? {requestId, workspaceId, taskType: TaskType.MODEL_TRAINING,
      status: state.status, concurrencyClass: "unknown", ...(state.status === "succeeded" ? {data: {runId: "train-inner-label", status: "succeeded",
        outputDirectory: staged!.outputDirectory, generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: "adapter", localPath: staged!.outputDirectory}}} : {})};},
    async cancel() {state.cancels++; state.status = "cancelled"; return cancellation ?? {requestId, status: "cancelled", cancelled: true};},
    async settle() {state.settles++; await state.onSettle?.(); return state.settled;},
    ...(options.verification ? {async verifyRetainedFiles(control: ApprovedLocalTrainingControl) {
      assert.equal(this, session); state.verifies++; assert.equal(control.isCurrent(), true); assert.equal(await control.stillAllowed(), true);
      await state.onVerify?.(control); return (verified ?? verification()) as TrainingResultVerifiedFiles;
    }} : {})};
  const port: ApprovedLocalModelTrainingPort = {createSession(value, control, source) {state.creates++; definition = value; nativeControl = control; modelSource = source; return session;}};
  const owner = new TrainModelUseCase({...(options.port === false ? {} : {approvedLocalTraining: port}),
    ...(options.reconciler === false ? {} : {taskReconciler: reconciler}),
    runtimeTaskRegistry: {async startTask() {assert.fail("No ordinary runtime start.");}, async startTaskWithoutInstalling() {assert.fail("No generic installed-only fallback.");},
      async getTaskStatus() {assert.fail("No shared-history task lookup.");}, async cancelTask() {assert.fail("No generic task cancellation.");}, async listTasks() {assert.fail("No task discovery.");}},
    modelRegistry: {async listModels() {assert.fail("No Model discovery.");}, async getModelRecord() {assert.fail("No ordinary Model resolution.");},
      async saveModelReference() {assert.fail("No reference save.");}, async registerDownloadedModel() {assert.fail("No registration.");},
      async updateModelRecord() {assert.fail("No Model update.");}, async deleteModelRecord() {assert.fail("No Model deletion.");},
      async registerGeneratedModel() {assert.fail("Separate Save is required.");}},
    storageBindings: {async readArtifactStorageBindings() {assert.fail("No mutable binding resolution.");}},
    storage: {async retrieveArtifact() {assert.fail("Only captured private bytes.");}},
    runtimeCapabilityGuard: {async requireCapabilityReady() {assert.fail("No ordinary readiness/installer guard.");}},
    taskPowerLifecycle: {async startTask() {}, async completeTask() {}}});
  const readControl: ApprovedLocalTrainingControl = {isCurrent: () => state.reader, stillAllowed: async () => state.readAllowed};
  let result: Extract<ApprovedLocalTrainingStart, {kind: "accepted"}> | undefined;
  const start = () => track(owner.startApprovedLocal(request, admission));
  const accepted = async () => {const value = await start(); assert.ok(value.kind === "accepted"); result = value; return value;};
  return {root, owner, request, admission, state, session, port, reconciler, input, recipe, workspaceId, requestId, readControl, start, accepted,
    get definition() {return definition;}, get staged() {return staged;}, get nativeControl() {return nativeControl;},
    get modelSource() {return modelSource;},
    get startAdmission() {return startAdmission;},
    setAck(value: ApprovedLocalTrainingStartAck) {ack = value;}, setRecord(value: RuntimeTaskRecord) {record = value;},
    setCancellation(value: CancelRuntimeTaskResult) {cancellation = value;},
    verification, setVerification(value: unknown) {verified = value;},
    read: () => track(result!.task.read(readControl)), cancel: () => track(result!.task.cancel(readControl)),
    readWithControl: (control: ApprovedLocalTrainingControl) => track(result!.task.read(control)),
    reconcile: () => track(reconciler.reconcileNow()), stop: () => track(reconciler.settleAfterRuntimeStop(["python"])),
    gate() {let release!: () => void; const wait = new Promise<void>(resolve => {release = resolve;}); releases.push(release); return {wait, release};}};
}

async function candidateFixture(t: TestContext) {
  const f = await fixture(t, {verification: true}), accepted = await f.accepted();
  f.state.status = "succeeded"; await f.reconcile(); return {...f, accepted};
}

const executionHistory = () => ({schema: "model-training-execution-v1", runId: "pipeline-original",
  startedAt: "2026-11-27T00:00:00.000Z", completedAt: "2026-11-27T00:00:01.000Z", durationMs: 950,
  hardware: {devices: ["cpu"], precisions: ["float32"], logicalCpuCount: 4,
    pythonVersion: "3.12.8", pytorchVersion: "2.7.0", transformersVersion: "4.52.0"}, interpretation: "reported-runtime-facts"});

async function executionCandidate(t: TestContext, report: unknown, pipelineId: string | null = "pipeline-original") {
  const f = await fixture(t, {verification: true}), accepted = await f.accepted();
  f.state.status = "succeeded";
  f.setRecord({requestId: f.requestId, workspaceId: f.workspaceId, taskType: TaskType.MODEL_TRAINING,
    status: "succeeded", concurrencyClass: "unknown", data: {runId: f.requestId, status: "succeeded", outputDirectory: f.staged!.outputDirectory,
      generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: "adapter", serializationFormat: "adapter-safetensors",
        localPath: f.staged!.outputDirectory, ...(pipelineId === null ? {} : {generatedFromRunId: pipelineId}), metadata: {executionHistory: report}}}});
  await f.reconcile(); return {...f, accepted};
}

test("current candidate binds execution to the original pipeline while cached task history stays unchanged", async t => {
  const report = executionHistory(), f = await executionCandidate(t, report), before = {...f.state};
  assert.notEqual(f.requestId, report.runId);
  const result = await f.accepted.task.reviewCandidate!(f.readControl);
  assert.equal(result.kind, "ready"); if (result.kind !== "ready") throw Error("Missing controlled candidate.");
  assert.deepEqual(result.execution, report);
  const owner = {organizationId: f.admission.organizationId, principalId: f.admission.principalId,
    clientId: f.admission.clientId, hostIncarnationId: f.admission.hostIncarnationId};
  assert.equal(result.candidateDigest, "sha256:" + createHash("sha256").update(JSON.stringify({requestId: f.requestId,
    workspaceId: f.workspaceId, owner, history: result.history, execution: result.execution, manifestDigest: result.retainedFiles.manifestDigest})).digest("hex"));
  assert.equal(f.state.verifies, before.verifies + 1); assert.equal(f.state.reads, before.reads); assert.equal(f.state.settles, before.settles);
  const cached = await f.accepted.task.reviewCompletion!(f.readControl); assert.equal(cached.kind, "ready");
  if (cached.kind === "ready") {assert.equal(cached.verification.hardware, "not-recorded"); assert.equal("execution" in cached, false);}
  report.hardware.devices[0] = "cuda";
  const again = await f.accepted.task.reviewCandidate!(f.readControl);
  assert.equal(again.kind, "ready"); if (again.kind === "ready") assert.deepEqual(again.execution?.hardware.devices, ["cpu"]);
});

for (const variant of ["missing-source", "foreign-run", "extra-field", "duration"] as const) {
  test(`current execution history denies ${variant} before current-file IO without changing historical cache`, async t => {
    const report: Record<string, unknown> = executionHistory();
    if (variant === "foreign-run") report.runId = "pipeline-foreign";
    if (variant === "extra-field") report.privatePath = "not-a-report-field";
    if (variant === "duration") report.durationMs = -1;
    const f = await executionCandidate(t, report, variant === "missing-source" ? null : "pipeline-original");
    await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl)); assert.equal(f.state.verifies, 0);
    assert.equal((await f.accepted.task.reviewCompletion!(f.readControl)).kind, "ready");
    assert.equal(f.state.starts, 1);
  });
}

test("current candidate review combines original settled history and verified content without ordinary runtime effects", async t => {
  const f = await candidateFixture(t), before = {...f.state};
  const result = await f.accepted.task.reviewCandidate!(f.readControl);
  assert.equal(result.kind, "ready"); if (result.kind !== "ready") throw Error("Missing controlled current candidate.");
  assert.equal(result.requestId, f.requestId); assert.equal(result.workspaceId, f.workspaceId);
  assert.equal(result.history.provenance.recipeDigest, f.admission.recipe.digest);
  assert.equal(result.history.provenance.proposalDigest, f.admission.proposalDigest);
  assert.deepEqual(result.retainedFiles, f.verification()); assert.match(result.candidateDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.history.verification.retainedFiles, "not-checked", "Historical facts retain their own scope.");
  assert.equal(f.state.verifies, before.verifies + 1); assert.equal(f.state.reads, before.reads); assert.equal(f.state.settles, before.settles);
  assert.equal(f.state.starts, 1); assert.equal(f.state.issues, 1);
  const expectedDigest = result.candidateDigest; (result.retainedFiles.files[0]! as {name: string}).name = "caller-changed";
  const next = await f.accepted.task.reviewCandidate!(f.readControl); assert.equal(next.kind, "ready");
  if (next.kind === "ready") {assert.equal(next.candidateDigest, expectedDigest); assert.equal(next.retainedFiles.files[0]!.name, "adapter_config.json");}
  assert.doesNotMatch(JSON.stringify(next), /approved-training-test|localPath|outputDirectory|model-private/);
});

test("current candidate review remains absent without configuration", async t => {
  const old = await fixture(t), legacy = await old.accepted(); assert.equal(legacy.task.reviewCandidate, undefined);
});

test("current candidate review is not ready before actual original session settlement", async t => {
  const f = await fixture(t, {verification: true}), accepted = await f.accepted();
  assert.deepEqual(await accepted.task.reviewCandidate!(f.readControl), {kind: "not-ready"});
  f.state.status = "succeeded"; f.state.settled = false; await f.reconcile();
  assert.deepEqual(await accepted.task.reviewCandidate!(f.readControl), {kind: "not-ready"}); assert.equal(f.state.verifies, 0);
  f.state.settled = true; await f.reconcile(); assert.equal((await accepted.task.reviewCandidate!(f.readControl)).kind, "ready");
});

test("current candidate review captures the original optional session method before preparation", async t => {
  const f = await candidateFixture(t);
  f.session.verifyRetainedFiles = async () => {throw Error("replacement must not execute");};
  assert.equal((await f.accepted.task.reviewCandidate!(f.readControl)).kind, "ready"); assert.equal(f.state.verifies, 1);
});

for (const change of ["workspace", "role", "pair", "tokenizer", "overflow", "digest"] as const) {
  test(`current candidate review refuses substituted ${change} verification facts`, async t => {
    const f = await candidateFixture(t), result = mutableVerification(f.verification());
    if (change === "workspace") result.files[0]!.key = "workspaces/other/artifacts/training-results/" + result.publicationId + "/0";
    if (change === "role") result.files[0]!.role = "checkpoint";
    if (change === "pair") {result.files[0]!.name = "config.json"; result.files[1]!.name = "model.safetensors";}
    if (change === "tokenizer") {result.files = result.files.slice(0, 2); result.totalBytes = 4;}
    if (change === "overflow") result.files[0]!.expectedSizeBytes = Number.MAX_SAFE_INTEGER;
    const {verification: _verification, manifestDigest: _digest, ...snapshot} = result;
    result.manifestDigest = change === "digest" ? "sha256:" + "0".repeat(64) : digest(text(JSON.stringify(snapshot)));
    f.setVerification(result); await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl), /private training/);
    assert.equal(f.state.starts, 1); assert.equal(f.state.issues, 1);
  });
}

test("current candidate review rejects metadata hooks before invoking them", async t => {
  const f = await candidateFixture(t), result = mutableVerification(f.verification()); let hooks = 0;
  Object.defineProperty(result.files[0], "name", {enumerable: true, get() {hooks++; throw Error("must not execute");}});
  f.setVerification(result); await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl)); assert.equal(hooks, 0);
  f.setVerification(new Proxy(f.verification(), {ownKeys() {hooks++; throw Error("must not execute");}}));
  await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl)); assert.equal(hooks, 0);
});

for (const [method, format] of [["lora", "safetensors"], ["qlora", "sharded-safetensors"],
  ["full-finetune", "adapter-safetensors"], ["full-finetune", "sharded-safetensors"]] as const) {
  test(`current candidate review refuses ${method} history with contradictory ${format} serialization before file reads`, async t => {
    const f = await fixture(t, {verification: true}); f.request.method = method; const accepted = await f.accepted();
    f.setRecord({requestId: f.requestId, workspaceId: f.workspaceId, taskType: TaskType.MODEL_TRAINING,
      concurrencyClass: "unknown", status: "succeeded", data: {runId: f.requestId, status: "succeeded", outputDirectory: f.staged!.outputDirectory,
        generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: method === "full-finetune" ? "full-model" : "adapter",
          serializationFormat: format, localPath: f.staged!.outputDirectory}}});
    await f.reconcile(); await assert.rejects(accepted.task.reviewCandidate!(f.readControl)); assert.equal(f.state.verifies, 0);
    const historical = await accepted.task.reviewCompletion!(f.readControl); assert.equal(historical.kind, "ready");
    if (historical.kind === "ready") assert.equal(historical.candidate.serializationFormat, format, "Keep original recorded facts unchanged.");
  });
}

test("current candidate review uses captured fresh authority and owns bytes before later policy", async t => {
  const f = await candidateFixture(t), result = mutableVerification(f.verification()); let returned = false;
  f.setVerification(result); f.state.onVerify = async () => {returned = true;};
  const control = {isCurrent: () => true, async stillAllowed() {
    if (returned) {result.files[0]!.name = "private-synthetic"; result.manifestDigest = "sha256:" + "0".repeat(64);} return true;
  }};
  const observed = await f.accepted.task.reviewCandidate!(control); assert.equal(observed.kind, "ready");
  if (observed.kind === "ready") assert.equal(observed.retainedFiles.files[0]!.name, "adapter_config.json");
});

test("current candidate review denies withdrawn original or caller permission before and after verification", async t => {
  const f = await candidateFixture(t);
  for (const flag of ["host", "allowed", "reader", "readAllowed"] as const) {
    const before = f.state.verifies; f.state[flag] = false;
    await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl)); f.state[flag] = true;
    assert.equal(f.state.verifies, before);
  }
  f.state.onVerify = async () => {f.state.readAllowed = false;};
  await assert.rejects(f.accepted.task.reviewCandidate!(f.readControl)); assert.equal(f.state.verifies, 1);
});

test("current candidate review retains unknown original verification and prevents output cleanup or retry", async t => {
  const f = await fixture(t, {verification: true}); let calls = 0, hooks = 0, reject!: (error: Error) => void;
  const original = new Promise<TrainingResultVerifiedFiles>((_, no) => {reject = no;});
  Object.defineProperty(original, "then", {get() {hooks++; throw Error("must not execute");}});
  f.session.verifyRetainedFiles = () => {calls++; return original;};
  const accepted = await f.accepted(); f.state.status = "succeeded"; await f.reconcile();
  try {
    await assert.rejects(accepted.task.reviewCandidate!(f.readControl));
    reject(Error("synthetic private verification")); await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(accepted.task.reviewCandidate!(f.readControl)); assert.equal(calls, 1); assert.equal(hooks, 0);
    await f.stop(); assert.ok(await exists(f.staged!.outputDirectory)); assert.equal(calls, 1);
  } finally {reject(Error("synthetic private verification"));}
});

test("Approved local training owner stages exact copied data and a private output through one original installed-only session", async t => {
  const f = await fixture(t), result = await f.accepted();
  assert.equal(result.value.runId, f.requestId); assert.equal(result.value.status, "queued");
  assert.equal(f.state.starts, 1); assert.equal(f.state.issues, 1); assert.equal(f.state.prepares, 1);
  assert.ok(Object.isFrozen(f.definition)); assert.ok(Object.isFrozen(f.definition!.request.commonParameters));
  assert.equal(f.definition!.dataset.recipeDigest, f.admission.recipe.digest);
  assert.equal(f.definition!.request.output.destination.local.enabled, false);
  assert.deepEqual(new Uint8Array(await readFile(f.staged!.payload.datasets[0].path!)), f.input);
  assert.deepEqual(new Uint8Array(await readFile(f.staged!.recipe.path)), f.recipe);
  assert.ok(await exists(f.staged!.outputDirectory));
  assert.equal(await f.owner.startApprovedLocal(f.request, f.admission).then(value => value.kind), "unavailable");
  assert.equal(f.state.starts, 1); assert.equal(f.state.issues, 1);
  const running = await f.read(); assert.equal(running.status, "running"); assert.equal(running.runId, f.requestId);
});

test("preparation Model reader captures its original receiver and reply before later policy callbacks", async t => {
  const f = await fixture(t); let calls = 0, replacements = 0, returned = false;
  const selected = {modelRecordId: f.request.baseModel.modelRecordId!, modelUpdatedAt: f.admission.modelUpdatedAt,
    localModelReference: f.request.baseModel.localPath!};
  const reader: ApprovedLocalTrainingModelReader = {async read() {assert.equal(this, reader); calls++; returned = true; return selected;}};
  (f.admission as {modelSource?: ApprovedLocalTrainingModelReader}).modelSource = reader;
  (f.admission as {control: ApprovedLocalTrainingControl}).control = {isCurrent: () => true, stillAllowed: async () => {
    if (returned) selected.localModelReference = join(f.root, "changed-after-read"); return true;
  }};
  f.state.onPrepare = async () => {
    reader.read = async () => {replacements++; throw Error("replacement must not run");};
    const value = await f.modelSource!.read(); assert.equal(value!.localModelReference, f.request.baseModel.localPath);
  };
  await f.accepted(); assert.equal(calls, 1); assert.equal(replacements, 0);
  assert.equal(await f.modelSource!.read(), undefined); assert.equal(calls, 1);
  assert.equal(await f.nativeControl!.stillAllowed(), true); assert.equal((await f.read()).status, "running");
});

for (const kind of ["getter", "undefined", "extra"] as const)
  test(`invalid preparation Model reader (${kind}) cannot reserve a runtime or execute getters`, async t => {
    const f = await fixture(t); let getters = 0;
    const source = kind === "undefined" ? undefined : kind === "extra" ? {async read() {return undefined;}, extra: true}
      : {get read() {getters++; return async () => undefined;}};
    (f.admission as {modelSource?: ApprovedLocalTrainingModelReader}).modelSource = source as ApprovedLocalTrainingModelReader | undefined;
    assert.equal((await f.start()).kind, "unavailable"); assert.equal(f.state.creates, 0); assert.equal(f.state.prepares, 0); assert.equal(getters, 0);
  });

test("a late preparation Model reply cannot disclose after startup while business controls remain usable", async t => {
  const f = await fixture(t), gate = f.gate(); let entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  let pending: Promise<unknown> | undefined;
  (f.admission as {modelSource?: ApprovedLocalTrainingModelReader}).modelSource = {async read() {
    entered(); await gate.wait; return {modelRecordId: f.request.baseModel.modelRecordId!, modelUpdatedAt: f.admission.modelUpdatedAt,
      localModelReference: f.request.baseModel.localPath!};
  }};
  f.state.onPrepare = async () => {pending = f.modelSource!.read(); await started;};
  await f.accepted(); gate.release(); assert.equal(await pending, undefined);
  assert.equal(await f.nativeControl!.stillAllowed(), true); assert.equal((await f.read()).status, "running");
});

test("actual approved training producer matches the shared Python sealing fixture", async t => {
  const expected = JSON.parse(await readFile(join(__dirname,
    "../../../../adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json"), "utf8"));
  assert.equal(expected.schema_version, "approved-training-staged-input-fixture-v1");
  const f = await fixture(t); await f.accepted();
  // The private wire adds outputDirectory; the public request type omits it.
  // Own the serialized data before normalizing its mutable test-only path nodes.
  const stagedWire = JSON.parse(JSON.stringify(f.staged)) as {
    payload: ModelTrainingRequest & {output: ModelTrainingRequest["output"] & {outputDirectory: string}};
    recipe: {path: string; digest: string; sizeBytes: number}; outputDirectory: string;
  };
  assert.equal(f.definition!.requestId, f.requestId); assert.equal(f.definition!.workspaceId, f.workspaceId);
  assert.equal(f.definition!.owner.clientId, f.admission.clientId);
  assert.equal(f.definition!.owner.hostIncarnationId, f.admission.hostIncarnationId);
  assert.equal(f.definition!.request.baseModel.localPath, join(f.root, "model"));
  assert.equal(f.staged!.payload.baseModel.localPath, f.definition!.request.baseModel.localPath);
  assert.equal(f.staged!.payload.datasets.length, 1);
  assert.equal(dirname(dirname(f.staged!.payload.datasets[0].path!)), f.root);
  assert.equal(dirname(f.staged!.recipe.path), dirname(f.staged!.payload.datasets[0].path!));
  assert.equal(dirname(f.staged!.outputDirectory), f.root);
  assert.equal(stagedWire.payload.output.outputDirectory, f.staged!.outputDirectory);
  assert.equal(new Set([f.definition!.request.baseModel.localPath, f.staged!.payload.datasets[0].path,
    f.staged!.recipe.path, f.staged!.outputDirectory]).size, 4);
  const actual = clone({schema_version: expected.schema_version, approvedRequest: f.definition!.request,
    inputs: f.definition!.inputs, recipeDigest: f.definition!.dataset.recipeDigest,
    recipeSizeBytes: f.definition!.recipeSizeBytes, staged: stagedWire});
  // Normalize only these checked path nodes; all other values and keys stay exact.
  actual.approvedRequest.baseModel.localPath = actual.staged.payload.baseModel.localPath = "@model";
  actual.staged.payload.datasets[0].path = "@input-0";
  actual.staged.recipe.path = "@recipe";
  actual.staged.payload.output.outputDirectory = actual.staged.outputDirectory = "@output";
  assert.deepEqual(actual, expected);
});

test("original completion review uses only settled cached history and approved provenance", async t => {
  const f = await fixture(t), accepted = await f.accepted();
  assert.equal(typeof accepted.task.reviewCompletion, "function");
  const before = {...f.state};
  assert.deepEqual(await accepted.task.reviewCompletion!(f.readControl), {kind: "not-ready"});
  assert.equal(f.state.reads, before.reads); assert.equal(f.state.settles, before.settles);
  f.state.status = "succeeded";
  assert.deepEqual(await accepted.task.reviewCompletion!(f.readControl), {kind: "not-ready"}, "Terminal metadata alone is insufficient.");
  await f.read();
  const settled = {...f.state}, review = await accepted.task.reviewCompletion!(f.readControl);
  assert.equal(review.kind, "ready"); if (review.kind !== "ready") throw Error("Missing completion history.");
  assert.equal(review.requestId, f.requestId); assert.equal(review.workspaceId, f.workspaceId);
  assert.deepEqual(review.provenance, {modelRecordId: f.request.baseModel.modelRecordId, modelUpdatedAt: f.admission.modelUpdatedAt,
    datasetId: f.admission.datasetId, versionId: f.admission.versionId, versionDigest: f.admission.versionDigest,
    recipeDigest: f.admission.recipe.digest, proposalDigest: f.admission.proposalDigest, trainingTask: f.request.trainingTask,
    method: f.request.method, trainingInputCount: 1, validationInputCount: 0, inputBytes: f.input.byteLength, recipeBytes: f.recipe.byteLength});
  assert.deepEqual(review.candidate, {requestedName: f.request.output.outputModelName, artifactForm: "adapter", serializationFormat: null, recordedSizeBytes: null});
  assert.deepEqual(review.comparison, {state: "not-recorded"});
  assert.deepEqual(review.verification, {inputs: "recorded-not-rechecked", retainedFiles: "not-checked", runtimeReadiness: "not-checked",
    hardware: "not-recorded", outputQuality: "not-evaluated"});
  assert.equal(review.registration, "requires-separate-approval");
  assert.equal(f.state.reads, settled.reads); assert.equal(f.state.settles, settled.settles);
  assert.equal(f.state.starts, settled.starts); assert.equal(f.state.cancels, settled.cancels);
  assert.equal(JSON.stringify(review).includes(f.root), false); assert.doesNotMatch(JSON.stringify(review), /Synthetic answer|localPath|outputDirectory|logs/);
  (review.provenance as {modelRecordId: string}).modelRecordId = "edited";
  const again = await accepted.task.reviewCompletion!(f.readControl); assert.equal(again.kind, "ready");
  if (again.kind === "ready") assert.equal(again.provenance.modelRecordId, f.request.baseModel.modelRecordId);
  assert.ok(await exists(f.staged!.outputDirectory), "Review never saves, removes or reacquires the candidate.");
});

test("cached completion review keeps reader and original business controls fresh without runtime IO", async t => {
  const f = await fixture(t), accepted = await f.accepted(); f.state.status = "succeeded"; await f.read();
  assert.equal(typeof accepted.task.reviewCompletion, "function"); const before = {...f.state};
  for (const flag of ["host", "allowed", "reader", "readAllowed"] as const) {
    f.state[flag] = false; await assert.rejects(accepted.task.reviewCompletion!(f.readControl), /private training/); f.state[flag] = true;
  }
  await assert.rejects(accepted.task.reviewCompletion!({isCurrent: () => f.state.reader, stillAllowed: async () => {
    f.state.reader = false; return true;
  }}), /private training/); f.state.reader = true;
  let calls = 0;
  await assert.rejects(accepted.task.reviewCompletion!({isCurrent: () => true, stillAllowed: async () => ++calls === 1}), /private training/);
  assert.equal(f.state.reads, before.reads); assert.equal(f.state.settles, before.settles);
  assert.equal(f.state.starts, before.starts); assert.equal(f.state.cancels, before.cancels);
});

test("completion history remains bound to the approved inputs after caller edits or ended start admission", async t => {
  const f = await fixture(t), accepted = await f.accepted(); f.state.status = "succeeded"; await f.read();
  const original = clone(f.definition!);
  f.request.baseModel.modelRecordId = "model.edited"; f.request.output.outputModelName = "Edited name";
  Object.assign(f.admission, {datasetId: "dataset.edited", modelUpdatedAt: "2030-01-01T00:00:00.000Z"});
  f.state.admission = false;
  const reviewed = await accepted.task.reviewCompletion!(f.readControl); assert.equal(reviewed.kind, "ready");
  if (reviewed.kind !== "ready") throw Error("Missing historical review.");
  assert.equal(reviewed.provenance.modelRecordId, original.request.baseModel.modelRecordId);
  assert.equal(reviewed.provenance.datasetId, original.dataset.datasetId);
  assert.equal(reviewed.provenance.modelUpdatedAt, original.modelUpdatedAt);
  assert.equal(reviewed.candidate.requestedName, original.request.output.outputModelName);
  assert.equal(f.state.starts, 1);
});

test("cached completion projects controlled stored loss reports without measuring or passing model quality", async t => {
  for (const trainedLoss of [0.75, 1.5]) {
    await t.test("stored value " + trainedLoss, async t => {
    const f = await fixture(t), accepted = await f.accepted();
    const report = {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32, sampleCount: 2,
      baselineLoss: 1.25, trainedLoss, lossDelta: trainedLoss - 1.25, interpretation: "measurement-only"};
    f.setRecord({requestId: f.requestId, workspaceId: f.workspaceId, taskType: TaskType.MODEL_TRAINING, status: "succeeded", concurrencyClass: "unknown",
      data: {runId: f.requestId, status: "succeeded", outputDirectory: f.staged!.outputDirectory,
        metrics: {baseline_validation_loss: report.baselineLoss, trained_validation_loss: trainedLoss,
          validation_sample_count: 2, validation_loss_delta: report.lossDelta},
        generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: "full-model", serializationFormat: "safetensors",
          sizeBytes: 128, localPath: f.staged!.outputDirectory, metadata: {validationComparison: report, privateText: "PRIVATE TRAINING DATA"}}}});
    await f.read(); const reads = f.state.reads;
    const reviewed = await accepted.task.reviewCompletion!(f.readControl); assert.equal(reviewed.kind, "ready");
    if (reviewed.kind !== "ready") throw Error("Missing stored report.");
    assert.deepEqual(reviewed.comparison, {state: "recorded", report});
    assert.equal(reviewed.verification.outputQuality, "not-evaluated", "Neither lower nor higher stored loss is a quality pass.");
    assert.equal(reviewed.candidate.recordedSizeBytes, 128); assert.equal(f.state.reads, reads);
    assert.equal(JSON.stringify(reviewed).includes("PRIVATE"), false);
    });
  }
});

test("completion review refuses malformed stored reports and unsupported formats while retaining output", async t => {
  for (const variant of ["extra", "missing", "rows", "delta", "metrics", "format"] as const) {
    await t.test(variant, async t => {
    const f = await fixture(t), accepted = await f.accepted();
    const report: Record<string, unknown> = {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32, sampleCount: 2,
      baselineLoss: 1.25, trainedLoss: 0.75, lossDelta: -0.5, interpretation: "measurement-only"};
    if (variant === "extra") report.privatePath = f.staged!.outputDirectory;
    if (variant === "missing") delete report.interpretation;
    if (variant === "rows") report.sampleCount = 33;
    if (variant === "delta") report.lossDelta = 0;
    f.setRecord({requestId: f.requestId, workspaceId: f.workspaceId, taskType: TaskType.MODEL_TRAINING, status: "succeeded", concurrencyClass: "unknown",
      data: {runId: f.requestId, status: "succeeded", outputDirectory: f.staged!.outputDirectory,
        metrics: {baseline_validation_loss: 1.25, trained_validation_loss: variant === "metrics" ? 2 : 0.75,
          validation_sample_count: 2, validation_loss_delta: -0.5},
        generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: "full-model", localPath: f.staged!.outputDirectory,
          serializationFormat: variant === "format" ? "pickle" : "safetensors", metadata: {validationComparison: report}}}});
    await f.read(); const reads = f.state.reads;
    await assert.rejects(accepted.task.reviewCompletion!(f.readControl));
    assert.equal(f.state.reads, reads); assert.equal(f.state.starts, 1);
    assert.ok(await exists(f.staged!.outputDirectory), "An invalid summary does not grant removal or a replacement run.");
    });
  }
});

for (const missing of ["port", "reconciler"] as const) test(`Approved local training owner refuses missing ${missing} before preparation`, async t => {
  const f = await fixture(t, {[missing]: false}); assert.deepEqual(await f.start(), {kind: "unavailable"});
  assert.equal(f.state.creates, 0); assert.equal(f.state.starts, 0); assert.equal(f.state.issues, 0);
});

test("Approved local training owner captures bytes, settings and methods before the first preparation wait", async t => {
  const f = await fixture(t), originalInput = new Uint8Array(f.input), originalRecipe = new Uint8Array(f.recipe); let replacements = 0;
  f.state.onPrepare = async () => {
    f.input.fill(0); f.recipe.fill(0); f.request.commonParameters.maxSteps = 999;
    f.session.start = async () => {replacements++; return {kind: "unavailable"};};
    f.session.read = async () => {replacements++; throw new Error("Replaced reader.");};
    f.port.createSession = () => {replacements++; return undefined;};
  };
  await f.accepted(); assert.equal(f.staged!.payload.commonParameters.maxSteps, 1);
  assert.deepEqual(new Uint8Array(await readFile(f.staged!.payload.datasets[0].path!)), originalInput);
  assert.deepEqual(new Uint8Array(await readFile(f.staged!.recipe.path)), originalRecipe);
  assert.equal((await f.read()).status, "running"); assert.equal(replacements, 0);
});

test("Approved local training owner retains admitted work after the outward caller ends and keeps original business policy", async t => {
  const f = await fixture(t); f.state.onStart = async () => {f.state.admission = false;};
  await f.accepted(); assert.equal((await f.read()).status, "running");
  assert.equal(f.nativeControl!.isCurrent(), true); assert.equal(await f.nativeControl!.stillAllowed(), true);
  f.state.allowed = false; await f.reconcile(); assert.equal(f.state.cancels, 1);
  await assert.rejects(f.read(), /private training/); assert.equal(f.state.status, "cancelled"); assert.equal(f.state.starts, 1);
});

test("Approved local training owner isolates ordinary read, cancel, Save and discard before queued and cached paths", async t => {
  const f = await fixture(t); await f.accepted();
  const denied = async () => {for (const operation of ["read", "cancel", "save", "discard"] as const)
    await assert.rejects(f.owner[operation](f.requestId, f.workspaceId), /private training/);};
  await denied(); f.state.status = "succeeded";
  await writeFile(join(f.staged!.outputDirectory, "synthetic-result.json"), "{}", {flag: "wx"});
  const pending = await f.read(); assert.equal(pending.runId, f.requestId); assert.equal(pending.status, "succeeded");
  assert.equal(pending.reviewPending, true); assert.equal(pending.outputDirectory, undefined);
  assert.equal(pending.generatedModelCandidate?.localPath, undefined); assert.equal(pending.outputModel, undefined);
  await denied(); assert.ok(await exists(f.staged!.outputDirectory));
  assert.equal(await exists(dirname(f.staged!.payload.datasets[0].path!)), false);
  assert.equal(f.state.starts, 1);
  const reads = f.state.reads; await f.stop();
  assert.equal((await f.read()).reviewPending, true); assert.ok(await exists(f.staged!.outputDirectory));
  assert.equal(f.state.reads, reads, "A settled candidate read uses cached metadata only.");
});

for (const variant of ["digest", "recipe", "role", "proxy", "accessor", "publish", "path", "unsupported"] as const) {
  test(`Approved local training owner refuses ${variant} before preparation IO`, async t => {
    const f = await fixture(t); let hooks = 0;
    let request = f.request, admission = f.admission;
    if (variant === "digest") Object.assign(admission.inputs[0], {digest: "sha256:" + "d".repeat(64)});
    if (variant === "recipe") Object.assign(admission.recipe, {digest: "sha256:" + "d".repeat(64)});
    if (variant === "role") Object.assign(admission.inputs[0], {role: "test"});
    if (variant === "proxy") admission = new Proxy(admission, {getPrototypeOf() {hooks++; throw new Error("Must not reflect proxy.");}});
    if (variant === "accessor") Object.defineProperty(request, "baseModel", {enumerable: true, get() {hooks++; return f.request.baseModel;}});
    if (variant === "publish") request.output.destination.local.enabled = true;
    if (variant === "path") request.baseModel.localPath = "relative/model";
    if (variant === "unsupported") request.trainingTask = "diffusion-lora";
    assert.deepEqual(await f.owner.startApprovedLocal(request, admission), {kind: "unavailable"}, variant);
    assert.equal(hooks, 0); assert.equal(f.state.creates, 0); assert.equal(f.state.issues, 0);
  });
}

for (const variant of ["ack-throws", "start-throws", "foreign-ack"] as const) test(`Approved local training owner retains ${variant} without retry or shared-history discovery`, async t => {
  const f = await fixture(t); f.state.settled = false;
  if (variant === "ack-throws") Object.assign(f.admission, {acknowledgeIssued: async () => {f.state.issues++; throw new Error("Lost issue acknowledgement.");}});
  if (variant === "start-throws") f.state.onStart = async () => {throw new Error("Lost start reply.");};
  if (variant === "foreign-ack") f.setAck({kind: "accepted", requestId: randomUUID(), workspaceId: f.workspaceId, status: "queued"});
  assert.deepEqual(await f.start(), {kind: "unconfirmed"});
  assert.deepEqual(await f.start(), {kind: "unavailable"});
  assert.equal(f.state.issues, 1); assert.equal(f.state.starts, variant === "ack-throws" ? 0 : 1);
  await f.stop(); assert.equal(f.reconciler.status.pending, 1); assert.equal(f.state.reads, 0);
  f.state.settled = true; await f.stop(); assert.equal(f.reconciler.status.pending, 0);
});

test("Approved local training owner never treats a terminal status or generic Python stop as settled private IO", async t => {
  const f = await fixture(t); await f.accepted(); f.state.status = "succeeded"; f.state.settled = false;
  const inputDirectory = dirname(f.staged!.payload.datasets[0].path!);
  await assert.rejects(f.read(), /private training/); assert.ok(await exists(inputDirectory)); assert.ok(await exists(f.staged!.outputDirectory));
  await f.stop(); assert.equal(f.reconciler.status.pending, 1); assert.ok(await exists(inputDirectory));
  assert.ok(await exists(f.staged!.outputDirectory)); f.state.settled = true;
  await f.stop(); assert.equal(f.reconciler.status.pending, 0); assert.equal(await exists(inputDirectory), false);
  assert.equal(await exists(f.staged!.outputDirectory), false);
  assert.equal((await f.read()).status, "failed");
});

test("Approved local training owner does not clean stages while an original read is held through shutdown", async t => {
  const f = await fixture(t); await f.accepted(); const gate = f.gate(), entered = f.gate();
  f.state.onRead = async () => {entered.release(); await gate.wait;};
  const read = f.read(); await entered.wait; const settles = f.state.settles;
  await f.stop(); assert.equal(f.reconciler.status.pending, 1); assert.equal(f.state.settles, settles);
  assert.ok(await exists(f.staged!.outputDirectory)); gate.release(); await read;
  await f.stop(); assert.equal(f.reconciler.status.pending, 0); assert.equal(await exists(f.staged!.outputDirectory), false);
});

test("Approved local training owner denies fresh reader policy loss and suppresses replaced callbacks", async t => {
  const f = await fixture(t); await f.accepted(); f.state.readAllowed = false;
  await assert.rejects(f.read(), /private training/); assert.equal(f.state.reads, 0); f.state.readAllowed = true;
  f.state.onRead = async () => {f.state.reader = false;};
  await assert.rejects(f.read(), /private training/); assert.equal(f.state.reads, 1);
  f.state.reader = true; f.state.onRead = undefined; let replaced = 0;
  const control = {isCurrent: () => true, stillAllowed: async () => true};
  assert.equal((await f.readWithControl(control)).status, "running", "The original reader policy must first work.");
  f.state.onRead = async () => {control.stillAllowed = async () => {replaced++; return true;};};
  await assert.rejects(f.readWithControl(control), /private training/); assert.equal(replaced, 0);
});

test("Approved local training owner rejects session accessors without executing them", async t => {
  const f = await fixture(t); let hooks = 0;
  const session = {...f.session}; Object.defineProperty(session, "read", {enumerable: true, get() {hooks++; return f.session.read;}});
  f.port.createSession = () => session;
  assert.deepEqual(await f.start(), {kind: "unconfirmed"}); assert.equal(hooks, 0); assert.equal(f.state.starts, 0);
  await f.stop(); assert.equal(f.reconciler.status.pending, 1);
});

test("Approved local training owner rejects shared/foreign status records before result adoption or cleanup", async t => {
  const f = await fixture(t); await f.accepted(); const forged = {requestId: randomUUID(), workspaceId: f.workspaceId,
    taskType: TaskType.MODEL_TRAINING, status: "succeeded", concurrencyClass: "unknown"} as const;
  f.setRecord(forged); await assert.rejects(f.read(), /private training/); assert.equal(f.state.settles, 0);
  assert.ok(await exists(f.staged!.outputDirectory));
});

test("Approved local training owner captures methods without evaluating function name or length accessors", async t => {
  const f = await fixture(t); let hooks = 0;
  for (const method of [f.port.createSession, f.session.prepare, f.session.start, f.session.read, f.session.cancel, f.session.settle]) {
    Object.defineProperty(method, "name", {configurable: true, get() {hooks++; return "active-name";}});
    Object.defineProperty(method, "length", {configurable: true, get() {hooks++; return 0;}});
  }
  await f.accepted(); assert.equal((await f.read()).status, "running"); assert.equal(hooks, 0);
});

for (const variant of ["policy", "host", "request", "callback", "scope"] as const) {
  test(`Approved local training owner refuses ${variant} changes during preparation before issue`, async t => {
    const f = await fixture(t); let replacements = 0;
    f.state.onPrepare = async () => {
      if (variant === "policy") f.state.allowed = false;
      if (variant === "host") f.state.host = false;
      if (variant === "request") f.state.admission = false;
      if (variant === "callback") Object.assign(f.admission, {isAdmissionCurrent: () => {replacements++; return true;}});
      if (variant === "scope") Object.assign(f.admission, {principalId: "principal.replacement"});
    };
    assert.deepEqual(await f.start(), {kind: "unavailable"}); assert.equal(f.state.issues, 0); assert.equal(f.state.starts, 0);
    assert.equal(replacements, 0); assert.deepEqual(await readdir(f.root), ["model"]); assert.equal(f.reconciler.status.pending, 0);
  });
}

test("Approved local training owner releases known non-started staging only after original settlement", async t => {
  const f = await fixture(t);
  Object.assign(f.admission, {acknowledgeIssued: async () => {f.state.issues++; return false;}});
  assert.deepEqual(await f.start(), {kind: "unavailable"}); assert.equal(f.state.issues, 1); assert.equal(f.state.starts, 0);
  assert.equal(f.state.settles, 1); assert.deepEqual(await readdir(f.root), ["model"]); assert.equal(f.reconciler.status.pending, 0);
  assert.deepEqual(await f.start(), {kind: "unavailable"}); assert.equal(f.state.issues, 1);
});

test("Approved local training owner keeps cancelled staging until original IO settles", async t => {
  const f = await fixture(t); await f.accepted(); f.state.settled = false;
  f.setCancellation({requestId: f.requestId, cancelled: true, status: "cancelled", message: "Synthetic private detail"});
  await assert.rejects(f.cancel(), /private training/); assert.equal(f.state.cancels, 1);
  assert.ok(await exists(f.staged!.outputDirectory)); assert.ok(await exists(dirname(f.staged!.payload.datasets[0].path!)));
  f.state.settled = true; const result = await f.read(); assert.equal(result.status, "cancelled");
  assert.doesNotMatch(JSON.stringify(result), /Synthetic private detail/); assert.equal(await exists(f.staged!.outputDirectory), false);
  assert.equal((await f.cancel()).status, "cancelled"); assert.equal(f.state.cancels, 1);
});

test("Approved local training owner retains actual class-method receivers through prepare and read", async t => {
  const f = await fixture(t); let owner!: ApprovedLocalTrainingSession;
  class Session implements ApprovedLocalTrainingSession {
    readonly requestId = f.requestId; readonly workspaceId = f.workspaceId;
    async prepare() {assert.equal(this, owner); return f.session.prepare();}
    async start(input: ApprovedLocalTrainingStagedInput, admit: () => boolean) {assert.equal(this, owner); return f.session.start(input, admit);}
    async read() {assert.equal(this, owner); return f.session.read();}
    async cancel() {assert.equal(this, owner); return f.session.cancel();}
    async settle() {assert.equal(this, owner); return f.session.settle();}
  }
  owner = new Session(); f.port.createSession = () => owner;
  await f.accepted(); assert.equal((await f.read()).status, "running");
  assert.equal((await f.cancel()).status, "cancelled"); assert.equal(f.state.starts, 1);
});

test("Approved local training owner never reads call accessors on captured permission callbacks", async t => {
  const f = await fixture(t); let hooks = 0;
  for (const method of [f.admission.control.isCurrent, f.admission.control.stillAllowed, f.admission.isAdmissionCurrent, f.admission.acknowledgeIssued])
    Object.defineProperty(method, "call", {configurable: true, get() {hooks++; return Function.prototype.call;}});
  await f.accepted(); assert.equal((await f.read()).status, "running"); assert.equal(hooks, 0);
});

test("Approved local training owner refuses sparse metadata arrays with out-of-range numeric properties", async t => {
  const f = await fixture(t), targetModules: string[] = [];
  targetModules.length = 1; Object.defineProperty(targetModules, "4294967295", {enumerable: true, value: "all-linear"});
  f.request.advancedParameters = {lora: {targetModules}};
  assert.deepEqual(await f.start(), {kind: "unavailable"}); assert.equal(f.state.creates, 0);
});

test("Regression: original business denial blocks private reads before the original reader", async t => {
  const f = await fixture(t); await f.accepted(); f.state.allowed = false;
  await assert.rejects(f.read(), /private training/); assert.equal(f.state.reads, 0);
});

test("Regression: original business denial blocks private cancel before original cancellation", async t => {
  const f = await fixture(t); await f.accepted(); f.state.allowed = false;
  await assert.rejects(f.cancel(), /private training/); assert.equal(f.state.cancels, 0);
});

test("Regression: host admission stop in the final awaited policy prevents task start", async t => {
  const f = await fixture(t); let stopped = false;
  Object.assign(f.admission.control, {stillAllowed: async () => {
    if (f.state.issues === 1) {stopped = true; f.reconciler.stopAccepting();}
    return true;
  }});
  const result = await f.start();
  assert.equal(stopped, true, "Exercise the last policy check after the original issue acknowledgement.");
  assert.equal(f.state.starts, 0); assert.equal(result.kind, "unavailable");
});

test("Regression: original business withdrawal during read suppresses the in-flight reply", async t => {
  const f = await fixture(t); await f.accepted(); let reads = 0;
  f.state.onRead = async () => {reads++; f.state.allowed = false;};
  await assert.rejects(f.read(), /private training/);
  assert.equal(reads, 1, "The original reader ran before permission was withdrawn.");
});

test("Regression: caller continuation rechecks stop after the final admission promise", async t => {
  const f = await fixture(t); let finalChecks = 0, stopped = false;
  Object.assign(f.admission, {isAdmissionCurrent: () => {
    if (f.state.issues === 1 && ++finalChecks === 2) queueMicrotask(() => {stopped = true; f.reconciler.stopAccepting();});
    return true;
  }});
  const result = await f.start(); assert.equal(stopped, true); assert.equal(finalChecks, 2);
  assert.equal(f.state.starts, 0, "Recheck the stopped host after awaiting admission and before start.");
  assert.equal(result.kind, "unavailable");
});

test("Regression: recipe counts in the existing aggregate input budget before session creation", async t => {
  const f = await fixture(t), shared = new Uint8Array(16 * 1024 * 1024), sha = digest(shared);
  const datasets = Array.from({length: 16}, (_, index) => ({artifactId: "input-" + index, splitRole: "train" as const, format: "jsonl" as const}));
  f.request.datasets = datasets;
  Object.assign(f.admission, {inputs: datasets.map(row => ({artifactId: row.artifactId, role: "train", mediaType: "application/x-ndjson", digest: sha, content: shared}))});
  // Stop at binding even on the defective source: never stage a large disk fixture.
  f.port.createSession = () => {f.state.creates++; return undefined;};
  assert.ok(shared.byteLength * datasets.length + f.recipe.byteLength > 256 * 1024 * 1024);
  const result = await f.start(); assert.equal(result.kind, "unavailable"); assert.equal(f.state.creates, 0);
  assert.equal(f.state.prepares, 0); assert.equal(f.state.starts, 0); assert.equal(f.state.issues, 0);
  assert.deepEqual(await readdir(f.root), ["model"]);
});

test("Approved local training owner passes a separate synchronous dispatch fence without revoking accepted work", async t => {
  const f = await fixture(t); let checked = false;
  f.state.onStart = async () => {
    assert.equal(f.startAdmission!(), true); checked = true;
    f.state.admission = false;
    assert.equal(f.startAdmission!(), false); assert.equal(f.nativeControl!.isCurrent(), true);
  };
  await f.accepted(); assert.equal(checked, true); assert.equal((await f.read()).status, "running");
  assert.equal(f.startAdmission!(), false, "An accepted task never permits another dispatch.");
});

test("Approved local training owner supplies the original dispatch fence through a held adapter wait", async t => {
  const f = await fixture(t), hold = f.gate(), original = f.session.start;
  let entered!: () => void; const reached = new Promise<void>(resolve => {entered = resolve;});
  f.session.start = async (input, admit) => {
    entered(); await hold.wait;
    if (!admit()) return {kind: "unavailable"};
    return Reflect.apply(original, f.session, [input, admit]);
  };
  const pending = f.start(); await reached; f.reconciler.stopAccepting(); hold.release();
  assert.equal((await pending).kind, "unavailable"); assert.equal(f.state.issues, 1); assert.equal(f.state.starts, 0);
  assert.equal(f.state.settles, 1); assert.equal(f.reconciler.status.pending, 0);
  assert.deepEqual(await readdir(f.root), ["model"]);
});
