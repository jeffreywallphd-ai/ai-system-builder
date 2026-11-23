import assert from "node:assert/strict";
import test from "node:test";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {createOriginalTrainingPort, ORIGINAL_TRAINING_CAPABILITY, type OriginalTrainingChannel} from "../client/approvedTrainingTaskSession";
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
    end() {current = false;}, deny() {permission = false;}, get releases() {return releases;},
  };
  const channel: OriginalTrainingChannel = {identity, assertCurrent() {if (!current) throw Error("retired");},
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
  const child = new EventEmitter() as EventEmitter & {stdout: PassThrough; stderr: PassThrough; kill: () => boolean};
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {throw Error("recovery must not stop original custody");};
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async url => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === "/health") return Response.json(alive ? {healthy: true, status: {...runtime, status: "ready"}} : {healthy: false, status: {...runtime, status: "stopped"}}, {status: alive ? 200 : 401});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
    throw Error("synthetic lost prepare acknowledgement");
  }) as typeof fetch}, supervisor: {command: "inert-python", startupTimeoutMs: 100, healthCheckIntervalMs: 1,
    verifyRuntimeEnvironment: async () => {installed++; return true;}, prepareRuntimeEnvironment: async () => {prepared++;},
    spawnImplementation: ((_command: unknown, _args: unknown, options: any) => {alive = true;
      queueMicrotask(() => child.stdout.write(OWNED_RUNTIME_READY_PREFIX + options.env.PYTHON_RUNTIME_STARTUP_PROOF + " 127.0.0.1:" + options.env.PYTHON_RUNTIME_PORT + "\n"));
      return child;
    }) as never}});
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
