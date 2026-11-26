import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {EventEmitter} from "node:events";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {runInNewContext} from "node:vm";
import {pathToFileURL} from "node:url";
import {PassThrough} from "node:stream";
import path from "node:path";
import {createOriginalTrainingPort, ORIGINAL_TRAINING_CAPABILITY, type OriginalTrainingOwnedChannel, type OriginalTrainingCapture} from "../client/approvedTrainingTaskSession";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {createPythonRuntimeAdapterFoundation} from "../createPythonRuntimePort";
import {OWNED_RUNTIME_READY_PREFIX} from "../supervisor/ownedPythonRuntimeProof";
import type {ApprovedLocalTrainingDefinition, ApprovedLocalTrainingStagedInput, TrainingResultFileIoRetirement} from "../../../../application/ports/model";
import {TaskType} from "../../../../contracts/runtime";
import type {WorkspaceId} from "../../../../contracts/workspace";
import type {OriginalTrainingSourceReservationFactory, OriginalTrainingSourceReservation} from "../client/originalTrainingModelSource";
import {bindOriginalTrainingCopyReservations, originalTrainingModelCopyReservation,
  bindOriginalTrainingWorkerConfiguration, prepareOriginalTrainingSharedStorageBudget} from "../client/originalTrainingModelSource";
import type {OriginalTrainingExitConfiguration} from "../client/approvedTrainingTaskSession";
import {createFilesystemTrainingResultFileByteStorageAdapter, createFilesystemLocalTrainingResultPublication} from "../../../storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter";
import {createOrganizationId, type OrganizationId} from "../../../../contracts/organization";
import {createInMemoryStructuredDocumentStore} from "../../../persistence/shared";
import {createStructuredTrainingStorageBudget} from "../../../persistence/model";
import {createFilesystemLocalTrainingModelCopyStorage} from "../../../storage/filesystem/artifact-store/createFilesystemLocalTrainingModelCopyStorage";
import {createBoundedLocalTrainingStartupProfile} from "../supervisor/createPythonRuntimeSupervisor";
import type {OriginalBoundedLocalTrainingConfiguration} from "../createPythonRuntimePort";

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const profile = {profileId: "inert-only", profileFingerprint: "sha256:" + "a".repeat(64)};
const runtime = {runtimeId: "inert-runtime", workerStartedAt: "2026-11-23T00:00:00Z"};
const identity = {...runtime, ...profile}, binding = {...identity, requestId: id, workspaceId: workspace, sessionId: "b".repeat(64)};

function exitReadyClient(capabilities: string[]) {
  const calls: string[] = [];
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111",
    authorizationToken: "synthetic-training-token".padEnd(40, "x"), captureProcessOwnership: () => () => {},
    fetchImplementation: (async (url, options) => {
      const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
      assert.ok(new Headers(options?.headers).get("authorization")?.startsWith("Bearer "));
      if (endpoint === "/health") return Response.json({healthy: true, status: {...runtime, status: "ready"}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities});
      return Response.json({binding, schema: "original-training-exit-ready-v1", ready: true, retirement: "ready"});
    }) as typeof fetch});
  return {client, calls};
}

test("explicit exit-ready capture requires its separate capability and never dispatches legacy settlement", async () => {
  const f = exitReadyClient(["train-model.original-exit-ready-v1"]);
  await assert.rejects(() => f.client.captureOriginalTrainingChannel(profile));
  const channel = await f.client.captureOriginalTrainingChannel(profile, "original-exit-ready-v1");
  const reply = await channel.send(`/training/original/${id}/exit-ready`, {binding}) as any;
  assert.equal(reply.schema, "original-training-exit-ready-v1"); assert.equal(reply.ready, true);
  const count = f.calls.length;
  await assert.rejects(() => channel.send(`/training/original/${id}/settle`, {binding}));
  await assert.rejects(() => channel.send(`/training/original/${id}/exit-ready/extra`, {binding}));
  assert.equal(f.calls.length, count);
});

test("a legacy capability cannot satisfy exit-ready capture or dispatch its new operation", async () => {
  const f = exitReadyClient([ORIGINAL_TRAINING_CAPABILITY]);
  await assert.rejects(() => f.client.captureOriginalTrainingChannel(profile, "original-exit-ready-v1"));
  const channel = await f.client.captureOriginalTrainingChannel(profile), count = f.calls.length;
  await assert.rejects(() => channel.send(`/training/original/${id}/exit-ready`, {binding}));
  assert.equal(f.calls.length, count);
});

test("an unknown retirement mode is denied before ownership or HTTP discovery", async () => {
  const f = exitReadyClient([ORIGINAL_TRAINING_CAPABILITY]);
  await assert.rejects(() => f.client.captureOriginalTrainingChannel(profile, "unknown" as never));
  assert.deepEqual(f.calls, []);
});

test("parent exit-ready selection requires a known mode and output factory before any reservation", () => {
  let reservations = 0;
  const options = {reserve() {reservations++; return () => {};}, async captureChannel() {throw Error("must not capture");}};
  assert.throws(() => createOriginalTrainingPort({...options, retirementProtocol: "unknown" as never}));
  assert.throws(() => createOriginalTrainingPort({...options, retirementProtocol: "original-exit-ready-v1"}));
  assert.equal(reservations, 0);
});

test("unused exit-ready execution cannot report settled after an uncertain asynchronous release", async () => {
  let attempts = 0;
  const session = createOriginalTrainingPort({retirementProtocol: "original-exit-ready-v1",
    createOutputStorage() {throw Error("must not create storage before prepare");},
    async captureChannel() {throw Error("must not capture");},
    reserve: () => (() => {attempts++; return Promise.reject(Error("synthetic uncertain release"));}) as never,
  }).createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true})!;
  assert.equal(await session.settle(), false); assert.equal(await session.settle(), false);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(attempts, 1);
});
function definition(): ApprovedLocalTrainingDefinition {
  return {requestId: id, workspaceId: workspace, owner: {organizationId: "org", principalId: "actor", clientId: id, hostIncarnationId: workspace},
    request: {workspaceId: workspace, trainingTask: "llm-instruction", baseModel: {modelRecordId: "base"},
      datasets: [{artifactId: "input-0", splitRole: "train"}], method: "lora", commonParameters: {}, output: {outputModelName: "inert", destination: {local: {enabled: false}}}},
    modelUpdatedAt: runtime.workerStartedAt, dataset: {datasetId: "dataset", versionId: "v1", versionDigest: profile.profileFingerprint, recipeDigest: profile.profileFingerprint},
    proposalDigest: profile.profileFingerprint, inputs: [{artifactId: "input-0", role: "train", mediaType: "application/jsonl", digest: profile.profileFingerprint, sizeBytes: 4}], recipeSizeBytes: 4};
}
function staged(): ApprovedLocalTrainingStagedInput {
  return {payload: definition().request, recipe: {path: "inert/recipe", digest: profile.profileFingerprint, sizeBytes: 4}, outputDirectory: "inert/output"};
}
function fixture(options: Partial<Parameters<typeof createOriginalTrainingPort>[0]> = {}) {
  let current = true, permission = true, releases = 0;
  const calls: string[] = [];
  const f = {calls, captures: 0, hook: undefined as undefined | ((action: string) => Promise<unknown> | unknown),
    status: "running", retirement: "settled", before: undefined as undefined | (() => void),
    workerClosed: true, workerRetirements: 0, unusedReleases: 0,
    retireHook: undefined as undefined | (() => Promise<boolean>),
    end() {current = false;}, deny() {permission = false;}, get releases() {return releases;},
  };
  const channel: OriginalTrainingOwnedChannel = {identity, assertCurrent() {if (!current) throw Error("retired");},
    async retireOriginalWorker() {assert.equal(this, channel); f.workerRetirements++; return f.retireHook ? f.retireHook() : f.workerClosed;},
    releaseUnusedWorker() {assert.equal(this, channel); f.unusedReleases++;},
    async send(endpoint, _body, dispatch) {
      f.before?.(); dispatch?.(); const segments = endpoint.split("/"), action = segments[segments.length - 1]!; calls.push(action);
      const override = await f.hook?.(action); if (override !== undefined) return override;
      if (action === "prepare" || action === "seal") return {binding, phase: "ready"};
      if (action === "start") return {binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"};
      if (action === "cancel") return {binding, cancelled: true};
      if (action === "settle") return {binding, settled: f.retirement === "settled", retirement: f.retirement};
      return {binding, record: {requestId: id, taskType: "train-model", status: f.status, progress: {batch: 1}, metadata: {workspaceId: workspace},
        ...(f.status === "succeeded" ? {data: {runId: id, status: "succeeded"}} : {})}};
    }};
  const port = createOriginalTrainingPort({captureChannel: async () => {f.captures++; return channel;}, reserve: () => () => {releases++;}, ...options});
  const session = port.createSession(definition(), {isCurrent: () => current, stillAllowed: async () => permission})!;
  return {...f, session, channel, get captures() {return f.captures;}, get releases() {return releases;}, get status() {return f.status;}, set status(value: string) {f.status = value;},
    get retirement() {return f.retirement;}, set retirement(value: string) {f.retirement = value;},
    get workerClosed() {return f.workerClosed;}, set workerClosed(value: boolean) {f.workerClosed = value;},
    get workerRetirements() {return f.workerRetirements;}, get unusedReleases() {return f.unusedReleases;},
    get retireHook() {return f.retireHook;}, set retireHook(value: typeof f.retireHook) {f.retireHook = value;},
    get hook(): typeof f.hook {return f.hook;}, set hook(value: typeof f.hook) {f.hook = value;},
    get before(): typeof f.before {return f.before;}, set before(value: typeof f.before) {f.before = value;}};
}

test("original storage budget preparation blocks capture and retirement until its actual operation finishes", async () => {
  let entered!: () => void, finish!: () => void, attempts = 0;
  const issued = new Promise<void>(resolve => {entered = resolve;}), pendingBudget = new Promise<void>(resolve => {finish = resolve;});
  const f = fixture({async prepareStorageBudget(original) {
    attempts++; assert.equal(original.definition.requestId, id); assert.ok(Object.isFrozen(original.definition));
    entered(); await pendingBudget;
  }});
  assert.equal(attempts, 0); assert.equal(f.captures, 0);
  const preparing = f.session.prepare(); await issued;
  assert.equal(f.captures, 0); assert.deepEqual(f.calls, []);
  assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  await assert.rejects(() => f.session.prepare()); assert.equal(attempts, 1);
  finish(); assert.equal(await preparing, "ready"); assert.equal(f.captures, 1);
  assert.deepEqual(f.calls, ["prepare"]); assert.equal(attempts, 1);
});

test("budget preparation precedes every output factory for both original retirement protocols", async () => {
  for (const retirementProtocol of [undefined, "original-exit-ready-v1"] as const) {
    let entered!: () => void, finish!: () => void;
    const issued = new Promise<void>(resolve => {entered = resolve;}), pendingBudget = new Promise<void>(resolve => {finish = resolve;});
    const order: string[] = [];
    const f = fixture({...(retirementProtocol ? {retirementProtocol} : {}),
      async prepareStorageBudget() {order.push("budget-issued"); entered(); await pendingBudget; order.push("budget-finished");},
      createOutputStorage() {order.push("output-factory"); throw Error("synthetic stop after ordering boundary");}});
    assert.deepEqual(order, []);
    const preparing = f.session.prepare(); await issued;
    assert.deepEqual(order, ["budget-issued"]); assert.equal(await f.session.settle(), false);
    finish(); assert.equal(await preparing, "unconfirmed");
    assert.deepEqual(order, ["budget-issued", "budget-finished", "output-factory"]);
    assert.equal(f.captures, 0); assert.equal(f.releases, 0); assert.equal(await f.session.settle(), false);
  }
});

test("unknown or malformed budget preparation cannot become a factory call, retry or released owner", async () => {
  const functions = [
    async () => {throw Error("synthetic original budget rejection");},
    async () => true,
  ];
  for (const retirementProtocol of [undefined, "original-exit-ready-v1"] as const) {
    for (const prepareStorageBudget of functions) {
      let factories = 0;
      const f = fixture({...(retirementProtocol ? {retirementProtocol} : {}), prepareStorageBudget: prepareStorageBudget as never,
        createOutputStorage() {factories++; throw Error("must not create output");}});
      assert.equal(await f.session.prepare(), "unconfirmed"); await assert.rejects(() => f.session.prepare());
      assert.equal(await f.session.settle(), false); assert.equal(f.captures, 0);
      assert.equal(f.releases, 0); assert.equal(factories, 0);
    }
  }
});

test("permission withdrawal during original budget preparation prevents output and startup", async () => {
  let entered!: () => void, finish!: () => void, factories = 0;
  const issued = new Promise<void>(resolve => {entered = resolve;}), pendingBudget = new Promise<void>(resolve => {finish = resolve;});
  const f = fixture({async prepareStorageBudget() {entered(); await pendingBudget;},
    createOutputStorage() {factories++; throw Error("must not create output");}});
  const preparing = f.session.prepare(); await issued; f.deny(); finish();
  assert.equal(await preparing, "unconfirmed"); assert.equal(f.captures, 0); assert.equal(factories, 0);
  assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  await assert.rejects(() => f.session.start(staged(), () => true));
});

test("Stop fences a pending budget before renewed permission and cannot later resume startup", async () => {
  for (const retirementProtocol of [undefined, "original-exit-ready-v1"] as const) {
    let entered!: () => void, finish!: () => void, factories = 0;
    const issued = new Promise<void>(resolve => {entered = resolve;}), pendingBudget = new Promise<void>(resolve => {finish = resolve;});
    const f = fixture({...(retirementProtocol ? {retirementProtocol} : {}),
      async prepareStorageBudget() {entered(); await pendingBudget;},
      createOutputStorage() {factories++; throw Error("must not create output");}});
    const preparing = f.session.prepare(); await issued;
    await assert.rejects(() => f.session.cancel()); finish();
    assert.equal(await preparing, "unconfirmed"); assert.equal(f.captures, 0); assert.equal(factories, 0);
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  }
});

test("Stop permanently fences pending channel capture without an optional budget hook", async () => {
  const peer = fixture(); let entered!: () => void, finish!: () => void;
  const issued = new Promise<void>(done => {entered = done;}), held = new Promise<void>(done => {finish = done;});
  const f = fixture({async captureChannel() {entered(); await held; return peer.channel;}});
  const preparing = f.session.prepare();
  try {
    await issued; await assert.rejects(f.session.cancel()); finish();
    assert.equal(await preparing, "unconfirmed"); assert.deepEqual(peer.calls, []);
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  } finally {finish(); await preparing;}
});

test("budget function is captured passively with the original receiver and definition", async () => {
  const base = fixture(); let held: OriginalTrainingCapture | undefined, oldCalls = 0, newCalls = 0;
  const options = {reserve(original: OriginalTrainingCapture) {held = original; return () => {};},
    async prepareStorageBudget(original: OriginalTrainingCapture) {assert.equal(this, options); assert.equal(original, held); oldCalls++;},
    async captureChannel() {return base.channel;}};
  const port = createOriginalTrainingPort(options);
  const session = port.createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true})!;
  assert.equal(oldCalls, 0);
  options.prepareStorageBudget = async () => {newCalls++; throw Error("replacement must not run");};
  assert.equal(await session.prepare(), "ready"); assert.equal(oldCalls, 1); assert.equal(newCalls, 0);
  let getters = 0;
  const malformed = {...options}; Object.defineProperty(malformed, "prepareStorageBudget", {enumerable: true, get() {getters++; return options.prepareStorageBudget;}});
  assert.throws(() => createOriginalTrainingPort(malformed)); assert.equal(getters, 0);
});

test("invalid private budget functions refuse before creating a reservation", () => {
  let reserves = 0, invocations = 0;
  const foreignState = {called: false};
  const foreign = runInNewContext("(async function(){called=true;throw Error('synthetic foreign rejection')})", foreignState);
  const unsupported = [() => {invocations++; return undefined;},
    () => {invocations++; return Object.defineProperty(Promise.reject(Error("synthetic prebuilt rejection")), "then",
      {get() {throw Error("must not invoke getter");}});},
    () => {invocations++; return Object.defineProperty(Promise.reject(Error("synthetic constructor rejection")), "constructor",
      {get() {throw Error("must not invoke getter");}});},
    (async () => {invocations++;}).bind({}), foreign,
    async function* () {invocations++; yield undefined;},
    new Proxy(async () => {}, {apply() {invocations++; throw Error("must not invoke proxy");}})];
  for (const value of [null, true, {}, ...unsupported]) {
    assert.throws(() => createOriginalTrainingPort({prepareStorageBudget: value as never,
      reserve() {reserves++; return () => {};}, async captureChannel() {throw Error("must not capture");}}));
  }
  assert.equal(reserves, 0); assert.equal(invocations, 0); assert.equal(foreignState.called, false);
});

test("a rejected native budget operation with an own-then hook stays observed without host error leakage", () => {
  // Isolate one-use async-hooks instrumentation; no process rejection handler
  // changes the ordinary Node failure policy. The old barrier exits nonzero.
  const script = `
import assert from 'node:assert/strict';
import {createHook} from 'node:async_hooks';
const {createOriginalTrainingPort}=await import(process.argv[1]);
const definition=JSON.parse(process.argv[2]);
let selected, getters=0, captures=0, releases=0;
async function budgetGetterRejectionOperation(){throw Error('synthetic private budget rejection reason');}
const hook=createHook({init(_id,type,_trigger,resource){
  if(type==='PROMISE'&&!selected&&new Error().stack.includes('budgetGetterRejectionOperation')){
    selected=resource;
    Object.defineProperty(resource,'then',{get(){getters++;throw Error('must not invoke supplied then');}});
  }
}}).enable();
const session=createOriginalTrainingPort({prepareStorageBudget:budgetGetterRejectionOperation,
  reserve(){return()=>{releases++;};},async captureChannel(){captures++;throw Error('must not capture');}
}).createSession(definition,{isCurrent:()=>true,stillAllowed:async()=>true});
const status=await session.prepare();hook.disable();
await new Promise(resolve=>setTimeout(resolve,25));
assert.ok(selected);assert.equal(status,'unconfirmed');assert.equal(await session.settle(),false);
assert.equal(getters,0);assert.equal(captures,0);assert.equal(releases,0);
console.log(JSON.stringify({status,getters,captures,releases}));`;
  const environment = {...process.env}; delete environment.NODE_TEST_CONTEXT;
  const moduleUrl = pathToFileURL(path.resolve("modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts")).href;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, "--", moduleUrl, JSON.stringify(definition())],
    {env: environment, cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 65536});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes("synthetic private budget rejection reason"), false);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {status: "unconfirmed", getters: 0, captures: 0, releases: 0});
});

test("actual configured-store debit completes before output setup and is retained after setup failure", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const policy = {poolId: "synthetic-original-training-pool", profileFingerprint: profile.profileFingerprint,
    maximumBytes: 500, maximumOrganizationBytes: 500, maximumPrincipalBytes: 500,
    maximumReservations: 2, maximumOrganizationReservations: 2, maximumPrincipalReservations: 2};
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const namespace = "model/training/storage-budget/pools-v1", poolKey = hash([policy.poolId]);
  await documents.writeDocument(namespace, poolKey, {schema: "training-storage-budget-pool-v1", policyDigest: "sha256:" + hash(policy),
    reservedBytes: 0, reservationCount: 0, organizations: []}); // Explicit synthetic provisioning only.
  const budget = createStructuredTrainingStorageBudget({documents, policy, authorize: async () => true});
  const order: string[] = [];
  const f = fixture({async prepareStorageBudget(original) {
    const value = original.definition;
    const result = await budget.reserve({scope: {...value.owner, organizationId: value.owner.organizationId as OrganizationId,
      workspaceId: value.workspaceId, requestId: value.requestId}, definitionDigest: "sha256:" + hash(value),
      storageScopeDigest: "sha256:" + "b".repeat(64), profileFingerprint: policy.profileFingerprint,
      limits: {model: 10, inputs: 10, "worker-output": 10, "parent-output": 10, overhead: 10}, maximumReservedBytes: 100}, {isCurrent: () => true});
    assert.equal(result.kind, "reserved"); order.push("budget-committed");
  }, createOutputStorage() {order.push("output-factory"); throw Error("synthetic no physical output construction");}});
  assert.equal(await f.session.prepare(), "unconfirmed"); assert.deepEqual(order, ["budget-committed", "output-factory"]);
  assert.equal(await f.session.settle(), false); assert.equal(f.captures, 0); assert.equal(f.releases, 0);
  assert.equal((await documents.readDocument<{reservedBytes: number}>(namespace, poolKey))!.value.reservedBytes, 100);
});

test("synchronous creation reserves before capture, then original accepted task retires permanently", async () => {
  const f = fixture(); assert.deepEqual(f.calls, []);
  assert.equal(await f.session.prepare(), "ready"); assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
  const running = await f.session.read(); assert.equal(running.taskType, TaskType.MODEL_TRAINING);
  assert.deepEqual(running.progress, {details: {batch: 1}}); assert.equal(await f.session.settle(), false);
  f.status = "succeeded"; assert.equal(await f.session.settle(), true); assert.equal(await f.session.settle(), true);
  const count = f.calls.length; assert.equal((await f.session.read()).status, "succeeded"); assert.equal(f.calls.length, count);
  assert.equal(f.releases, 1); await assert.rejects(() => f.session.start(staged(), () => true));
});

test("startup receives the exact frozen original reservation and captured control receivers", async () => {
  const f = fixture(), raw = definition(); let reserved: OriginalTrainingCapture | undefined, captures = 0;
  let allowedCalls = 0, replacementCalls = 0;
  const control = {isCurrent() {assert.equal(this, control); return true;},
    async stillAllowed() {assert.equal(this, control); allowedCalls++; return true;}};
  const options = {
    reserve(capture: OriginalTrainingCapture) {assert.equal(this, options); reserved = capture; return () => {};},
    async captureChannel(capture: OriginalTrainingCapture) {
      assert.equal(this, options); assert.equal(capture, reserved); captures++;
      assert.notEqual(capture.definition, raw); assert.ok(Object.isFrozen(capture));
      assert.ok(Object.isFrozen(capture.definition.request)); assert.ok(Object.isFrozen(capture.definition.inputs));
      assert.equal(capture.definition.request.output.outputModelName, "inert");
      assert.equal(capture.definition.owner.principalId, "actor");
      assert.throws(() => {(capture.definition.request.output as any).outputModelName = "substituted";});
      capture.assertCurrent(); await capture.assertAllowed(); return f.channel;
    },
  };
  const session = createOriginalTrainingPort(options).createSession(raw, control)!;
  assert.ok(reserved); assert.equal(captures, 0);
  (raw.request.output as any).outputModelName = "later mutation"; (raw.owner as any).principalId = "other";
  control.isCurrent = () => {replacementCalls++; return false;};
  control.stillAllowed = async () => {replacementCalls++; return false;};
  assert.equal(await session.prepare(), "ready"); assert.equal(captures, 1); assert.equal(replacementCalls, 0);
  assert.ok(allowedCalls >= 3);
});

test("observed original permission loss cannot revive the same startup capture", async () => {
  let permission = true, capture: OriginalTrainingCapture | undefined, releases = 0, dispatches = 0;
  const port = createOriginalTrainingPort({reserve(original) {capture = original; return () => {releases++;};},
    async captureChannel(original) {assert.equal(original, capture); permission = false; await original.assertAllowed(); dispatches++; throw Error("unreachable");}});
  const session = port.createSession(definition(), {isCurrent: () => true, stillAllowed: async () => permission})!;
  assert.equal(await session.prepare(), "unconfirmed"); permission = true;
  assert.throws(() => capture!.assertCurrent()); await assert.rejects(() => capture!.assertAllowed());
  await assert.rejects(() => session.prepare()); assert.equal(await session.settle(), false);
  assert.equal(dispatches, 0); assert.equal(releases, 0);
});

test("async currentness cannot reserve or authorize training and its rejection is consumed", async () => {
  let reservations = 0;
  const port = createOriginalTrainingPort({reserve() {reservations++; return () => {};}, captureChannel: async () => {throw Error("unreachable");}});
  assert.throws(() => port.createSession(definition(), {isCurrent: (async () => {throw Error("synthetic private rejection");}) as never,
    stillAllowed: async () => true}), /^Error: The original private training session is unavailable\.$/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reservations, 0);
});
for (const action of ["prepare", "seal", "start"] as const) test(`lost ${action} reply retains original reservation and denies another issue`, async () => {
  const f = fixture(); f.hook = name => {if (name === action) throw Error("synthetic lost reply");};
  assert.equal(await f.session.prepare(), action === "prepare" ? "unconfirmed" : "ready");
  if (action !== "prepare") assert.equal((await f.session.start(staged(), () => true)).kind, "unconfirmed");
  await assert.rejects(() => f.session.start(staged(), () => true)); assert.equal(f.releases, 0);
  assert.equal(f.calls.filter(name => name === action).length, 1);
});
test("start admission lost during seal prevents physical start", async () => {
  const f = fixture(); let admission = true;
  await f.session.prepare(); f.hook = name => {if (name === "seal") admission = false;};
  assert.equal((await f.session.start(staged(), () => admission)).kind, "unconfirmed"); assert.equal(f.calls.includes("start"), false);
});
test("accepted reply survives outward admission ending after dispatch", async () => {
  const f = fixture(); let admission = true; await f.session.prepare();
  f.hook = name => {if (name === "start") admission = false;};
  assert.equal((await f.session.start(staged(), () => admission)).kind, "accepted");
  assert.equal((await f.session.read()).status, "running");
});
test("unknown cancellation and retirement never repeat effects", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true);
  f.hook = name => {if (name === "cancel" || name === "settle") throw Error("synthetic lost reply");};
  await assert.rejects(() => f.session.cancel()); await assert.rejects(() => f.session.cancel());
  f.status = "succeeded"; assert.equal(await f.session.settle(), false); assert.equal(await f.session.settle(), false);
  assert.equal(f.calls.filter(x => x === "cancel").length, 1); assert.equal(f.calls.filter(x => x === "settle").length, 1); assert.equal(f.releases, 0);
});
test("pending original retirement can be observed without repeating a close", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  f.retirement = "pending"; assert.equal(await f.session.settle(), false);
  f.retirement = "settled"; assert.equal(await f.session.settle(), true); assert.equal(f.releases, 1);
});
test("retirement closes admission before its own first read await", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  let entered!: () => void; const observed = new Promise<void>(resolve => {entered = resolve;});
  f.hook = async action => {if (action === "read") {entered(); await gate;}};
  const retirement = f.session.settle();
  try {
    await observed; const count = f.calls.length;
    await assert.rejects(() => f.session.read()); await assert.rejects(() => f.session.cancel());
    assert.equal(f.calls.length, count); assert.equal(f.releases, 0); assert.equal(await f.session.settle(), false);
  } finally {release();}
  assert.equal(await retirement, true); assert.equal(f.releases, 1);
});
test("malformed retirement acknowledgement cannot grant another close", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  f.hook = action => action === "settle" ? {binding, settled: null, retirement: "pending"} : undefined;
  assert.equal(await f.session.settle(), false); f.hook = undefined;
  assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  assert.equal(f.calls.filter(action => action === "settle").length, 1);
});
test("original channel methods and receivers are retained through callbacks", async () => {
  const f = fixture(); await f.session.prepare();
  f.channel.send = async () => {throw Error("replacement");};
  assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
});
test("binding mismatch and stale business policy do not disclose original data", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true);
  f.hook = action => action === "read" ? {binding: {...binding, workspaceId: "other"}, record: {}} : undefined;
  await assert.rejects(() => f.session.read()); f.deny(); const count = f.calls.length;
  await assert.rejects(() => f.session.read()); assert.equal(f.calls.length, count);
});

test("remote settlement retains custody until original worker close and never uses HTTP again", async () => {
  const f = fixture(); f.workerClosed = false;
  await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  const calls = [...f.calls]; f.hook = () => {throw Error("remote owner retired");};
  assert.equal((await f.session.read()).status, "succeeded");
  assert.equal((await f.session.cancel()).status, "succeeded");
  assert.equal(await f.session.settle(), false); assert.deepEqual(f.calls, calls);
  f.workerClosed = true; assert.equal(await f.session.settle(), true); assert.equal(f.releases, 1);
  assert.equal(await f.session.settle(), true); assert.equal(f.workerRetirements, 3);
  assert.deepEqual(f.calls, calls);
});

test("cache-only mode precedes the first local retirement await and retains original methods", async () => {
  const f = fixture(); let release!: (closed: boolean) => void, entered!: () => void;
  const observed = new Promise<void>(resolve => {entered = resolve;});
  f.retireHook = () => {entered(); return new Promise<boolean>(resolve => {release = resolve;});};
  await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  f.channel.retireOriginalWorker = async () => {throw Error("replacement must not run");};
  const retiring = f.session.settle(); await observed;
  try {
    const calls = [...f.calls]; assert.equal(await f.session.settle(), false);
    assert.equal((await f.session.read()).status, "succeeded"); await f.session.cancel();
    assert.deepEqual(f.calls, calls); assert.equal(f.releases, 0);
  } finally {release(true);}
  assert.equal(await retiring, true); assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 1);
});

test("lost remote retirement cannot request worker termination", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  f.hook = action => {if (action === "settle") throw Error("lost acknowledgement");};
  assert.equal(await f.session.settle(), false); assert.equal(await f.session.settle(), false);
  assert.equal(f.workerRetirements, 0); assert.equal(f.releases, 0);
});

test("positive no-effect preparation releases its unused worker claim without stopping it", async () => {
  const f = fixture(); f.hook = action => action === "prepare" ? {binding, phase: "unavailable"} : undefined;
  assert.equal(await f.session.prepare(), "unavailable"); assert.equal(f.unusedReleases, 1);
  assert.equal(f.workerRetirements, 0); assert.equal(f.releases, 1);
  assert.equal(await f.session.settle(), true); assert.equal(f.workerRetirements, 0);
});

test("uncertain unused-claim release cannot release the foundation reservation", async () => {
  const f = fixture(); f.channel.releaseUnusedWorker = () => {throw Error("original claim changed");};
  f.hook = action => action === "prepare" ? {binding, phase: "unavailable"} : undefined;
  assert.equal(await f.session.prepare(), "unconfirmed"); assert.equal(f.releases, 0);
});

for (const result of ["false", "pending", "rejected"] as const) test(`unused release requires synchronous acknowledgement (${result})`, async () => {
  const f = fixture(); f.channel.releaseUnusedWorker = () => {
    if (result === "false") return false;
    if (result === "rejected") return Promise.reject(Error("private release failed"));
    return new Promise<void>(() => {});
  };
  f.hook = action => action === "prepare" ? {binding, phase: "unavailable"} : undefined;
  assert.equal(await f.session.prepare(), "unconfirmed"); assert.equal(f.releases, 0); assert.equal(f.workerRetirements, 0);
});

test("missing original local ownership cannot fall back to authenticated HTTP", async () => {
  const f = fixture(); f.channel.retireOriginalWorker = undefined as never;
  assert.equal(await f.session.prepare(), "unconfirmed"); assert.deepEqual(f.calls, []); assert.equal(f.releases, 0);
});

test("unknown local retirement is observed later without repeating remote cleanup", async () => {
  const f = fixture(); await f.session.prepare(); await f.session.start(staged(), () => true); f.status = "succeeded";
  f.retireHook = async () => {throw Error("lost original close observation");};
  assert.equal(await f.session.settle(), false); const calls = [...f.calls]; assert.equal(f.releases, 0);
  f.retireHook = async () => true; assert.equal(await f.session.settle(), true);
  assert.deepEqual(f.calls, calls); assert.equal(f.releases, 1);
});

test("HTTP capture uses its own capability; serialized readiness cannot configure it", async () => {
  const calls: string[] = [];
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: "synthetic-token-".padEnd(40, "x"),
    captureProcessOwnership: () => () => {}, fetchImplementation: (async url => {
      const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
      return Response.json(endpoint === "/health" ? {healthy: true, status: {...runtime, status: "ready"}} :
        {runtimeId: runtime.runtimeId, capabilities: ["train-model", "nativeReady"]});
    }) as typeof fetch});
  await assert.rejects(() => client.captureOriginalTrainingChannel(profile)); assert.deepEqual(calls, ["/health", "/capabilities"]);
});

test("HTTP final start fence runs after credential callback and never discards a valid accepted reply", async () => {
  let admission = true, hook = () => {}, dispatches = 0;
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationTokenProvider: () => {hook(); return "synthetic-token-".padEnd(40, "x");},
    captureProcessOwnership: () => () => {}, fetchImplementation: (async url => {
      const endpoint = new URL(String(url)).pathname;
      if (endpoint === "/health") return Response.json({healthy: true, status: {...runtime, status: "ready"}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
      dispatches++; admission = false;
      return Response.json({binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"});
    }) as typeof fetch});
  const channel = await client.captureOriginalTrainingChannel(profile);
  hook = () => {admission = false;};
  await assert.rejects(() => channel.send(`/training/original/${id}/start`, {binding}, () => assert.equal(admission, true)));
  assert.equal(dispatches, 0); hook = () => {}; admission = true;
  assert.equal((await channel.send(`/training/original/${id}/start`, {binding}, () => assert.equal(admission, true)) as any).kind, "accepted");
  assert.equal(dispatches, 1);
});
test("HTTP capture retains original methods and receivers before health awaits", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  let replacements = 0, capabilityCalls = 0;
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: "synthetic-token-".padEnd(40, "x"),
    captureProcessOwnership: () => () => {}, fetchImplementation: (async url => {
      if (String(url).endsWith("/health")) {await gate; return Response.json({healthy: true, status: {...runtime, status: "ready"}});}
      capabilityCalls++; return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    }) as typeof fetch});
  const captured = client.captureOriginalTrainingChannel(profile);
  client.getCapabilities = async () => {replacements++; throw Error("replaced capability method");}; release();
  assert.deepEqual((await captured).identity, identity); assert.equal(replacements, 0); assert.equal(capabilityCalls, 1);
});

test("foundation reserves before installed startup and retains uncertainty through an actual worker-exit event", async () => {
  let installed = 0, prepared = 0, alive = false;
  const controller = inertNativeController(() => {alive = true;}), child = controller.child;
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === "/health") return Response.json(alive ? {healthy: true, status: {...runtime, status: "ready"}} : {healthy: false, status: {...runtime, status: "stopped"}}, {status: alive ? 200 : 401});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    throw Error("synthetic lost prepare acknowledgement");
  }) as typeof fetch}, supervisor: {...controller.configuration, startupTimeoutMs: 200, healthCheckIntervalMs: 1,
    verifyRuntimeEnvironment: async () => {installed++; return true;}, prepareRuntimeEnvironment: async () => {prepared++;},
  }});
  foundation.bindHostAdmission(() => {});
  assert.equal(foundation.createApprovedTrainingPort().createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  const port = foundation.createApprovedTrainingPort(profile);
  const session = port.createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true})!;
  assert.equal(installed, 0); await assert.rejects(() => foundation.runtimePort.startTask({requestId: "sibling", taskType: "train-model", payload: {}}));
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(prepared, 0); assert.equal(installed, 1);
  alive = false; child.emit("exit", 0, "SIGTERM");
  await assert.rejects(() => foundation.runtimePort.startTask({requestId: "sibling-after-exit", taskType: "train-model", payload: {}}));
  assert.equal(await session.settle(), false); assert.equal(port.createSession({...definition(), requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  child.stdout.destroy(); child.stderr.destroy();
});

/** This controller is a transport fake; it supplies no native qualification. */
function inertNativeController(resumed: () => void) {
  const child = new EventEmitter() as EventEmitter & {stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean};
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => {throw Error("ordinary controller kill is forbidden");};
  let boot: any, stops = 0, starts = 0, resumes = 0;
  let sourceSequence = 0, closed = false, closePending = false;
  const sourcePhases: string[] = [];
  const frame = (kind: string, fields: Record<string, unknown> = {}) => child.stdout.write(JSON.stringify({
    schema: "windows-original-worker-control-v1", nonce: boot.nonce, profileDigest: boot.profileDigest, kind, ...fields}) + "\n");
  const definitionParts: Buffer[] = [];
  const sourceRequest = (phase: string, index?: number) => queueMicrotask(() => {sourcePhases.push(phase); frame("source-request", {
    sequence: ++sourceSequence, phase, definitionDigest: boot.modelSource.definitionDigest, amount: boot.modelSource.maximumCopyBytes,
    ...(phase === "definition" ? {index} : {})});});
  const finishResume = () => {
    resumed(); frame("running");
    frame("worker-output", {lane: "stdout", data: Buffer.from(OWNED_RUNTIME_READY_PREFIX + boot.environment.PYTHON_RUNTIME_STARTUP_PROOF +
      " 127.0.0.1:" + boot.environment.PYTHON_RUNTIME_PORT + "\n").toString("base64")});
  };
  const close = () => {if (closed) return; closed = true; frame("retired"); child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);};
  child.stdin.on("data", data => {
    const value = JSON.parse(data.toString());
    if (value.schema === "windows-original-worker-launch-v1") {boot = value; queueMicrotask(() => frame("suspended")); return;}
    if (value.schema === "windows-original-worker-launch-v2") {boot = value; sourceRequest("charge"); return;}
    if (value.schema === "windows-original-worker-launch-v3") {boot = value; sourceRequest("definition", 0); return;}
    assert.equal(value.nonce, boot.nonce); assert.equal(value.profileDigest, boot.profileDigest);
    if (value.schema === "windows-original-model-definition-v1") {
      assert.equal(value.sequence, sourceSequence); assert.equal(value.index, definitionParts.length);
      assert.equal(value.totalBytes, boot.definitionByteCount); definitionParts.push(Buffer.from(value.data, "base64"));
      if (value.final) {assert.equal(Buffer.concat(definitionParts).length, boot.definitionByteCount); sourceRequest("charge");}
      else sourceRequest("definition", definitionParts.length);
      return;
    }
    if (value.schema === "windows-original-model-ack-v1") {
      assert.equal(value.sequence, sourceSequence); assert.equal(value.definitionDigest, boot.modelSource.definitionDigest);
      if (value.phase === "charge") sourceRequest("allocate");
      else if (value.phase === "allocate" || value.phase === "copy" && sourcePhases.filter(p => p === "copy").length < boot.modelSource.files.length)
        sourceRequest("copy");
      else if (value.phase === "copy") sourceRequest("seal");
      else if (value.phase === "seal") sourceRequest("create");
      else if (value.phase === "create") queueMicrotask(() => frame("suspended"));
      else if (value.phase === "dispatch") queueMicrotask(finishResume);
      else {assert.equal(value.phase, "retain"); if (closePending) queueMicrotask(close);}
      return;
    }
    if (value.action === "resume") {resumes++; queueMicrotask(() => {
      if (boot.modelSource) sourceRequest("dispatch"); else finishResume();
    });}
    else {assert.equal(value.action, "stop"); stops++;}
  });
  const configuration = {command: process.execPath, cwd: path.resolve(__dirname, "../worker"),
    nativePlatform: () => ({platform: "win32" as const, arch: "x64"}),
    nativeWorkerResourceProfile: {schema: "windows-original-worker-job-v1" as const, profileId: "inert-source-only",
      processMemoryBytes: 64 * 1024 * 1024, jobMemoryBytes: 128 * 1024 * 1024,
      maximumActiveProcesses: 1, maximumDurationMs: 30_000, observationMs: 30},
    spawnImplementation: (() => {starts++; return child;}) as never};
  return {child, configuration, get starts() {return starts;}, get resumes() {return resumes;}, get stops() {return stops;},
    get boot() {return boot;}, sourcePhases, frame,
    closeWithoutProof() {if (closed) return; closed = true; child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);},
    closeWithProof() {if (closed) return; if (boot.modelSource) {closePending = true; sourceRequest("retain");} else close();}};
}

async function observationFoundation(t: TestContext, expectedIntegrityLoss = false) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "training-source-foundation-")));
  const before = await lstat(directory, {bigint: true}), model = path.join(directory, "model"); await mkdir(model);
  for (const name of ["config.json", "tokenizer.json", "model.safetensors"]) await writeFile(path.join(model, name), "synthetic source, never loaded");
  let alive = false, modelReads = 0; const calls: string[] = [];
  const controller = inertNativeController(() => {alive = true;});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async url => {
    const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
    if (endpoint === "/health") return Response.json({healthy: alive, status: {...runtime, status: "ready"}});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    assert.equal(endpoint, "/training/original/prepare"); return Response.json({binding, phase: "unavailable"});
  }) as typeof fetch}, supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => true,
    startupTimeoutMs: 200, healthCheckIntervalMs: 1}});
  foundation.bindHostAdmission(() => {});
  const port = foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [directory], maximumTotalBytes: 1024,
    maximumDurationMs: 5_000, bufferBytes: 8});
  const selected = definition(); (selected.request.baseModel as any).localPath = model;
  const reader = {async read() {assert.equal(this, reader); if (modelReads < 3) assert.equal(controller.starts, 0); modelReads++;
    return {modelRecordId: selected.request.baseModel.modelRecordId!, modelUpdatedAt: selected.modelUpdatedAt, localModelReference: model};}};
  t.after(async () => {
    if (controller.starts) {
      const stopped = foundation.supervisor.stop();
      const observed = expectedIntegrityLoss ? assert.rejects(stopped) : stopped;
      await new Promise(resolve => setImmediate(resolve));
      if (expectedIntegrityLoss) controller.closeWithoutProof(); else controller.closeWithProof();
      await observed;
    }
    const current = await lstat(directory, {bigint: true}); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, before.dev); assert.equal(current.ino, before.ino); assert.equal(await realpath(directory), directory);
    assert.equal(path.dirname(directory), boundary); await rm(directory, {recursive: true});
  });
  return {model, calls, controller, foundation, port, selected, reader, get modelReads() {return modelReads;}};
}

test("configured foundation observes the original selected Model before installed worker startup", async t => {
  const f = await observationFoundation(t);
  const session = f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!;
  assert.equal(f.controller.starts, 0); assert.equal(f.modelReads, 0);
  assert.equal(await session.prepare(), "unavailable"); assert.equal(f.modelReads, 3);
  assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1);
  assert.equal(f.calls.filter(endpoint => endpoint === "/training/original/prepare").length, 1);
  // Positive no-producer response joins already closed observation IO and the
  // existing unused worker claim; it supplies no source-copy/native pass.
  const next = f.port.createSession({...f.selected, requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}, f.reader);
  assert.ok(next); assert.equal(await next.settle(), true);
});

test("configured foundation refuses a missing Model reader before reserving or starting", async t => {
  const f = await observationFoundation(t);
  assert.equal(f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  const next = f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader);
  assert.ok(next); assert.equal(await next.settle(), true);
  assert.equal(f.controller.starts, 0); assert.equal(f.modelReads, 0); assert.deepEqual(f.calls, []);
});

test("foundation awaits the actual original shared-budget debit before installed source startup", {timeout: 3000}, async t => {
  const f = await observationFoundation(t), documents = createInMemoryStructuredDocumentStore(), calls: string[] = [];
  const policy = {poolId: "synthetic-foundation-copy-budget", profileFingerprint: profile.profileFingerprint,
    maximumBytes: 524_288, maximumOrganizationBytes: 524_288, maximumPrincipalBytes: 524_288,
    maximumReservations: 1, maximumOrganizationReservations: 1, maximumPrincipalReservations: 1};
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const namespace = "model/training/storage-budget/pools-v1", poolKey = hash([policy.poolId]);
  await documents.writeDocument(namespace, poolKey, {schema: "training-storage-budget-pool-v1",
    policyDigest: "sha256:" + hash(policy), reservedBytes: 0, reservationCount: 0, organizations: []}, {expectedRevision: 0});
  const budget = createStructuredTrainingStorageBudget({documents, policy, authorize: async () => true});
  let entered!: () => void, finish!: () => void, factories = 0;
  const issued = new Promise<void>(done => {entered = done;}), held = new Promise<void>(done => {finish = done;});
  const shared = {async reserve(...args: Parameters<typeof budget.reserve>) {
    assert.equal(f.controller.starts, 0); const result = await budget.reserve(...args); calls.push("budget-committed"); entered(); await held; return result;
  }};
  const factory: OriginalTrainingSourceReservationFactory = async (original, observed) => {
    factories++;
    const directory = path.dirname(f.model), slot = (freshName: string, maximumCopyBytes: number) =>
      ({freshParent: directory, freshName, maximumCopyBytes, bufferBytes: 4096, preparationMs: 5000});
    const token = bindOriginalTrainingCopyReservations(original, observed, {modelCopy: slot("async-model-copy", 65_536),
      maximumInputCopyBytes: 65_536, maximumWorkerOutputBytes: 131_072, maximumParentOutputBytes: 131_072,
      storageOverheadBytes: 4096, maximumReservedBytes: 524_288}, {
      assertCurrent() {}, async chargeCopy(role) {assert.equal(f.controller.starts, 1); calls.push("charge:" + role);},
      async retainCopy(role) {calls.push("retain:" + role);},
    }, shared);
    bindOriginalTrainingWorkerConfiguration(token, {profileFingerprint: profile.profileFingerprint,
      inputCopy: slot("async-inputs-copy", 65_536), outputFamily: {maximumCopyBytes: 131_072, outputs: [slot("async-worker-final", 131_072)]}});
    await prepareOriginalTrainingSharedStorageBudget(token); calls.push("budget-acknowledged");
    return originalTrainingModelCopyReservation(token);
  };
  const port = f.foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [path.dirname(f.model)],
    maximumTotalBytes: 1024, maximumDurationMs: 1000, bufferBytes: 8}, factory);
  const session = port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!, preparing = session.prepare();
  try {
    await issued; assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []); assert.deepEqual(calls, ["budget-committed"]);
    assert.equal((await documents.readDocument<{reservedBytes: number}>(namespace, poolKey))!.value.reservedBytes, 524_288);
    finish(); assert.equal(await preparing, "unavailable", "The inert peer still has no full native producer.");
    assert.equal(factories, 1); assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1);
    assert.deepEqual(calls, ["budget-committed", "budget-acknowledged", "charge:overhead", "charge:inputs", "charge:worker-output", "charge:parent-output", "charge:model"]);
    assert.equal(f.controller.boot.modelSource.schema, "windows-original-model-graph-v2");
    assert.equal(f.calls.filter(row => row === "/training/original/prepare").length, 1);
  } finally {finish(); await preparing;}
});

for (const mode of ["stop", "permission-loss", "model-change", "deadline", "rejection"] as const)
  test(`foundation pending async source preparation ${mode} cannot start or release an original worker`, {timeout: 3000}, async t => {
    const f = await observationFoundation(t); let caller = true, factories = 0, charges = 0, entered!: () => void, finish!: () => void;
    const issued = new Promise<void>(done => {entered = done;}), held = new Promise<void>(done => {finish = done;});
    const factory: OriginalTrainingSourceReservationFactory = async () => {
      factories++; entered(); await held;
      if (mode === "rejection") throw Error("synthetic private preparation rejection");
      return {configuration: {freshParent: path.dirname(f.model), freshName: "async-copy", maximumCopyBytes: 65_536, bufferBytes: 4096, preparationMs: 5000},
        assertCurrent() {}, async chargeSourceCopy() {charges++;}, async retainSourceCopy() {}};
    };
    const observation = {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024,
      maximumDurationMs: mode === "deadline" ? 100 : 1000, bufferBytes: 8};
    const port = f.foundation.createApprovedTrainingPort(profile, observation, factory);
    const session = port.createSession(f.selected, {isCurrent: () => caller, stillAllowed: async () => caller}, f.reader)!, preparing = session.prepare();
    try {
      await issued; assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []);
      if (mode === "stop") await assert.rejects(session.cancel());
      if (mode === "permission-loss") caller = false;
      if (mode === "model-change") (f.selected as {modelUpdatedAt: string}).modelUpdatedAt = "2026-11-26T00:00:00Z";
      if (mode !== "deadline") finish();
      assert.equal(await preparing, "unconfirmed"); assert.equal(await session.settle(), false);
      finish(); await new Promise(done => setImmediate(done));
      assert.equal(f.controller.starts, 0); assert.equal(charges, 0); assert.equal(factories, 1); assert.deepEqual(f.calls, []);
      await assert.rejects(session.prepare());
      assert.equal(port.createSession({...f.selected, requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}, f.reader), undefined);
    } finally {finish(); await preparing;}
  });

test("foundation refuses non-native async substitutes without assimilating thenables or leaking rejected replies", async t => {
  for (const kind of ["thenable", "sync-promise", "invalid-owner"] as const) {
    const f = await observationFoundation(t); let thenCalls = 0, factories = 0;
    const factory: OriginalTrainingSourceReservationFactory = kind === "invalid-owner" ? (async () => {factories++; return undefined as never;}) :
      (() => {factories++; return kind === "sync-promise" ? Promise.reject(Error("synthetic private source reply")) : {then() {thenCalls++;}};}) as never;
    const port = f.foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024,
      maximumDurationMs: 1000, bufferBytes: 8}, factory);
    const session = port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!;
    assert.equal(await session.prepare(), "unconfirmed"); await new Promise(done => setImmediate(done));
    assert.equal(thenCalls, 0); assert.equal(factories, 1); assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []);
    assert.equal(await session.settle(), false);
  }
});

test("foundation refuses proxy and foreign-realm async source factories before invocation", async t => {
  const f = await observationFoundation(t); let invoked = 0;
  const foreign = runInNewContext("(async function () { invoke(); return {}; })", {invoke() {invoked++;}});
  const proxy = new Proxy(() => {invoked++; return {} as never;}, {apply() {invoked++; throw Error("must not call proxy");}});
  for (const factory of [foreign, proxy]) assert.throws(() => f.foundation.createApprovedTrainingPort(profile,
    {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024, maximumDurationMs: 1000, bufferBytes: 8}, factory));
  assert.equal(invoked, 0); assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []);
});

test("failed source observation retains original foundation reservation without controller fallback", async t => {
  const f = await observationFoundation(t); await writeFile(path.join(f.model, "unexpected.txt"), "synthetic");
  const session = f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []);
  assert.equal(await session.settle(), false);
  assert.equal(f.port.createSession({...f.selected, requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}, f.reader), undefined);
});

test("foundation source launch carries actual observation and retains charged copy after requester withdrawal", async t => {
  const f = await observationFoundation(t), calls: string[] = []; let caller = true;
  const factory: OriginalTrainingSourceReservationFactory = (original, observed) => {
    assert.equal(original.definition.request.baseModel.localPath, f.model); assert.equal(observed.logicalPath, f.model);
    assert.equal(observed.files.length, 3); assert.equal(f.controller.starts, 0);
    const owner: OriginalTrainingSourceReservation = {configuration: {freshParent: path.dirname(f.model), freshName: "protected-copy",
      maximumCopyBytes: 65_536, bufferBytes: 4096, preparationMs: 5000},
      assertCurrent() {assert.equal(this, owner);}, async chargeSourceCopy(bytes) {assert.equal(this, owner); assert.equal(bytes, 65_536); calls.push("charge");},
      async retainSourceCopy(bytes) {assert.equal(this, owner); assert.equal(bytes, 65_536); calls.push("retain");}};
    return owner;
  };
  const port = f.foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024,
    maximumDurationMs: 5000, bufferBytes: 8}, factory);
  const before = JSON.stringify(f.selected), session = port.createSession(f.selected, {isCurrent: () => caller, stillAllowed: async () => caller}, f.reader)!;
  // The full producer remains absent: source copying cannot claim training ready.
  assert.equal(await session.prepare(), "unavailable"); assert.deepEqual(calls, ["charge"]);
  assert.equal(f.controller.boot.schema, "windows-original-worker-launch-v3");
  assert.equal(f.controller.boot.modelSource.logicalPath, f.model); assert.equal(f.controller.boot.modelSource.modelId, "base");
  assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1);
  assert.equal(JSON.stringify(f.selected), before);
  caller = false;
  const stopping = f.foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve));
  f.controller.closeWithProof(); await stopping;
  assert.deepEqual(calls, ["charge", "retain"]);
  assert.deepEqual(f.controller.sourcePhases, ["definition", "charge", "allocate", "copy", "copy", "copy", "seal", "create", "dispatch", "retain"]);
  assert.equal(f.controller.stops, 1);
});

for (const mode of ["success", "permission-loss", "unknown-charge", "late-role-failure", "model-charge-failure", "timeout"] as const)
  test(`foundation copy-role preparation ${mode} gates Model copy and worker creation`, async t => {
    const f = await observationFoundation(t, mode !== "success"), calls: string[] = [];
    let caller = true, entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => {entered = resolve;});
    const held = new Promise<void>(resolve => {release = resolve;});
    t.after(release);
    const factory: OriginalTrainingSourceReservationFactory = (original, observed) => {
      assert.equal(f.controller.starts, 0);
      const token = bindOriginalTrainingCopyReservations(original, observed, {
        modelCopy: {freshParent: path.dirname(f.model), freshName: "role-startup", maximumCopyBytes: 65_536,
          // Exercise the copy deadline before the inert controller's 30 ms guard.
          bufferBytes: 4096, preparationMs: mode === "timeout" ? 5 : 5000},
        maximumInputCopyBytes: 65_536, maximumWorkerOutputBytes: 131_072,
        maximumParentOutputBytes: 131_072, storageOverheadBytes: 4096, maximumReservedBytes: 524_288,
      }, {
        assertCurrent() {},
        async chargeCopy(role) {
          calls.push("charge:" + role);
          if (role === "overhead") {entered(); await held; if (mode === "unknown-charge") throw Error("Synthetic lost charge acknowledgement");}
          assert.equal(f.controller.starts, 1);
          if (mode === "late-role-failure" && role === "worker-output" || mode === "model-charge-failure" && role === "model")
            throw Error("Synthetic lost later charge acknowledgement");
        },
        async retainCopy(role) {calls.push("retain:" + role);},
      });
      return originalTrainingModelCopyReservation(token);
    };
    const port = f.foundation.createApprovedTrainingPort(profile, {
      allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024, maximumDurationMs: 5000, bufferBytes: 8,
    }, factory);
    const session = port.createSession(f.selected, {isCurrent: () => caller, stillAllowed: async () => caller}, f.reader)!;
    const preparing = session.prepare();
    try {
      await Promise.race([reached, preparing.then(() => {throw Error("Startup ended before original role precharges were reached");})]);
      assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 0); assert.deepEqual(f.calls, []);
        assert.equal(f.controller.sourcePhases.some(x => ["allocate", "copy", "seal", "create", "dispatch"].includes(x)), false);
      assert.deepEqual(calls, ["charge:overhead"]);
      if (mode === "permission-loss") caller = false;
      if (mode !== "timeout") release();
      assert.equal(await preparing, mode === "success" ? "unavailable" : "unconfirmed");
      if (mode === "success") {
        assert.deepEqual(calls, ["charge:overhead", "charge:inputs", "charge:worker-output", "charge:parent-output", "charge:model"]);
        assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1);
        // Source launch is real software wiring; the inert peer supplies no producer/training pass.
        assert.equal(f.calls.filter(x => x === "/training/original/prepare").length, 1);
        caller = false;
        const stopped = f.foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve));
        f.controller.closeWithProof(); await stopped;
        assert.equal(calls[calls.length - 1], "retain:model");
      } else {
        assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 0); assert.deepEqual(f.calls, []);
        assert.equal(f.controller.sourcePhases.some(x => ["allocate", "copy", "seal", "create", "dispatch"].includes(x)), false);
        const expected = mode === "late-role-failure" ? ["charge:overhead", "charge:inputs", "charge:worker-output"] :
          mode === "model-charge-failure" ? ["charge:overhead", "charge:inputs", "charge:worker-output", "charge:parent-output", "charge:model"] : ["charge:overhead"];
        assert.deepEqual(calls, expected); assert.equal(await session.settle(), false);
        assert.equal(port.createSession({...f.selected, requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}, f.reader), undefined);
        release(); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, expected); assert.equal(f.controller.starts, 1);
      }
    } finally {release(); await preparing;}
  });

test("source-bound startup cannot adopt an existing source-free worker", async t => {
  const f = await observationFoundation(t);
  assert.equal(await f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!.prepare(), "unavailable");
  let factories = 0, charges = 0;
  const port = f.foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024,
    maximumDurationMs: 5000, bufferBytes: 8}, () => {factories++; return {configuration: {freshParent: path.dirname(f.model), freshName: "fresh",
      maximumCopyBytes: 65_536, bufferBytes: 4096, preparationMs: 5000}, assertCurrent() {}, async chargeSourceCopy() {charges++;}, async retainSourceCopy() {}};});
  const selected = {...f.selected, requestId: workspace};
  const reader = {async read() {return {modelRecordId: "base", modelUpdatedAt: selected.modelUpdatedAt, localModelReference: f.model};}};
  const session = port.createSession(selected, {isCurrent: () => true, stillAllowed: async () => true}, reader)!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(factories, 1); assert.equal(charges, 0);
  assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1); assert.equal(await session.settle(), false);
});

test("original controller rejects replayed source requests before another charge and does not invent retirement", async t => {
  const f = await observationFoundation(t, true); let charges = 0, retained = 0;
  const port = f.foundation.createApprovedTrainingPort(profile, {allowedRootDirectories: [path.dirname(f.model)], maximumTotalBytes: 1024,
    maximumDurationMs: 5000, bufferBytes: 8}, () => ({configuration: {freshParent: path.dirname(f.model), freshName: "one-copy",
      maximumCopyBytes: 65_536, bufferBytes: 4096, preparationMs: 5000}, assertCurrent() {},
      async chargeSourceCopy() {charges++;}, async retainSourceCopy() {retained++;}}));
  const session = port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!;
  assert.equal(await session.prepare(), "unavailable"); assert.equal(charges, 1);
  const source = f.controller.boot.modelSource;
  f.controller.frame("source-request", {sequence: 1, phase: "charge", definitionDigest: source.definitionDigest, amount: source.maximumCopyBytes});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.foundation.supervisor.getStatus(), "failed"); assert.equal(charges, 1); assert.equal(retained, 0);
  assert.equal(f.controller.starts, 1); assert.equal(f.controller.resumes, 1);
});

for (const loss of ["permission", "currentness"] as const) test(`foundation originating ${loss} loss during installed verification prevents controller startup`, async () => {
  let permission = true, current = true, probes = 0, http = 0, installers = 0;
  const controller = inertNativeController(() => {throw Error("no resume permitted");});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111",
    fetchImplementation: (async () => {http++; throw Error("no HTTP permitted");}) as typeof fetch},
    supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => {
      probes++; if (loss === "permission") permission = false; else current = false; return true;
    }, prepareRuntimeEnvironment: async () => {installers++;}}});
  foundation.bindHostAdmission(() => {});
  const port = foundation.createApprovedTrainingPort(profile);
  const session = port.createSession(definition(), {isCurrent: () => current, stillAllowed: async () => permission})!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(probes, 1);
  assert.equal(controller.starts, 0); assert.equal(controller.resumes, 0); assert.equal(http, 0); assert.equal(installers, 0);
  permission = current = true;
  assert.equal(await session.settle(), false); assert.equal(port.createSession({...definition(), requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  controller.child.stdout.end(); controller.child.stderr.end();
});

test("foundation withdrawal after suspension prevents resume and retains original custody", async () => {
  let permission = true, http = 0;
  const controller = inertNativeController(() => {throw Error("no resume permitted");});
  controller.child.stdin.on("data", data => {if (JSON.parse(data.toString()).schema === "windows-original-worker-launch-v1") permission = false;});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111",
    fetchImplementation: (async () => {http++; throw Error("no HTTP permitted");}) as typeof fetch},
    supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => true}});
  foundation.bindHostAdmission(() => {}); const port = foundation.createApprovedTrainingPort(profile);
  const session = port.createSession(definition(), {isCurrent: () => true, stillAllowed: async () => permission})!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(controller.starts, 1); assert.equal(controller.resumes, 0); assert.equal(http, 0);
  permission = true; assert.equal(await session.settle(), false);
  assert.equal(port.createSession({...definition(), requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  const stopping = foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve));
  controller.closeWithProof(); await stopping; assert.equal(controller.stops, 1);
  assert.equal(await session.settle(), false); // Actual worker close alone cannot invent remote/source settlement.
});

for (const lossAt of ["startup health", "channel capabilities"] as const) test(`foundation permission loss during ${lossAt} cannot publish a prepared task`, async () => {
  let permission = true, alive = false; const calls: string[] = [];
  const controller = inertNativeController(() => {alive = true;});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111",
    fetchImplementation: (async url => {
      const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
      if (endpoint === "/health") {
        if (lossAt === "startup health") permission = false;
        return Response.json({healthy: alive, status: {...runtime, status: "ready"}});
      }
      if (endpoint === "/capabilities") {if (lossAt === "channel capabilities") permission = false;
        return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});}
      throw Error("No private task dispatch permitted");
    }) as typeof fetch}, supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => true,
      startupTimeoutMs: 200, healthCheckIntervalMs: 1}});
  foundation.bindHostAdmission(() => {}); const port = foundation.createApprovedTrainingPort(profile);
  const session = port.createSession(definition(), {isCurrent: () => true, stillAllowed: async () => permission})!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(controller.resumes, 1);
  assert.equal(calls.some(endpoint => endpoint.startsWith("/training/")), false);
  if (lossAt === "startup health") assert.equal(foundation.supervisor.getStatus(), "failed");
  permission = true; assert.equal(await session.settle(), false);
  const stopping = foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve));
  controller.closeWithProof(); await stopping; assert.equal(controller.stops, 1);
  assert.equal(port.createSession({...definition(), requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}), undefined);
});

test("successful startup leaves later worker retirement independent of ended request permission", async () => {
  let permission = true, alive = false;
  const controller = inertNativeController(() => {alive = true;});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111",
    fetchImplementation: (async url => {
      const endpoint = new URL(String(url)).pathname;
      if (endpoint === "/health") return Response.json({healthy: alive, status: {...runtime, status: "ready"}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
      assert.equal(endpoint, "/training/original/prepare"); return Response.json({binding, phase: "ready"});
    }) as typeof fetch}, supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => true,
      startupTimeoutMs: 200, healthCheckIntervalMs: 1}});
  foundation.bindHostAdmission(() => {});
  const session = foundation.createApprovedTrainingPort(profile).createSession(definition(), {isCurrent: () => true, stillAllowed: async () => permission})!;
  assert.equal(await session.prepare(), "ready"); permission = false;
  assert.equal((await session.start(staged(), () => true)).kind, "unconfirmed"); // Business policy remains independent.
  const stopping = foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve));
  controller.closeWithProof(); await stopping; assert.equal(controller.stops, 1);
  assert.equal(await session.settle(), false); // No invented remote/source settlement.
});

test("foundation denies private training without native configuration before any ordinary startup", () => {
  let calls = 0;
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111",
    fetchImplementation: (async () => {calls++; throw Error("no HTTP");}) as typeof fetch},
    supervisor: {command: "inert", verifyRuntimeEnvironment: async () => {calls++; return true;},
      spawnImplementation: (() => {calls++; throw Error("no ordinary fallback");}) as never}});
  foundation.bindHostAdmission(() => {});
  assert.equal(foundation.createApprovedTrainingPort(profile).createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true}), undefined);
  assert.equal(calls, 0);
});

function retirementFoundation(exitConfiguration?: OriginalTrainingExitConfiguration) {
  let alive = false, taskStatus = "running", preparePhase = "ready";
  let hostLive = true, download: (() => Promise<void>) | undefined;
  const calls: string[] = [];
  const controller = inertNativeController(() => {alive = true;}), child = controller.child;
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async (url, init) => {
    const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
    if (endpoint === "/health") return Response.json({healthy: alive, status: {...runtime, status: alive ? "ready" : "stopped"}});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId,
      capabilities: [exitConfiguration ? "train-model.original-exit-ready-v1" : ORIGINAL_TRAINING_CAPABILITY]});
    if (endpoint === "/tasks/start" && JSON.parse(String(init?.body)).taskType === "ensure-model-download") {
      await download?.(); throw Error("inert download response ended");
    }
    const segments = endpoint.split("/"), action = segments[segments.length - 1];
    if (action === "prepare" || action === "seal") return Response.json({binding, phase: action === "prepare" ? preparePhase : "ready"});
    if (action === "start") return Response.json({binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"});
    if (action === "read") return Response.json({binding, record: {requestId: id, taskType: "train-model", status: taskStatus, metadata: {workspaceId: workspace}}});
    if (action === "settle") return Response.json({binding, settled: true, retirement: "settled"});
    if (action === "exit-ready") return Response.json({binding, schema: "original-training-exit-ready-v1", ready: true, retirement: "ready"});
    throw Error("unexpected synthetic endpoint");
  }) as typeof fetch}, supervisor: {...controller.configuration, startupTimeoutMs: 200, healthCheckIntervalMs: 1,
    verifyRuntimeEnvironment: async () => true,
  }});
  foundation.bindHostAdmission(() => {if (!hostLive) throw Error("host stopped");});
  const port = foundation.createApprovedTrainingPort(profile, undefined, undefined, exitConfiguration);
  const create = (requestId = id) => port.createSession({...definition(), requestId}, {isCurrent: () => true, stillAllowed: async () => true});
  return {foundation, child, calls, create, get kills() {return controller.stops;},
    endHost() {hostLive = false;}, set download(value: (() => Promise<void>) | undefined) {download = value;},
    succeed() {taskStatus = "succeeded";}, fail() {taskStatus = "failed";}, unavailable() {preparePhase = "unavailable";},
    exit() {alive = false; child.emit("exit", 0, null);},
    close() {alive = false; controller.closeWithProof();}};
}

test("opt-in Foundation captures the matching exit mode and storage factory, retaining execution through original Job proof", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "parent-exit-foundation-"));
  const publicationId = "c".repeat(32);
  const storage = createFilesystemTrainingResultFileByteStorageAdapter({rootDirectory: directory, publicationId,
    maximumFiles: 4, maximumFileBytes: 1024, maximumTotalBytes: 4096, trackIoRetirement: true});
  const configuration: OriginalTrainingExitConfiguration = {retirementProtocol: "original-exit-ready-v1",
    createOutputStorage(original) {assert.equal(this, configuration); assert.equal(original.definition.requestId, id);
      return {storage, context: {requestId: id, workspaceId: workspace, organizationId: "org" as OrganizationId, principalId: "actor"},
        publicationId, maximumFiles: 4, maximumFileBytes: 1024, maximumTotalBytes: 4096, maximumDurationMs: 1000};}};
  const f = retirementFoundation(configuration);
  t.after(async () => {f.close(); await rm(directory, {recursive: true, force: true});});
  (configuration as any).createOutputStorage = () => {throw Error("replacement must not run");};
  const session = f.create()!; assert.equal(await session.prepare(), "ready");
  assert.equal((await session.start(staged(), () => true)).kind, "accepted");
  f.fail(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await session.settle(), false); assert.equal(f.kills, 1);
  assert.equal(f.calls.filter(endpoint => endpoint.endsWith("/exit-ready")).length, 1);
  assert.equal(f.calls.some(endpoint => endpoint.endsWith("/settle")), false);
  const calls = [...f.calls]; assert.equal((await session.read()).status, "failed"); await session.cancel();
  assert.equal(f.create(workspace), undefined); f.exit(); assert.equal(await session.settle(), false);
  f.close(); assert.equal(await session.settle(), true); assert.equal(f.kills, 1); assert.deepEqual(f.calls, calls);
  const next = f.create(workspace); assert.ok(next); assert.equal(await next.settle(), true);
});

test("Foundation rejects malformed exit configuration before configuration callbacks or startup", () => {
  const f = retirementFoundation(); let getters = 0;
  const configuration = {retirementProtocol: "original-exit-ready-v1", get createOutputStorage() {getters++; throw Error("must not run");}};
  assert.throws(() => f.foundation.createApprovedTrainingPort(profile, undefined, undefined, configuration as never));
  assert.throws(() => f.foundation.createApprovedTrainingPort(profile, undefined, undefined,
    {retirementProtocol: "settled-v1", createOutputStorage() {throw Error("must not run");}} as never));
  assert.equal(getters, 0); assert.deepEqual(f.calls, []);
});

test("foundation composes both original acknowledgements and denies unloading through uncertainty", async () => {
  const f = retirementFoundation(), session = f.create()!;
  assert.equal(await session.prepare(), "ready");
  const before = f.calls.length; await assert.rejects(() => f.foundation.runtimePort.unloadModels());
  assert.equal(f.calls.length, before);
  assert.equal((await session.start(staged(), () => true)).kind, "accepted"); f.succeed();
  assert.equal(await session.settle(), false); assert.equal(f.kills, 1);
  const remoteClosed = [...f.calls]; await assert.rejects(() => f.foundation.runtimePort.unloadModels());
  assert.equal((await session.read()).status, "succeeded"); await session.cancel();
  assert.deepEqual(f.calls, remoteClosed); assert.equal(f.create(workspace), undefined);
  f.exit(); await assert.rejects(() => f.foundation.supervisor.startWithoutInstalling!(),
    /^Error: The configured native Python worker is unavailable\.$/);
  assert.equal(f.create(workspace), undefined); f.close();
  assert.equal(await session.settle(), true); assert.equal(f.kills, 1); assert.deepEqual(f.calls, remoteClosed);
  const next = f.create(workspace); assert.ok(next); assert.equal(await next.settle(), true);
});

test("foundation no-effect preparation disarms the unused supervisor claim without termination", async () => {
  const f = retirementFoundation(); f.unavailable();
  assert.equal(await f.create()!.prepare(), "unavailable"); assert.equal(f.kills, 0);
  const freshOwner = f.foundation.supervisor.captureOriginalWorkerRetirement!(); freshOwner.assertCurrent();
  freshOwner.releaseUnused();
  const next = f.create(workspace); assert.ok(next); assert.equal(await next.settle(), true);
  assert.equal(f.kills, 0); f.close();
});

test("foundation keeps the native launch owner after unused disarm and Stop uses that Job owner", async () => {
  const f = retirementFoundation(); f.unavailable(); assert.equal(await f.create()!.prepare(), "unavailable");
  const stopping = f.foundation.supervisor.stop(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.kills, 1); f.close(); await stopping; assert.equal(f.kills, 1);
});

test("foundation rechecks original host lifetime after native suspension before resume", async () => {
  const f = retirementFoundation();
  f.child.stdin.on("data", data => {if (JSON.parse(data.toString()).schema === "windows-original-worker-launch-v1") f.endHost();});
  assert.equal(await f.create()!.prepare(), "unconfirmed"); assert.equal(f.calls.length, 0);
  const stopping = f.foundation.supervisor.stop(); await new Promise(resolve => setTimeout(resolve, 0));
  f.close(); await stopping; assert.equal(f.kills, 1);
});

test("foundation refuses training while an original direct model download is in flight", async () => {
  const f = retirementFoundation(); await f.foundation.supervisor.startWithoutInstalling!();
  let release!: () => void, entered!: () => void;
  const active = new Promise<void>(resolve => {entered = resolve;});
  f.download = () => {entered(); return new Promise<void>(resolve => {release = resolve;});};
  const pending = f.foundation.runtimePort.ensureModelDownloaded({provider: "transformers", modelId: "inert/model"});
  try {await active; assert.equal(f.create(), undefined);} finally {release();}
  await assert.rejects(pending, /invalid JSON|inert download/);
  const session = f.create(); assert.ok(session); assert.equal(await session.settle(), true); f.close();
});

/** Actual fresh Model bytes; original controller/HTTP remain explicitly inert. */
async function boundedLocalFoundation(t: TestContext, options: {prepare?: "ready" | "unavailable" | "lost";
  storage?: OriginalBoundedLocalTrainingConfiguration["createModelCopy"]; selectionAfterCopy?: () => Promise<void>;
  observeMs?: number; autoRetire?: boolean; output?: boolean; corruptOutput?: boolean;
  outputFactory?: OriginalBoundedLocalTrainingConfiguration["createOutputStorage"];
  holdOutputRead?: () => Promise<void>; holdFinalOutputAck?: () => Promise<void>} = {}) {
  const root = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "local-training-composition-")));
  const original = await lstat(root, {bigint: true}), model = path.join(root, "selected"), staging = path.join(root, "staging");
  await mkdir(model); await mkdir(staging);
  for (const name of ["config.json", "tokenizer.json", "model.safetensors"]) await writeFile(path.join(model, name), "synthetic local Model, never loaded");
  let live = false, permitted = true, copied = false, status = "running", factories = 0, reads = 0, storagePhase = "not-created", cleanupGranted = false;
  let storageOwner: ReturnType<typeof createFilesystemLocalTrainingModelCopyStorage> | undefined;
  let resultOwner: ReturnType<typeof createFilesystemLocalTrainingResultPublication> | undefined;
  let resultIo: TrainingResultFileIoRetirement | undefined;
  let outputFactories = 0, outputAcknowledged = 0;
  const publicationId = "c".repeat(32), outputRoot = path.join(root, "results"); await mkdir(outputRoot);
  const controller = inertNativeController(() => {live = true;});
  // This fixture explicitly supplies the final synthetic retirement frame.
  // The shared controller intentionally leaves it pending for other tests.
  controller.child.stdin.on("data", data => {
    if (JSON.parse(data.toString()).action === "stop" && options.autoRetire !== false) queueMicrotask(() => controller.closeWithProof());
  });
  const startupProfile = createBoundedLocalTrainingStartupProfile({profileId: "bounded-local-inert-composition", maximumDurationSeconds: 30,
    stagingRoot: root, maximumModelBytes: 4096, maximumOutputBytes: 8192, minimumFreeBytes: 1024});
  const localIdentity = {...runtime, profileId: startupProfile.profileId, profileFingerprint: startupProfile.profileFingerprint};
  const localBinding = {...localIdentity, requestId: id, workspaceId: workspace, sessionId: "b".repeat(64)};
  const adapter = ["lora", "qlora"].includes(definition().request.method);
  const outputNames = [adapter ? "adapter_config.json" : "config.json", "tokenizer.json",
    adapter ? "adapter_model.safetensors" : "model.safetensors"];
  const outputValues = [Buffer.from("{}"), Buffer.from("{}"), Buffer.from("synthetic safe result"),
    Buffer.from("{}"), Buffer.from("{}"), Buffer.from("synthetic safe result")];
  const outputFiles = outputValues.map((bytes, fileIndex) => ({fileIndex, groupIndex: Math.floor(fileIndex / 3),
    name: outputNames[fileIndex % 3]!, role: fileIndex < 3 ? "checkpoint" : "candidate", sizeBytes: bytes.length,
    sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex")}));
  const outputFrames: Record<string, unknown>[] = [];
  const frame = (kind: string, fields: object) => outputFrames.push({schema: "original-training-output-delivery-v1",
    sequence: outputFrames.length + 1, kind, ...fields});
  frame("manifest", {taskId: id, files: outputFiles, totalBytes: outputValues.reduce((sum, bytes) => sum + bytes.length, 0)});
  outputValues.forEach((bytes, fileIndex) => {
    frame("data", {fileIndex, offset: 0, data: (options.corruptOutput && fileIndex === 5 ? Buffer.alloc(bytes.length) : bytes).toString("base64")});
    frame("file-eof", {fileIndex, sizeBytes: bytes.length});
  });
  frame("streams-complete", {fileCount: outputFiles.length, totalBytes: outputValues.reduce((sum, bytes) => sum + bytes.length, 0), provisional: true});
  const calls: {endpoint: string; body: any}[] = [];
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === "/health") return Response.json({healthy: live, status: {...runtime, status: "ready"}});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    const body = JSON.parse(String(init?.body)); calls.push({endpoint, body});
    if (endpoint.endsWith("/prepare")) {
      if (options.prepare === "lost") throw Error("synthetic lost private preparation acknowledgement");
      return Response.json({binding: localBinding, phase: options.prepare ?? "ready"});
    }
    if (endpoint.endsWith("/seal")) return Response.json({binding: localBinding, phase: "ready"});
    if (endpoint.endsWith("/start")) return Response.json({binding: localBinding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"});
    if (endpoint.endsWith("/cancel")) return Response.json({binding: localBinding, cancelled: true});
    if (endpoint.endsWith("/settle")) return Response.json({binding: localBinding, settled: true, retirement: "settled"});
    if (endpoint.endsWith("/read")) return Response.json({binding: localBinding, record: {requestId: id, taskType: "train-model", status,
      progress: {step: 1, totalSteps: 1}, metadata: {workspaceId: workspace}, ...(status === "succeeded" ? {data: {runId: id, status}} : {})}});
    if (endpoint.endsWith("/output-read")) {
      await options.holdOutputRead?.();
      return Response.json({binding: localBinding, output: {phase: outputAcknowledged === outputFrames.length ? "complete" : "active",
        acknowledged: outputAcknowledged, frame: outputFrames[outputAcknowledged] ?? null}});
    }
    if (endpoint.endsWith("/output-ack")) {
      assert.equal(body.sequence, outputAcknowledged + 1);
      if (body.sequence === outputFrames.length) await options.holdFinalOutputAck?.();
      outputAcknowledged = body.sequence;
      return Response.json({binding: localBinding, acknowledged: true});
    }
    throw Error("Unexpected synthetic endpoint");
  }) as typeof fetch}, supervisor: {...controller.configuration, verifyRuntimeEnvironment: async () => true,
    startupTimeoutMs: 200, healthCheckIntervalMs: 1}});
  foundation.bindHostAdmission(() => {});
  const configuration: OriginalBoundedLocalTrainingConfiguration = {startupProfile,
    observation: {allowedRootDirectories: [root], maximumTotalBytes: 4096, maximumDurationMs: options.observeMs ?? 5000, bufferBytes: 65536},
    createModelCopy(input) {
      factories++; assert.ok(Object.isFrozen(input)); assert.ok(Object.isFrozen(input.context));
      assert.equal(input.context.requestId, id); assert.equal(input.context.workspaceId, workspace);
      assert.equal(input.context.organizationId, "org"); assert.equal(input.context.principalId, "actor");
      if (options.storage) return options.storage(input);
      storagePhase = "constructing";
      const storage = createFilesystemLocalTrainingModelCopyStorage({rootDirectory: staging, allowedSourceRoots: [root], source: input.source,
        context: input.context, limits: {maximumFiles: 9, maximumFileBytes: 4096, maximumTotalBytes: 4096,
          maximumDurationMs: 5000, minimumFreeBytes: 1024, bufferBytes: 65536}, control: {...input.control,
          async assertCleanupAllowed() {await input.control.assertCleanupAllowed(); cleanupGranted = true;}}});
      storageOwner = storage; storagePhase = "constructed";
      return Object.freeze({...storage, async prepare(context: Parameters<typeof storage.prepare>[0]) {storagePhase = "preparing"; await storage.prepare(context); copied = true; storagePhase = "prepared";}});
    }, ...(options.output || options.outputFactory ? {createOutputStorage(original: OriginalTrainingCapture) {
      outputFactories++;
      if (options.outputFactory) return Reflect.apply(options.outputFactory, configuration, [original]);
      const context = Object.freeze({requestId: original.definition.requestId, workspaceId: original.definition.workspaceId,
        organizationId: createOrganizationId(original.definition.owner.organizationId), principalId: original.definition.owner.principalId});
      const limits = {maximumFiles: 6, maximumFileBytes: 4096, maximumTotalBytes: 8192, minimumFreeBytes: 1024, maximumDurationMs: 5000};
      const publication = createFilesystemLocalTrainingResultPublication({rootDirectory: outputRoot, publicationId, context, limits,
        control: {assertCurrent: () => original.assertCurrent(), assertAllowed: () => original.assertAllowed()}});
      resultOwner = publication;
      const storage = Object.freeze({...publication.storage, captureIoRetirement(input: {readonly publicationId: string}, supplied: Parameters<NonNullable<typeof publication.storage.captureIoRetirement>>[1]) {
        const captured = publication.storage.captureIoRetirement!(input, supplied); resultIo = captured; return captured;
      }});
      return {storage, context, publicationId, maximumFiles: limits.maximumFiles, maximumFileBytes: limits.maximumFileBytes,
        maximumTotalBytes: limits.maximumTotalBytes, maximumDurationMs: limits.maximumDurationMs};
    }} : {})};
  const port = foundation.createBoundedLocalTrainingPort!(configuration), selected = definition();
  (selected.request.baseModel as any).localPath = model;
  const reader = {async read() {reads++; if (copied) await options.selectionAfterCopy?.();
    return {modelRecordId: "base", modelUpdatedAt: selected.modelUpdatedAt, localModelReference: model};}};
  const control = {isCurrent: () => true, stillAllowed: async () => permitted};
  const session = port.createSession(selected, control, reader)!;
  t.after(async () => {
    if (controller.starts) await foundation.supervisor.stop();
    const observed = await lstat(root, {bigint: true}); assert.equal(observed.dev, original.dev); assert.equal(observed.ino, original.ino);
    await rm(root, {recursive: true, force: true});
  });
  return {foundation, configuration, session, selected, port, reader, control, controller, calls, model, staging, outputRoot, outputFiles, outputValues, outputFrames,
    get outputFactories() {return outputFactories;}, get outputAcknowledged() {return outputAcknowledged;},
    get resultOwner() {return resultOwner;}, get resultIo() {return resultIo;},
    get factories() {return factories;}, get reads() {return reads;}, get storagePhase() {return storagePhase;}, get storageState() {return storageOwner?.inspect();}, get cleanupGranted() {return cleanupGranted;}, deny() {permitted = false;}, succeed() {status = "succeeded";}};
}

async function waitForLocalOutput(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(check(), true, "Local output fixture did not reach its expected bounded phase.");
}
const localOutputContext = () => ({requestId: id, workspaceId: workspace, organizationId: createOrganizationId("org"), principalId: "actor"});

test("local output joins real result files to its original session and keeps them through worker retirement", async t => {
  const f = await boundedLocalFoundation(t, {output: true});
  assert.equal(await f.session.prepare(), "ready");
  const packet = f.calls.find(row => row.endpoint.endsWith("/prepare"))!.body;
  assert.equal(packet.outputDelivery, "bounded-local-v1"); assert.equal(f.outputFactories, 1);
  assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
  await waitForLocalOutput(() => f.outputAcknowledged === f.outputFrames.length);
  await new Promise(resolve => setTimeout(resolve, 5)); f.succeed();
  assert.equal((await f.session.read()).status, "succeeded");
  assert.throws(() => f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()));
  assert.equal(await f.session.settle(), true);
  assert.equal(f.resultIo!.inspect().phase, "closed"); assert.equal(f.controller.stops, 1);
  assert.deepEqual(await readdir(f.staging), []);
  const inventory = f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext());
  assert.equal(inventory.files.length, 6);
  for (const file of inventory.files) {
    const bytes = await readFile(path.join(f.outputRoot, "organizations", "org", file.key));
    assert.deepEqual(bytes, f.outputValues[file.fileIndex]); assert.equal("sha256:" + createHash("sha256").update(bytes).digest("hex"), file.expectedSha256);
    assert.equal(file.role, f.outputFiles[file.fileIndex]!.role);
  }
  const count = f.calls.length; assert.equal(await f.session.settle(), true); assert.equal(f.calls.length, count);
  assert.equal((await f.session.read()).status, "succeeded"); assert.equal(f.calls.length, count);
});

test("local output cannot report worker success before its original final acknowledgement returns", async t => {
  let entered = false, release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const f = await boundedLocalFoundation(t, {output: true, holdFinalOutputAck: async () => {entered = true; await held;}});
  try {
    assert.equal(await f.session.prepare(), "ready"); await f.session.start(staged(), () => true);
    await waitForLocalOutput(() => entered); f.succeed();
    const pending = await f.session.read(); assert.equal(pending.status, "running"); assert.equal(pending.data, undefined);
    assert.equal(await f.session.settle(), false); assert.equal(f.controller.stops, 0);
    assert.throws(() => f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()));
    release(); await waitForLocalOutput(() => f.outputAcknowledged === f.outputFrames.length);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await f.session.read()).status, "succeeded"); assert.equal(await f.session.settle(), true);
  } finally {release();}
});

test("local output waits for original worker close proof even after every file is acknowledged", async t => {
  const f = await boundedLocalFoundation(t, {output: true, autoRetire: false});
  assert.equal(await f.session.prepare(), "ready"); await f.session.start(staged(), () => true);
  await waitForLocalOutput(() => f.outputAcknowledged === f.outputFrames.length); await new Promise(resolve => setTimeout(resolve, 5)); f.succeed();
  assert.equal(await f.session.settle(), false); assert.equal(f.controller.stops, 1);
  assert.equal((await readdir(f.staging)).length, 1);
  f.controller.closeWithProof(); assert.equal(await f.session.settle(), true);
  assert.deepEqual(await readdir(f.staging), []); assert.equal(f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()).files.length, 6);
});

for (const prepare of ["unavailable", "lost"] as const) test(`local output ${prepare} preparation retires only its original worker without starting delivery`, async t => {
  const f = await boundedLocalFoundation(t, {output: true, prepare});
  assert.equal(await f.session.prepare(), prepare === "unavailable" ? "unavailable" : "unconfirmed");
  if (prepare === "lost") assert.equal(await f.session.settle(), true);
  assert.equal(f.controller.stops, 1); assert.equal(f.outputAcknowledged, 0); assert.deepEqual(await readdir(f.staging), []);
  assert.equal(f.resultIo!.inspect().phase, "closed"); assert.deepEqual(await readdir(f.outputRoot), []);
  assert.throws(() => f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()));
});

test("local output malformed scope or profile limits refuse before Model copies or worker effects", async t => {
  for (const mode of ["request", "workspace", "organization", "principal", "bytes", "duration", "getter"] as const) {
    let hooks = 0;
    const f = await boundedLocalFoundation(t, {outputFactory(original) {
      const context: any = {...localOutputContext()};
      if (mode === "request") context.requestId = "different";
      if (mode === "workspace") context.workspaceId = "different";
      if (mode === "organization") context.organizationId = "different";
      if (mode === "principal") context.principalId = "different";
      const configuration: any = {storage: {}, context, publicationId: "c".repeat(32), maximumFiles: 6,
        maximumFileBytes: 4096, maximumTotalBytes: mode === "bytes" ? 8193 : 8192, maximumDurationMs: mode === "duration" ? 30001 : 5000};
      if (mode === "getter") Object.defineProperty(configuration, "maximumTotalBytes", {enumerable: true, get() {hooks++; return 1;}});
      return configuration;
    }});
    assert.equal(await f.session.prepare(), "unconfirmed", mode); assert.equal(hooks, 0);
    assert.equal(f.factories, 0); assert.equal(f.reads, 0); assert.equal(f.controller.starts, 0);
    assert.equal(await f.session.settle(), false); await assert.rejects(f.session.prepare());
  }
});

test("local output captures its original factory and refuses declared asynchronous callbacks", async t => {
  const f = await boundedLocalFoundation(t, {output: true}); let hooks = 0;
  assert.throws(() => f.foundation.createBoundedLocalTrainingPort!({...f.configuration,
    createOutputStorage: (async () => {hooks++;}) as never}));
  const bad = {...f.configuration}; Object.defineProperty(bad, "createOutputStorage", {enumerable: true, get() {hooks++; throw Error("must not execute");}});
  assert.throws(() => f.foundation.createBoundedLocalTrainingPort!(bad));
  (f.configuration as any).createOutputStorage = () => {throw Error("replacement must not execute");};
  assert.equal(await f.session.prepare(), "ready"); assert.equal(hooks, 0); assert.equal(f.outputFactories, 1);
  assert.equal(await f.session.settle(), true); assert.equal(f.controller.stops, 1);
});

test("local output retains a malformed native factory Promise and observes its safe late rejection without hooks", async t => {
  let reject!: (error: unknown) => void, hooks = 0;
  const original = new Promise<never>((_resolve, fail) => {reject = fail;});
  Object.defineProperty(original, "then", {get() {hooks++; throw Error("must not execute");}});
  const f = await boundedLocalFoundation(t, {outputFactory: (() => original) as never});
  try {
    assert.equal(await f.session.prepare(), "unconfirmed"); assert.equal(f.controller.starts, 0); assert.equal(f.factories, 0);
    reject(Error("synthetic private factory failure")); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(hooks, 0); assert.equal(await f.session.settle(), false); await assert.rejects(f.session.prepare());
  } finally {reject(Error("synthetic private factory failure"));}
});

test("local output preserves a corrupt publication without success, repeated transfer or cleanup credit", async t => {
  const f = await boundedLocalFoundation(t, {output: true, corruptOutput: true});
  assert.equal(await f.session.prepare(), "ready"); await f.session.start(staged(), () => true);
  await waitForLocalOutput(() => f.resultOwner!.storage.inspectPublication().phase === "unconfirmed");
  f.succeed(); const record = await f.session.read(); assert.equal(record.status, "failed"); assert.equal(record.data, undefined);
  assert.equal(await f.session.settle(), false); assert.equal(f.controller.stops, 1);
  assert.throws(() => f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()));
  const count = f.calls.length; assert.equal(await f.session.settle(), false); assert.equal(f.calls.length, count);
  assert.ok(f.resultOwner!.storage.inspectPublication().declaredPayloadBytes > 0);
});

test("local output stop retains the original pending read until its own response returns", async t => {
  let entered = false, release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const f = await boundedLocalFoundation(t, {output: true, holdOutputRead: async () => {entered = true; await held;}});
  try {
    assert.equal(await f.session.prepare(), "ready"); await f.session.start(staged(), () => true);
    await waitForLocalOutput(() => entered); assert.equal((await f.session.cancel()).cancelled, true);
    assert.equal(await f.session.settle(), false); assert.equal(f.controller.stops, 1);
    assert.equal(f.outputAcknowledged, 0); assert.ok(f.resultIo!.inspect().publicationFenced);
    const calls = f.calls.length; release();
    let settled = false;
    for (let attempt = 0; attempt < 100 && !settled; attempt++) {await new Promise(resolve => setTimeout(resolve, 2)); settled = await f.session.settle();}
    assert.equal(settled, true); assert.equal(f.calls.length, calls); assert.equal(f.controller.stops, 1);
    assert.equal((await f.session.read()).status, "cancelled");
    assert.deepEqual(await readdir(f.outputRoot), []); assert.deepEqual(await readdir(f.staging), []);
    assert.throws(() => f.resultOwner!.originalOwner.inspectFinalizedFiles(localOutputContext()));
  } finally {release();}
});

test("local foundation prepares actual copies and binds their exact private manifest to the original worker", async t => {
  const f = await boundedLocalFoundation(t); assert.equal(await f.session.prepare(), "ready", JSON.stringify({factoryPhase: f.storagePhase, factories: f.factories, reads: f.reads, workerStarts: f.controller.starts, files: await readdir(f.staging)}));
  const request = f.calls.find(call => call.endpoint.endsWith("/prepare"))!.body;
  assert.equal(request.identity.profileId, f.configuration.startupProfile.profileId);
  assert.equal(request.localModelCopy.modelRecordId, "base"); assert.equal(request.localModelCopy.modelUpdatedAt, f.selected.modelUpdatedAt);
  const directory = request.localModelCopy.directory;
  assert.equal(path.dirname(directory), f.staging); assert.equal(request.definition.request.baseModel.localPath, f.model);
  assert.equal(f.controller.boot.modelSource, undefined);
  assert.equal(JSON.parse(f.controller.boot.environment.PYTHON_RUNTIME_BOUNDED_LOCAL_TRAINING_BOOT).profile.profileFingerprint,
    f.configuration.startupProfile.profileFingerprint);
  for (const row of request.localModelCopy.files) {
    const content = await readFile(path.join(directory, row.name));
    assert.equal(content.length, row.sizeBytes); assert.equal("sha256:" + createHash("sha256").update(content).digest("hex"), row.sha256);
    assert.deepEqual(content, await readFile(path.join(f.model, row.name)));
  }
  assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
  f.succeed(); assert.equal((await f.session.read()).status, "succeeded");
  assert.equal(f.controller.stops, 0); assert.equal((await readdir(f.staging)).length, 1);
  assert.equal(await f.session.settle(), true, JSON.stringify({stops: f.controller.stops, storage: f.storageState, cleanupGranted: f.cleanupGranted})); assert.equal(f.controller.stops, 1); assert.deepEqual(await readdir(f.staging), []);
  assert.equal(await f.session.settle(), true); assert.equal(f.controller.stops, 1); assert.equal(f.factories, 1);
  for (const name of ["config.json", "tokenizer.json", "model.safetensors"]) assert.equal((await readFile(path.join(f.model, name))).length > 0, true);
});

for (const prepare of ["unavailable", "lost"] as const) test(`local ${prepare} preparation retires its exact worker before deleting only its copy`, async t => {
  const f = await boundedLocalFoundation(t, {prepare});
  assert.equal(await f.session.prepare(), prepare === "unavailable" ? "unavailable" : "unconfirmed");
  if (prepare === "lost") {assert.equal(f.controller.stops, 0); assert.equal(await f.session.settle(), true);}
  assert.equal(f.controller.starts, 1); assert.equal(f.controller.stops, 1); assert.deepEqual(await readdir(f.staging), []);
  assert.equal(f.calls.some(call => call.endpoint.endsWith("/start")), false); assert.equal(f.factories, 1);
  await assert.rejects(f.session.prepare()); assert.equal(f.controller.starts, 1);
});

test("missing local Model reader refuses before reserving, observing or copying", async t => {
  const f = await boundedLocalFoundation(t);
  assert.equal(f.port.createSession(f.selected, f.control), undefined); assert.equal(f.factories, 0); assert.equal(f.reads, 0);
  assert.equal(f.controller.starts, 0); assert.deepEqual(await readdir(f.staging), []);
});

test("local factory metadata is captured before caller mutation and refuses async factories", async t => {
  const f = await boundedLocalFoundation(t); let hooks = 0;
  assert.throws(() => f.foundation.createBoundedLocalTrainingPort!({...f.configuration, createModelCopy: (async () => {hooks++;}) as never}));
  const policy: any = {...f.configuration.observation, maximumTotalBytes: {valueOf() {hooks++; return 1;}}};
  assert.throws(() => f.foundation.createBoundedLocalTrainingPort!({...f.configuration, observation: policy}));
  const roots: any[] = [...f.configuration.observation.allowedRootDirectories];
  Object.defineProperty(roots, "0", {enumerable: true, get() {hooks++; return f.model;}});
  assert.throws(() => f.foundation.createBoundedLocalTrainingPort!({...f.configuration, observation: {...f.configuration.observation, allowedRootDirectories: roots}}));
  assert.equal(hooks, 0); assert.equal(f.factories, 0); assert.equal(f.controller.starts, 0);
});

test("late local selection cannot start a worker after the original preparation deadline", async t => {
  let enter!: () => void, release!: () => void, returned = false;
  const entered = new Promise<void>(resolve => {enter = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const f = await boundedLocalFoundation(t, {observeMs: 2000, selectionAfterCopy: async () => {enter(); await gate; returned = true;}});
  const pending = f.session.prepare();
  try {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {await Promise.race([entered, new Promise<never>((_resolve, reject) => {deadline = setTimeout(() => reject(Error("selection fixture was not reached")), 5000);})]);}
    finally {if (deadline) clearTimeout(deadline);}
    assert.equal(await pending, "unconfirmed"); assert.equal(f.controller.starts, 0);
    assert.equal(await f.session.settle(), false); release();
    for (let index = 0; index < 100 && !returned; index++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(returned, true); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.controller.starts, 0); assert.equal(f.calls.length, 0); assert.equal(f.factories, 1);
    await assert.rejects(f.session.prepare()); assert.equal(f.controller.starts, 0);
  } finally {release(); await pending;}
});

test("local copy remains intact until the original controller supplies retirement and close proof", async t => {
  const f = await boundedLocalFoundation(t, {autoRetire: false});
  assert.equal(await f.session.prepare(), "ready"); assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
  f.succeed(); assert.equal(await f.session.settle(), false); assert.equal(f.controller.stops, 1);
  assert.equal(f.storageState?.phase, "ready"); assert.equal(f.storageState?.fenced, false);
  assert.equal((await readdir(f.staging)).length, 1); assert.equal(f.cleanupGranted, false);
  f.controller.closeWithProof(); assert.equal(await f.session.settle(), true);
  assert.equal(f.controller.stops, 1); assert.equal(f.cleanupGranted, true); assert.deepEqual(await readdir(f.staging), []);
});

test("original local cleanup survives business permission withdrawal without exposing a new read", async t => {
  const f = await boundedLocalFoundation(t); assert.equal(await f.session.prepare(), "ready");
  assert.equal((await f.session.start(staged(), () => true)).kind, "accepted"); f.succeed(); f.deny();
  await assert.rejects(f.session.read()); assert.equal(await f.session.settle(), true);
  assert.equal(f.controller.stops, 1); assert.deepEqual(await readdir(f.staging), []);
  assert.equal(f.cleanupGranted, true); assert.equal(f.factories, 1);
});

test("a malformed local factory Promise is retained and its safe late rejection cannot launch or retry", async t => {
  let reject!: (error: Error) => void, hooks = 0;
  const pending = new Promise<void>((_resolve, fail) => {reject = fail;});
  Object.defineProperty(pending, "then", {get() {hooks++; throw Error("must not run");}});
  const f = await boundedLocalFoundation(t, {storage: (() => pending) as never});
  try {
    assert.equal(await f.session.prepare(), "unconfirmed"); assert.equal(f.controller.starts, 0); assert.equal(hooks, 0);
    reject(Error("synthetic late factory rejection")); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(hooks, 0); assert.equal(f.factories, 1); assert.equal(await f.session.settle(), false);
    await assert.rejects(f.session.prepare()); assert.equal(f.controller.starts, 0);
    assert.deepEqual(await readdir(f.staging), []);
  } finally {reject(Error("synthetic late factory rejection")); await new Promise(resolve => setImmediate(resolve));}
});

test("a malformed async local inspector retains its original late rejection without hooks or cleanup credit", async t => {
  let reject!: (error: Error) => void, hooks = 0;
  const inspection = new Promise<void>((_resolve, fail) => {reject = fail;});
  Object.defineProperty(inspection, "then", {get() {hooks++; throw Error("must not run");}});
  let originalStorage: ReturnType<typeof createFilesystemLocalTrainingModelCopyStorage> | undefined;
  const originalNow = Date.now;
  const f = await boundedLocalFoundation(t, {storage: input => {
    const storage = originalStorage = createFilesystemLocalTrainingModelCopyStorage({rootDirectory: path.join(path.dirname(input.source.logicalPath), "staging"),
      allowedSourceRoots: [path.dirname(input.source.logicalPath)], source: input.source, context: input.context,
      limits: {maximumFiles: 9, maximumFileBytes: 4096, maximumTotalBytes: 4096, maximumDurationMs: 5000, minimumFreeBytes: 1024, bufferBytes: 65536},
      control: input.control});
    return Object.freeze({...storage, inspect: (() => {
      // The returned Promise still needs an observer after preparation expiry.
      t.mock.method(Date, "now", () => originalNow() + 6000);
      return inspection;
    }) as never});
  }});
  try {
    assert.equal(await f.session.prepare(), "unconfirmed"); assert.equal(hooks, 0); assert.equal(f.controller.starts, 0);
    assert.equal(originalStorage!.inspect().phase, "ready"); assert.equal(originalStorage!.inspect().fenced, false);
    assert.equal(await f.session.settle(), false); assert.equal((await readdir(f.staging)).length, 1);
    reject(Error("synthetic late inspection rejection")); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(hooks, 0); assert.equal(f.controller.starts, 0); assert.equal(f.factories, 1);
    assert.equal(originalStorage!.inspect().phase, "ready"); assert.equal((await readdir(f.staging)).length, 1);
    assert.equal(await f.session.settle(), false); await assert.rejects(f.session.prepare());
  } finally {reject(Error("synthetic late inspection rejection")); await new Promise(resolve => setImmediate(resolve)); t.mock.restoreAll();}
});
