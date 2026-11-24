import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {lstat, mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import path from "node:path";
import {createOriginalTrainingPort, ORIGINAL_TRAINING_CAPABILITY, type OriginalTrainingOwnedChannel, type OriginalTrainingCapture} from "../client/approvedTrainingTaskSession";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {createPythonRuntimeAdapterFoundation} from "../createPythonRuntimePort";
import {OWNED_RUNTIME_READY_PREFIX} from "../supervisor/ownedPythonRuntimeProof";
import type {ApprovedLocalTrainingDefinition, ApprovedLocalTrainingStagedInput} from "../../../../application/ports/model";
import {TaskType} from "../../../../contracts/runtime";
import type {WorkspaceId} from "../../../../contracts/workspace";

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const profile = {profileId: "inert-only", profileFingerprint: "sha256:" + "a".repeat(64)};
const runtime = {runtimeId: "inert-runtime", workerStartedAt: "2026-11-23T00:00:00Z"};
const identity = {...runtime, ...profile}, binding = {...identity, requestId: id, workspaceId: workspace, sessionId: "b".repeat(64)};
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
function fixture() {
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
  const port = createOriginalTrainingPort({captureChannel: async () => {f.captures++; return channel;}, reserve: () => () => {releases++;}});
  const session = port.createSession(definition(), {isCurrent: () => current, stillAllowed: async () => permission})!;
  return {...f, session, channel, get releases() {return releases;}, get status() {return f.status;}, set status(value: string) {f.status = value;},
    get retirement() {return f.retirement;}, set retirement(value: string) {f.retirement = value;},
    get workerClosed() {return f.workerClosed;}, set workerClosed(value: boolean) {f.workerClosed = value;},
    get workerRetirements() {return f.workerRetirements;}, get unusedReleases() {return f.unusedReleases;},
    get retireHook() {return f.retireHook;}, set retireHook(value: typeof f.retireHook) {f.retireHook = value;},
    get hook(): typeof f.hook {return f.hook;}, set hook(value: typeof f.hook) {f.hook = value;},
    get before(): typeof f.before {return f.before;}, set before(value: typeof f.before) {f.before = value;}};
}

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
  const frame = (kind: string, fields: Record<string, unknown> = {}) => child.stdout.write(JSON.stringify({
    schema: "windows-original-worker-control-v1", nonce: boot.nonce, profileDigest: boot.profileDigest, kind, ...fields}) + "\n");
  child.stdin.on("data", data => {
    const value = JSON.parse(data.toString());
    if (value.schema === "windows-original-worker-launch-v1") {boot = value; queueMicrotask(() => frame("suspended")); return;}
    assert.equal(value.nonce, boot.nonce); assert.equal(value.profileDigest, boot.profileDigest);
    if (value.action === "resume") {resumes++; queueMicrotask(() => {
      resumed(); frame("running");
      frame("worker-output", {lane: "stdout", data: Buffer.from(OWNED_RUNTIME_READY_PREFIX + boot.environment.PYTHON_RUNTIME_STARTUP_PROOF +
        " 127.0.0.1:" + boot.environment.PYTHON_RUNTIME_PORT + "\n").toString("base64")});
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
    closeWithProof() {frame("retired"); child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);}};
}

async function observationFoundation(t: TestContext) {
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
  const reader = {async read() {assert.equal(this, reader); assert.equal(controller.starts, 0); modelReads++;
    return {modelRecordId: selected.request.baseModel.modelRecordId!, modelUpdatedAt: selected.modelUpdatedAt, localModelReference: model};}};
  t.after(async () => {
    if (controller.starts) {
      const stopped = foundation.supervisor.stop(); await new Promise(resolve => setImmediate(resolve)); controller.closeWithProof(); await stopped;
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

test("failed source observation retains original foundation reservation without controller fallback", async t => {
  const f = await observationFoundation(t); await writeFile(path.join(f.model, "unexpected.txt"), "synthetic");
  const session = f.port.createSession(f.selected, {isCurrent: () => true, stillAllowed: async () => true}, f.reader)!;
  assert.equal(await session.prepare(), "unconfirmed"); assert.equal(f.controller.starts, 0); assert.deepEqual(f.calls, []);
  assert.equal(await session.settle(), false);
  assert.equal(f.port.createSession({...f.selected, requestId: workspace}, {isCurrent: () => true, stillAllowed: async () => true}, f.reader), undefined);
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

function retirementFoundation() {
  let alive = false, taskStatus = "running", preparePhase = "ready";
  let hostLive = true, download: (() => Promise<void>) | undefined;
  const calls: string[] = [];
  const controller = inertNativeController(() => {alive = true;}), child = controller.child;
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async (url, init) => {
    const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
    if (endpoint === "/health") return Response.json({healthy: alive, status: {...runtime, status: alive ? "ready" : "stopped"}});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    if (endpoint === "/tasks/start" && JSON.parse(String(init?.body)).taskType === "ensure-model-download") {
      await download?.(); throw Error("inert download response ended");
    }
    const segments = endpoint.split("/"), action = segments[segments.length - 1];
    if (action === "prepare" || action === "seal") return Response.json({binding, phase: action === "prepare" ? preparePhase : "ready"});
    if (action === "start") return Response.json({binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"});
    if (action === "read") return Response.json({binding, record: {requestId: id, taskType: "train-model", status: taskStatus, metadata: {workspaceId: workspace}}});
    if (action === "settle") return Response.json({binding, settled: true, retirement: "settled"});
    throw Error("unexpected synthetic endpoint");
  }) as typeof fetch}, supervisor: {...controller.configuration, startupTimeoutMs: 200, healthCheckIntervalMs: 1,
    verifyRuntimeEnvironment: async () => true,
  }});
  foundation.bindHostAdmission(() => {if (!hostLive) throw Error("host stopped");});
  const port = foundation.createApprovedTrainingPort(profile);
  const create = (requestId = id) => port.createSession({...definition(), requestId}, {isCurrent: () => true, stillAllowed: async () => true});
  return {foundation, child, calls, create, get kills() {return controller.stops;},
    endHost() {hostLive = false;}, set download(value: (() => Promise<void>) | undefined) {download = value;},
    succeed() {taskStatus = "succeeded";}, unavailable() {preparePhase = "unavailable";},
    exit() {alive = false; child.emit("exit", 0, null);},
    close() {alive = false; controller.closeWithProof();}};
}

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
