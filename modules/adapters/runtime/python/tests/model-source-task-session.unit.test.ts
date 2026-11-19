import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat, mkdir, mkdtemp, readFile, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {readModelDownloadSource} from "../../../../contracts/model";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {MODEL_SOURCE_IDENTITY_CAPABILITY, MODEL_SOURCE_IDENTITY_VERSION, modelSourceIdentityMac,
  type ModelSourceIdentityProof, type RuntimeFilesystemIdentity} from "../client/modelSourceIdentity";
import {ModelSourceRecipient, prepareModelSourceRecipient} from "../client/modelSourceRecipient";
import {MODEL_SOURCE_SESSION_CAPABILITY} from "../client/modelSourceTaskSession";

const taskId = "11111111-1111-4111-8111-111111111111", workspaceId = "33333333-3333-4333-8333-333333333333";
const runtime = {runtimeId: "synthetic-source-session", workerStartedAt: "2026-11-19T00:00:00+00:00"};
const auth = "synthetic-source-session-launch-credential";
const capabilities = [MODEL_SOURCE_IDENTITY_CAPABILITY, "ensure-model-download.exact-revision-v1",
  "ensure-model-download.source-manifest-v1", "ensure-model-download.source-transfer-v1", MODEL_SOURCE_SESSION_CAPABILITY];
const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
function selection() {
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(name =>
      ({path: name, sizeBytes: 2, integrity: name.endsWith("safetensors") ? {algorithm: "sha256", digest: "b".repeat(64)} :
        {algorithm: "git-blob-sha1", digest: "c".repeat(40)}})), totalBytes: 6, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  return {source, manifestDigest: hash(source)};
}
type FixtureOptions = {owned?: boolean; healthy?: boolean; missing?: string; capabilityRuntime?: string};
async function fixture(t: TestContext, options: FixtureOptions = {}) {
  const boundary = await realpath(tmpdir()), base = await mkdtemp(path.join(boundary, "source-session-"));
  const original = await lstat(base, {bigint: true}), cacheRoot = path.join(base, "cache"); await mkdir(cacheRoot);
  t.after(async () => {
    const facts = await lstat(base, {bigint: true});
    assert.equal(path.dirname(base), boundary); assert.equal(await realpath(base), base);
    assert.ok(facts.isDirectory() && !facts.isSymbolicLink()); assert.equal(facts.dev, original.dev); assert.equal(facts.ino, original.ino);
    await rm(base, {recursive: true}); // Only this fresh, verified, disposable fixture.
  });
  const calls: {endpoint: string; body?: any}[] = [];
  let current = true, receiverCurrent = true, allowed = true, owner: ModelSourceRecipient | undefined;
  let credentialHook: (() => void) | undefined;
  let answer: ((endpoint: string, body: any) => Response | Promise<Response>) | undefined;
  let policyHook: (() => Promise<boolean>) | undefined;
  const selected = selection();
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
    authorizationTokenProvider: () => {credentialHook?.(); return auth;},
    ...(options.owned === false ? {} : {captureProcessOwnership: () => () => {if (!current) throw new Error("Owned fixture retired.");}}),
    fetchImplementation: (async (url: unknown, init?: RequestInit) => {
      const endpoint = new URL(String(url)).pathname, body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({endpoint, body}); assert.equal((init?.headers as Record<string, string>).authorization, "Bearer " + auth);
      if (endpoint === "/health") return Response.json({healthy: options.healthy !== false,
        status: {status: options.healthy === false ? "error" : "ready", ...runtime}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: options.capabilityRuntime ?? runtime.runtimeId,
        capabilities: capabilities.filter(value => value !== options.missing)});
      if (endpoint === "/models/source-identity") {
        const namespace = path.join(cacheRoot, ".aisb-model-source-transfers"), root = path.join(namespace, body.acquisitionId);
        const facts = async (filename: string) => {
          const stat = await lstat(filename, {bigint: true});
          return [stat.dev.toString(), stat.ino.toString(), stat.mode.toString(), "0", "0"] as RuntimeFilesystemIdentity;
        };
        const proof: ModelSourceIdentityProof = {...body, version: MODEL_SOURCE_IDENTITY_VERSION,
          roots: {acquisition: await facts(root), source: await facts(path.join(root, "source")), receiver: await facts(path.join(root, "receiver"))},
          manifestDigest: null, files: []};
        const secret = await readFile(path.join(namespace, body.acquisitionId + ".proof"));
        return Response.json({proof, mac: modelSourceIdentityMac(secret, proof).toString("hex")});
      }
      assert.ok(answer, "Unexpected source task transport."); return answer(endpoint, body);
    }) as never});
  const binding = () => ModelSourceRecipient.capturedBinding(owner);
  const status = (phase = "running") => ({requestId: taskId, phase,
    cleanupPending: ["running", "awaiting-receiver", "acknowledging", "uncertain"].includes(phase),
    receiverSettlementPending: phase === "acknowledged", startAcknowledgementUnconfirmed: false,
    binding: binding(), receivedBytes: phase === "prepared" || phase === "cancelled" ? 0 : 3, totalBytes: 6});
  const accepted = () => ({requestId: taskId, taskType: "ensure-model-download", accepted: true, status: "queued",
    startedAt: runtime.workerStartedAt, updatedAt: runtime.workerStartedAt, metadata: {runtimeId: runtime.runtimeId, workspaceId}});
  const capture = async () => {
    const session = await client.captureModelSourceTaskSession();
    owner = await prepareModelSourceRecipient({cacheRoot, taskId, manifest: selected, maximumDurationSeconds: 10,
      allowedOrigins: ["https://huggingface.co"], identityProbe: session.identityProbe, isCurrent: () => current && receiverCurrent,
      isBusinessAllowed: () => policyHook ? policyHook() : Promise.resolve(allowed), captureCustodian(value) {owner = value;}});
    return {session, owner};
  };
  return {client, calls, selected, capture, binding, status, accepted,
    answer(value: typeof answer) {answer = value;}, retire() {current = false;}, deny() {allowed = false;},
    retireReceiver() {receiverCurrent = false;}, credentialHook(value: typeof credentialHook) {credentialHook = value;},
    holdPolicy(value: typeof policyHook) {policyHook = value;}};
}

test("private source session requires the already-owned healthy worker and every exact capability", async t => {
  const variations: FixtureOptions[] = [{owned: false}, {healthy: false}, {capabilityRuntime: "foreign"}, ...capabilities.map(missing => ({missing}))];
  for (const options of variations) {
    const f = await fixture(t, options); await assert.rejects(f.client.captureModelSourceTaskSession());
    assert.ok(f.calls.every(value => ["/health", "/capabilities"].includes(value.endpoint)));
    if (options.owned === false) assert.equal(f.calls.length, 0);
  }
});

test("plain, inherited, proxy and prototype-shaped receivers cannot issue or execute hooks", async t => {
  const f = await fixture(t), session = await f.client.captureModelSourceTaskSession(); let hooks = 0;
  const getter = {}; Object.defineProperty(getter, "transfer", {get() {hooks++; return {};}});
  for (const receiver of [{}, getter, Object.create(ModelSourceRecipient.prototype), new Proxy({}, {getPrototypeOf() {hooks++; return null;}})])
    await assert.rejects(session.start(receiver, workspaceId));
  assert.equal(hooks, 0); assert.ok(f.calls.every(value => ["/health", "/capabilities"].includes(value.endpoint)));
});

test("only the receiver's original captured session may issue its exact one-use frozen selection", async t => {
  const f = await fixture(t), {session, owner} = await f.capture();
  const otherSession = await f.client.captureModelSourceTaskSession();
  await assert.rejects(otherSession.start(owner, workspaceId)); assert.equal(owner.phase, "prepared");
  await assert.rejects(session.start(owner, "")); assert.equal(owner.phase, "prepared");
  const transfer = owner.transfer;
  f.answer(() => Response.json(f.accepted()));
  const result = await session.start(owner, workspaceId); assert.equal(result.kind, "accepted"); assert.equal(owner.phase, "issued");
  const body = f.calls.find(value => value.endpoint === "/tasks/start")!.body;
  assert.equal(body.requestId, taskId); assert.equal(body.metadata.workspaceId, workspaceId);
  assert.deepEqual(body.payload.sourceManifest, JSON.parse(JSON.stringify(f.selected)));
  assert.deepEqual(body.payload.sourceTransfer, JSON.parse(JSON.stringify(transfer)));
  assert.doesNotMatch(JSON.stringify(body), /cacheRoot|secret|captureCustodian|isBusinessAllowed/);
  if (result.kind !== "accepted") assert.fail();
  assert.ok(Object.isFrozen(result.task) && Object.isFrozen(result.task.binding));
  await assert.rejects(session.start(owner, workspaceId));
  assert.equal(f.calls.filter(value => value.endpoint === "/tasks/start").length, 1);
});

test("held fresh business permission excludes concurrent issue and denies withdrawal before transport", async t => {
  const f = await fixture(t), {session, owner} = await f.capture();
  let entered!: () => void, release!: (value: boolean) => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<boolean>(resolve => {release = resolve;});
  f.holdPolicy(() => {entered(); return held;});
  const issue = session.start(owner, workspaceId); await started;
  await assert.rejects(session.start(owner, workspaceId)); release(false); await assert.rejects(issue);
  assert.equal(owner.phase, "uncertain"); assert.equal(f.calls.filter(value => value.endpoint === "/tasks/start").length, 0);
});

test("lost, wrong-scope or malformed start replies never mint a job handle or retry the issue", async t => {
  for (const change of ["lost", "requestId", "taskType", "runtimeId", "workspaceId", "accepted", "status", "extra"]) {
    const f = await fixture(t), {session, owner} = await f.capture();
    f.answer(() => {
      if (change === "lost") throw new Error("synthetic lost start reply");
      const reply = f.accepted();
      if (change === "runtimeId" || change === "workspaceId") reply.metadata[change] = "foreign";
      else Object.assign(reply, {[change]: change === "accepted" ? false : "foreign"});
      return Response.json(reply);
    });
    assert.deepEqual(await session.start(owner, workspaceId), {kind: "unconfirmed"});
    await assert.rejects(session.start(owner, workspaceId)); assert.ok(["issued", "uncertain"].includes(owner.phase));
    assert.equal(f.calls.filter(value => value.endpoint === "/tasks/start").length, 1);
    assert.ok(f.calls.every(value => value.endpoint === "/tasks/start" || !value.endpoint.startsWith("/tasks/")));
  }
});

test("receiver-only withdrawal after the final preparation return cannot dispatch through a live worker", async t => {
  const original = ModelSourceRecipient.takeTaskRequest;
  for (const variant of ["receiver-retired", "uncertain", "business-denied", "credential-boundary"]) {
    const f = await fixture(t), {session, owner} = await f.capture();
    f.answer(() => assert.fail("No task POST after original receiver withdrawal."));
    const intercepted = t.mock.method(ModelSourceRecipient, "takeTaskRequest", async (...args: Parameters<typeof original>) => {
      const selected = await original(...args);
      // This is the outer async handoff after all inner preparation checks.
      if (variant === "receiver-retired") f.retireReceiver();
      if (variant === "uncertain") owner.retainUncertainty();
      if (variant === "business-denied") f.deny();
      if (variant === "credential-boundary") f.credentialHook(() => owner.retainUncertainty());
      return selected;
    });
    try {
      session.identityProbe.assertCurrent(); // Worker lifetime is independently still live.
      assert.deepEqual(await session.start(owner, workspaceId), {kind: "unconfirmed"});
      session.identityProbe.assertCurrent();
      assert.equal(f.calls.filter(value => value.endpoint === "/tasks/start").length, 0);
      assert.equal(owner.cleanupPending, true); await assert.rejects(session.start(owner, workspaceId));
    } finally {intercepted.mock.restore();}
  }
});

test("accepted job reads immutable scoped progress and early ACK cannot send cleanup permission", async t => {
  const f = await fixture(t), {session, owner} = await f.capture();
  f.answer((endpoint) => Response.json(endpoint === "/tasks/start" ? f.accepted() : f.status()));
  const result = await session.start(owner, workspaceId); if (result.kind !== "accepted") assert.fail();
  const status = await result.task.read(); assert.equal(status.receivedBytes, 3); assert.equal(status.totalBytes, 6);
  assert.deepEqual(status.binding, f.binding()); assert.ok(Object.isFrozen(status.binding));
  await assert.rejects(result.task.acknowledge("receiver-observed"));
  await assert.rejects(result.task.acknowledge("receiver-settled"));
  assert.equal(f.calls.filter(value => value.endpoint.endsWith("acknowledgement")).length, 0);
  f.retire(); await assert.rejects(result.task.read()); await assert.rejects(result.task.cancel());
  assert.equal(f.calls.filter(value => value.endpoint.endsWith("/model-source")).length, 1);
});

test("every binding field and bounded phase/counter/receipt contract is enforced on private status", async t => {
  const f = await fixture(t), {session, owner} = await f.capture(); let reply: unknown;
  f.answer(endpoint => Response.json(endpoint === "/tasks/start" ? f.accepted() : reply));
  const result = await session.start(owner, workspaceId); if (result.kind !== "accepted") assert.fail();
  for (const field of Object.keys(f.binding())) {
    reply = {...f.status(), binding: {...f.binding(), [field]: "foreign"}}; await assert.rejects(result.task.read());
  }
  for (const patch of [{requestId: "foreign"}, {phase: "other"}, {receivedBytes: -1}, {receivedBytes: 7}, {receivedBytes: true},
    {receivedBytes: 1.5}, {totalBytes: 7}, {cleanupPending: false}, {receiverSettlementPending: true},
    {phase: "prepared"}, {phase: "awaiting-receiver"}, {receipt: {}}, {errorCode: "private/path"}, {extra: true}]) {
    reply = {...f.status(), ...patch}; await assert.rejects(result.task.read());
  }
  reply = {...f.status(), receivedBytes: null}; assert.equal((await result.task.read()).receivedBytes, null);
  const receipt = {task_id: taskId, handoff_id: f.binding().handoffId, model_id: "fixture/model", revision: "a".repeat(40),
    manifest_digest: f.selected.manifestDigest, recipient_witness: "sha256:" + "d".repeat(64), receipt_digest: "sha256:" + "e".repeat(64), file_count: 3, size_bytes: 6};
  reply = {...f.status("awaiting-receiver"), receipt}; assert.equal((await result.task.read()).receipt?.file_count, 3);
  for (const patch of [{file_count: 4}, {size_bytes: 5}, {task_id: "foreign"}, {recipient_witness: "bad"}, {unknown: true}]) {
    reply = {...f.status("awaiting-receiver"), receipt: {...receipt, ...patch}}; await assert.rejects(result.task.read());
  }
});

test("bound queued cancellation preserves selection and running cancellation remains unsupported", async t => {
  const f = await fixture(t), {session, owner} = await f.capture(); let cancelled = false;
  f.answer((endpoint, body) => {
    if (endpoint === "/tasks/start") return Response.json(f.accepted());
    assert.equal(endpoint, "/tasks/" + taskId + "/model-source/cancel"); assert.deepEqual(body, f.binding());
    return Response.json({cancelled, source: f.status(cancelled ? "cancelled" : "running")});
  });
  const result = await session.start(owner, workspaceId); if (result.kind !== "accepted") assert.fail();
  assert.equal((await result.task.cancel()).cancelled, false); cancelled = true;
  assert.equal((await result.task.cancel()).source.phase, "cancelled");
  f.answer(() => Response.json({cancelled: true, source: f.status("running")})); await assert.rejects(result.task.cancel());
});

test("private job responses enforce the actual streamed byte bound and preserve no late body after withdrawal", async t => {
  for (const variant of ["oversized", "withdrawn"]) {
    const f = await fixture(t), {session, owner} = await f.capture(); let cancelled = 0;
    f.answer(endpoint => {
      if (endpoint === "/tasks/start") return Response.json(f.accepted());
      if (variant === "oversized") return new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(65537));}, cancel() {cancelled++;}}));
      return new Response(new ReadableStream({start(controller) {controller.enqueue(Buffer.from(JSON.stringify(f.status()))); f.retire(); controller.close();}}));
    });
    const result = await session.start(owner, workspaceId); if (result.kind !== "accepted") assert.fail();
    await assert.rejects(result.task.read()); if (variant === "oversized") assert.equal(cancelled, 1);
  }
});
