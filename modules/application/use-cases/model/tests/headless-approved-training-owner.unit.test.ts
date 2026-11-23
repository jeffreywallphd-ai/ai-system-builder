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
  ApprovedLocalTrainingControl, ApprovedLocalTrainingStart} from "../../../ports/model";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import {TrainModelUseCase} from "../train-model.use-case";

const digest = (value: Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const exists = async (path: string | undefined) => Boolean(path && await lstat(path).catch(() => undefined));
async function fixture(t: TestContext, options: {port?: false; reconciler?: false} = {}) {
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
    status: "running" as RuntimeTaskRecord["status"], creates: 0, prepares: 0, starts: 0, reads: 0, cancels: 0, settles: 0, issues: 0,
    onPrepare: undefined as (() => Promise<void>) | undefined,
    onStart: undefined as (() => Promise<void>) | undefined,
    onRead: undefined as (() => Promise<void>) | undefined,
    onSettle: undefined as (() => Promise<void>) | undefined};
  const admission: ApprovedLocalTrainingAdmission = {requestId, organizationId: "organization.private-training", principalId: "principal.synthetic",
    clientId: randomUUID(), hostIncarnationId: randomUUID(), modelUpdatedAt: "2026-11-22T00:00:00.000Z",
    datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64), proposalDigest: "sha256:" + "b".repeat(64),
    inputs: [{artifactId: "input-0", role: "train", mediaType: "application/x-ndjson", digest: digest(input), content: input}],
    recipe: {digest: digest(recipe), content: recipe}, control: {isCurrent: () => state.host, stillAllowed: async () => state.allowed},
    isAdmissionCurrent: () => state.admission, acknowledgeIssued: async () => {state.issues++; return true;}};
  let definition: ApprovedLocalTrainingDefinition | undefined, staged: ApprovedLocalTrainingStagedInput | undefined, nativeControl: ApprovedLocalTrainingControl | undefined;
  let ack: ApprovedLocalTrainingStartAck | undefined, record: RuntimeTaskRecord | undefined, cancellation: CancelRuntimeTaskResult | undefined;
  let startAdmission: (() => boolean) | undefined;
  const session: ApprovedLocalTrainingSession = {requestId, workspaceId,
    async prepare() {state.prepares++; await state.onPrepare?.(); return "ready";},
    async start(value, admit) {state.starts++; staged = value; startAdmission = admit; await state.onStart?.(); return ack ?? {kind: "accepted", requestId, workspaceId, status: "queued"};},
    async read() {state.reads++; await state.onRead?.(); return record ?? {requestId, workspaceId, taskType: TaskType.MODEL_TRAINING,
      status: state.status, concurrencyClass: "unknown", ...(state.status === "succeeded" ? {data: {runId: "train-inner-label", status: "succeeded",
        outputDirectory: staged!.outputDirectory, generatedModelCandidate: {displayName: "Synthetic candidate", artifactForm: "adapter", localPath: staged!.outputDirectory}}} : {})};},
    async cancel() {state.cancels++; state.status = "cancelled"; return cancellation ?? {requestId, status: "cancelled", cancelled: true};},
    async settle() {state.settles++; await state.onSettle?.(); return state.settled;}};
  const port: ApprovedLocalModelTrainingPort = {createSession(value, control) {state.creates++; definition = value; nativeControl = control; return session;}};
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
    get startAdmission() {return startAdmission;},
    setAck(value: ApprovedLocalTrainingStartAck) {ack = value;}, setRecord(value: RuntimeTaskRecord) {record = value;},
    setCancellation(value: CancelRuntimeTaskResult) {cancellation = value;},
    read: () => track(result!.task.read(readControl)), cancel: () => track(result!.task.cancel(readControl)),
    readWithControl: (control: ApprovedLocalTrainingControl) => track(result!.task.read(control)),
    reconcile: () => track(reconciler.reconcileNow()), stop: () => track(reconciler.settleAfterRuntimeStop(["python"])),
    gate() {let release!: () => void; const wait = new Promise<void>(resolve => {release = resolve;}); releases.push(release); return {wait, release};}};
}

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
