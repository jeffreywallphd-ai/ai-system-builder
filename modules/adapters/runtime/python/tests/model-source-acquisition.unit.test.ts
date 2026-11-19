import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import fs from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, rmdir, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {readModelDownloadSource} from "../../../../contracts/model";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import type {PythonRuntimePort} from "../../../../application/ports/runtime";
import type {ApprovedModelSourceDownloadRequest, StoreGeneratedModelRequest, StoreGeneratedModelResult} from "../../../../application/ports/model";
import {createLocalGeneratedModelStorageAdapter} from "../../../model/local";
import {createPythonRuntimeTaskRegistryAdapter} from "../createPythonRuntimeTaskRegistryAdapter";
import {createPythonRuntimeAdapterFoundation} from "../createPythonRuntimePort";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {prepareModelSourceRecipient, type ModelSourceRecipient} from "../client/modelSourceRecipient";
import {MODEL_SOURCE_IDENTITY_VERSION, modelSourceIdentityMac, type ModelSourceIdentityProof, type RuntimeFilesystemIdentity} from "../client/modelSourceIdentity";
import {OWNED_RUNTIME_READY_PREFIX} from "../supervisor/ownedPythonRuntimeProof";

const taskId = "11111111-1111-4111-8111-111111111111", revision = "a".repeat(40), modelId = "fixture/model";
const workspaceId = createWorkspaceId("workspace.source-acquisition");
const runtime = {runtimeId: "synthetic-source-acquisition", workerStartedAt: "2026-11-19T00:00:00+00:00"};
const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const data = {"config.json": Buffer.from('{"model_type":"synthetic"}'), "model.safetensors": Buffer.from("synthetic-closed-weight-fixture"), "tokenizer.json": Buffer.from("{}")};

async function fixture(t: TestContext, queued = false) {
  const boundary = await realpath(tmpdir()), base = await mkdtemp(path.join(boundary, "source-acquisition-"));
  const original = await lstat(base, {bigint: true}), cacheRoot = path.join(base, "cache"); await mkdir(cacheRoot);
  t.after(async () => {
    const after = await lstat(base, {bigint: true}); assert.equal(path.dirname(base), boundary); assert.equal(await realpath(base), base);
    assert.ok(after.isDirectory() && !after.isSymbolicLink()); assert.equal(after.dev, original.dev); assert.equal(after.ino, original.ino);
    await rm(base, {recursive: true}); // Only this positively identified fresh disposable fixture.
  });
  const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "unknown"},
    files: Object.entries(data).map(([name, bytes]) => ({path: name, sizeBytes: bytes.length,
      integrity: name.endsWith("safetensors") ? {algorithm: "sha256", digest: createHash("sha256").update(bytes).digest("hex")} :
        {algorithm: "git-blob-sha1", digest: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")}})),
    totalBytes: Object.values(data).reduce((sum, bytes) => sum + bytes.length, 0), excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"}, {provider: "huggingface", modelId, revision});
  const request: ApprovedModelSourceDownloadRequest = {requestId: taskId, workspaceId, sourceManifest: {source, manifestDigest: hash(source)},
    maximumDurationSeconds: 10, allowedOrigins: ["https://huggingface.co"]};
  let current = true, allowed = true, workerLive = true, phase = "prepared", issued: any, receipt: any;
  let sourceFiles = "", snapshot = "", stores = 0, sourcePosts = 0, cleanupEffects = 0, settlementEffects = 0, genericReads = 0;
  let dropObserved = false, dropSettled = false, dropStart = false, readonlyFailure = false;
  let ordinaryStatus = "running";
  let genericStart: ((body: any) => Promise<Response>) | undefined;
  let finalAck: (() => Promise<void>) | undefined;
  let policyHook: (() => void) | undefined;
  let storageHook: ((request: StoreGeneratedModelRequest) => Promise<StoreGeneratedModelResult>) | undefined;
  const calls: string[] = [], transportErrors: string[] = [];
  const storage = createLocalGeneratedModelStorageAdapter({env: {HF_HUB_CACHE: cacheRoot}, maximumSourceBytes: 4096, maximumSourceFiles: 16});
  const binding = () => ({version: "model-source-task-binding-v1", taskId: issued.requestId,
    acquisitionId: issued.payload.sourceTransfer.acquisitionId, handoffId: issued.payload.sourceTransfer.handoffId,
    modelId, revision, manifestDigest: request.sourceManifest.manifestDigest});
  const status = () => ({requestId: issued.requestId, phase, binding: binding(), receivedBytes: ["prepared", "cancelled", "failed"].includes(phase) ? 0 : source.totalBytes,
    totalBytes: source.totalBytes, cleanupPending: ["running", "awaiting-receiver", "acknowledging", "uncertain"].includes(phase),
    receiverSettlementPending: phase === "acknowledged", startAcknowledgementUnconfirmed: false, ...(receipt ? {receipt} : {})});
  const facts = async (filename: string) => {
    const value = await lstat(filename, {bigint: true});
    return [value.dev.toString(), value.ino.toString(), value.mode.toString(), "0", "0"] as RuntimeFilesystemIdentity;
  };
  async function produce() {
    const transfer = issued.payload.sourceTransfer, root = path.join(cacheRoot, ".aisb-model-source-transfers", transfer.acquisitionId);
    const receiver = path.join(root, "receiver"); sourceFiles = path.join(root, "source", "synthetic-stage");
    snapshot = path.join(receiver, transfer.handoffId, "models--fixture--model", "snapshots", revision);
    await mkdir(sourceFiles); await mkdir(snapshot, {recursive: true}); const files = [];
    for (const [name, bytes] of Object.entries(data)) {
      await writeFile(path.join(sourceFiles, name), bytes); await link(path.join(sourceFiles, name), path.join(snapshot, name));
      const stat = await lstat(path.join(snapshot, name), {bigint: true});
      files.push({path: name, device: stat.dev.toString(), inode: stat.ino.toString(), size: bytes.length});
    }
    const witness = hash({task: issued.requestId, handoff: transfer.handoffId, root: await facts(receiver)});
    receipt = {task_id: issued.requestId, handoff_id: transfer.handoffId, model_id: modelId, revision,
      manifest_digest: request.sourceManifest.manifestDigest, recipient_witness: witness, file_count: 3, size_bytes: source.totalBytes,
      receipt_digest: hash({task: issued.requestId, handoff: transfer.handoffId, manifest: request.sourceManifest.manifestDigest, recipient: witness, files})};
    phase = "awaiting-receiver";
  }
  const fetcher = async (url: unknown, init?: RequestInit): Promise<Response> => {
    const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (endpoint === "/health") return Response.json({healthy: workerLive, status: {status: workerLive ? "ready" : "error", ...runtime}});
    if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: ["ensure-model-download.source-identity-v1",
      "ensure-model-download.exact-revision-v1", "ensure-model-download.source-manifest-v1", "ensure-model-download.source-transfer-v1", "ensure-model-download.source-session-v1"]});
    if (endpoint === "/models/source-identity") {
      const namespace = path.join(cacheRoot, ".aisb-model-source-transfers"), root = path.join(namespace, body.acquisitionId);
      const receiver = path.join(root, "receiver"), files = [];
      if (body.phase === "snapshot") for (const selected of source.files) {
        const filename = path.join(receiver, body.handoffId, "models--fixture--model", "snapshots", revision, selected.path);
        const stat = await lstat(filename, {bigint: true});
        files.push({path: selected.path, identity: await facts(filename), nlink: Number(stat.nlink), sizeBytes: Number(stat.size), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString()});
      }
      const proof: ModelSourceIdentityProof = {...body, version: MODEL_SOURCE_IDENTITY_VERSION,
        roots: {acquisition: await facts(root), source: await facts(path.join(root, "source")), receiver: await facts(receiver)},
        manifestDigest: body.phase === "roots" ? null : request.sourceManifest.manifestDigest, files};
      return Response.json({proof, mac: modelSourceIdentityMac(await readFile(path.join(namespace, body.acquisitionId + ".proof")), proof).toString("hex")});
    }
    if (endpoint === "/tasks/start") {
      if (!body.payload.sourceTransfer) return genericStart ? genericStart(body) : Response.json({requestId: body.requestId, taskType: body.taskType, accepted: true, status: "queued"});
      sourcePosts++; issued = body; if (!queued) await produce();
      if (dropStart) throw new Error("synthetic lost start reply");
      return Response.json({requestId: body.requestId, taskType: body.taskType, accepted: true, status: "queued", metadata: {runtimeId: runtime.runtimeId, workspaceId: body.metadata.workspaceId}});
    }
    if (endpoint.endsWith("/model-source")) {
      if (readonlyFailure) {readonlyFailure = false; throw new Error("synthetic lost read");}
      return Response.json(status());
    }
    if (endpoint.endsWith("/model-source/cancel")) {
      assert.deepEqual(body, binding()); const cancelled = phase === "prepared" || phase === "cancelled";
      if (cancelled) phase = "cancelled"; return Response.json({cancelled, source: status()});
    }
    if (endpoint.endsWith("/acknowledgement")) {
      assert.equal(body.receiptDigest, receipt.receipt_digest);
      if (body.phase === "receiver-observed") {
        if (phase === "awaiting-receiver") {
          cleanupEffects++; for (const name of Object.keys(data)) await unlink(path.join(sourceFiles, name)); await rmdir(sourceFiles); phase = "acknowledged";
        }
        if (dropObserved) {dropObserved = false; throw new Error("synthetic lost observation reply");}
      } else {
        if (phase !== "released") {settlementEffects++; phase = "released";}
        if (dropSettled) {dropSettled = false; throw new Error("synthetic lost settlement reply");}
        await finalAck?.();
      }
      return Response.json(status());
    }
    if (endpoint.endsWith("/cancel")) return Response.json({requestId: endpoint.split("/").slice(-2)[0], taskType: "train-model", status: "running", cancelled: false});
    genericReads++; return Response.json({requestId: endpoint.split("/").slice(-1)[0], taskType: "train-model", status: ordinaryStatus});
  };
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: "synthetic-source-acquisition-token-0000000",
    environment: {HF_HUB_CACHE: cacheRoot}, captureProcessOwnership: () => () => {if (!workerLive) throw new Error("Synthetic worker retired.");},
    fetchImplementation: (async (...args: Parameters<typeof fetcher>) => {try {return await fetcher(...args);} catch (error) {transportErrors.push(String(error)); throw error;}}) as never});
  let installations = 0, preparations = 0;
  const registry = createPythonRuntimeTaskRegistryAdapter(client as PythonRuntimePort, {
    async ensureRuntimeReady() {installations++;}, async ensureRuntimeReadyWithoutInstalling() {preparations++;},
    modelSource: {cacheRoot, captureSession: () => client.captureModelSourceTaskSession(), storage: {async storeGeneratedModel(request) {
      stores++; return storageHook ? storageHook(request) : storage.storeGeneratedModel(request);
    }}},
  });
  const control = {isCurrent: () => current, stillAllowed: async () => {policyHook?.(); return allowed;}};
  return {base, cacheRoot, request, registry, client, control, calls, fetcher, status, storage, produce, transportErrors,
    counts: () => ({stores, sourcePosts, cleanupEffects, settlementEffects, genericReads, installations, preparations}),
    deny() {allowed = false;}, retire() {current = false;}, worker(value: boolean) {workerLive = value;},
    dropObserved() {dropObserved = true;}, dropSettled() {dropSettled = true;}, dropStart() {dropStart = true;}, dropRead() {readonlyFailure = true;},
    storageHook(value: typeof storageHook) {storageHook = value;}, failEmpty() {phase = "failed";},
    livePolicy: () => allowed, policyHook(value: typeof policyHook) {policyHook = value;},
    finalAck(value: typeof finalAck) {finalAck = value;}, genericStart(value: typeof genericStart) {genericStart = value;},
    ordinaryStatus(value: string) {ordinaryStatus = value;},
  };
}

test("source Task starts without import, then persists exact bytes and settles before completion", async t => {
  const f = await fixture(t);
  assert.equal((await f.registry.startApprovedModelSource(f.request, f.control)).kind, "accepted", JSON.stringify({counts: f.counts(), calls: f.calls, errors: f.transportErrors}));
  assert.equal(f.counts().stores, 0, "Submission cannot block on persistent import.");
  const completed = await f.registry.getTaskStatus(taskId); assert.equal(completed.status, "succeeded");
  const privateCompletion = await f.registry.readCompletedModelDownload(taskId);
  assert.equal(privateCompletion?.verifiedManifestDigest, f.request.sourceManifest.manifestDigest);
  for (const [name, bytes] of Object.entries(data)) assert.deepEqual(await readFile(path.join(privateCompletion!.localPath, name)), bytes);
  assert.doesNotMatch(JSON.stringify(completed), /localPath|sourceTransfer|acquisitionId|receipt_digest/);
  assert.deepEqual(f.counts(), {stores: 1, sourcePosts: 1, cleanupEffects: 1, settlementEffects: 1, genericReads: 0, installations: 0, preparations: 1});
  await f.registry.getTaskStatus(taskId); assert.equal(f.counts().stores, 1);
  assert.deepEqual(await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers")), []);
});

test("lost reads and both ACK replies resume only captured observation without repeated download, store or cleanup", async t => {
  for (const variant of ["read", "observed", "settled"]) {
    const f = await fixture(t); await f.registry.startApprovedModelSource(f.request, f.control);
    if (variant === "read") f.dropRead(); if (variant === "observed") f.dropObserved(); if (variant === "settled") f.dropSettled();
    assert.equal((await f.registry.getTaskStatus(taskId)).status, "running");
    assert.equal((await f.registry.getTaskStatus(taskId)).status, "succeeded");
    assert.equal(f.counts().sourcePosts, 1); assert.equal(f.counts().stores, 1); assert.equal(f.counts().cleanupEffects, 1); assert.equal(f.counts().settlementEffects, 1);
  }
});

test("lost start remains unconfirmed without generic discovery, adoption, storage or reissue", async t => {
  const f = await fixture(t); f.dropStart();
  assert.deepEqual(await f.registry.startApprovedModelSource(f.request, f.control), {kind: "unconfirmed"});
  assert.equal((await f.registry.getTaskStatus(taskId)).status, "unknown");
  assert.deepEqual(await f.registry.startApprovedModelSource(f.request, f.control), {kind: "unavailable"});
  assert.equal(f.counts().sourcePosts, 1); assert.equal(f.counts().stores, 0); assert.equal(f.counts().genericReads, 0);
  assert.equal(f.calls.filter(value => value.endsWith("/model-source")).length, 0);
});

test("confirmed queued cancellation and empty failure retire only their own empty receiver", async t => {
  for (const variant of ["cancelled", "failed"]) {
    const f = await fixture(t, true); await f.registry.startApprovedModelSource(f.request, f.control);
    if (variant === "cancelled") {
      const [a, b] = await Promise.all([f.registry.cancelTask(taskId), f.registry.cancelTask(taskId)]);
      assert.equal(a.cancelled, true); assert.equal(b.cancelled, true);
    } else f.failEmpty();
    assert.equal((await f.registry.getTaskStatus(taskId)).status, variant);
    assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined);
    assert.equal(f.counts().stores, 0); assert.deepEqual(await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers")), []);
  }
});

test("held import coalesces reads and original business or host withdrawal cannot register completion or retry storage", {timeout: 10000}, async t => {
  for (const variant of ["business", "host"]) {
    const f = await fixture(t); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
    f.storageHook(async request => {const result = await f.storage.storeGeneratedModel(request); entered(); await held; return result;});
    await f.registry.startApprovedModelSource(f.request, f.control);
    const first = f.registry.getTaskStatus(taskId); await started;
    const second = f.registry.getTaskStatus(taskId); if (variant === "business") f.deny(); else f.retire(); release();
    assert.equal((await first).status, "unknown"); assert.equal((await second).status, "unknown");
    assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined); assert.equal(f.counts().stores, 1);
    assert.ok((await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers"))).length > 0);
  }
});

test("changed persisted bytes, foreign destinations and existing targets cannot become completed or be adopted", async t => {
  for (const variant of ["bytes", "destination", "existing", "unknown-store", "third-link", "executable-result"]) {
    const f = await fixture(t); let hooks = 0;
    if (variant === "existing") {
      const target = path.join(f.cacheRoot, "models--fixture--model", "snapshots", revision); await mkdir(target, {recursive: true});
      await writeFile(path.join(target, "retained-marker"), "keep");
    } else f.storageHook(async request => {
      const stored = await f.storage.storeGeneratedModel(request);
      if (variant === "unknown-store") throw new Error("synthetic-private-storage-marker");
      if (variant === "bytes") await writeFile(path.join(stored.localPath, "config.json"), Buffer.alloc(data["config.json"].length, 65));
      if (variant === "third-link") await link(path.join(stored.localPath, "config.json"), path.join(f.base, "foreign-link"));
      if (variant === "executable-result") return {...stored, toJSON() {hooks++; return stored;}};
      return variant === "destination" ? {...stored, localPath: f.base} : stored;
    });
    await f.registry.startApprovedModelSource(f.request, f.control);
    const failed = await f.registry.getTaskStatus(taskId); assert.equal(failed.status, "unknown");
    assert.doesNotMatch(JSON.stringify(failed), /synthetic-private-storage-marker|localPath|receipt_digest/);
    assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined); assert.equal(f.counts().stores, 1);
    assert.equal(hooks, 0);
    if (variant === "existing") assert.equal(await readFile(path.join(f.cacheRoot, "models--fixture--model", "snapshots", revision, "retained-marker"), "utf8"), "keep");
  }
});

test("history rotation cannot evict an unsettled source owner", async t => {
  const f = await fixture(t); await f.registry.startApprovedModelSource(f.request, f.control);
  for (let i = 0; i < 270; i++) await f.registry.startTask({requestId: "ordinary-training-" + i,
    workspaceId, taskType: TaskType.MODEL_TRAINING, payload: {}});
  assert.equal((await f.registry.getTaskStatus(taskId)).status, "succeeded");
  assert.equal((await f.registry.readCompletedModelDownload(taskId))?.modelId, modelId);
  assert.equal(f.counts().sourcePosts, 1); assert.equal(f.counts().stores, 1);
});

test("ambiguous verification close and receiver unlink retain custody without repeated effects", async t => {
  for (const variant of ["close", "unlink"]) {
    const f = await fixture(t); let effects = 0, restore: (() => void) | undefined;
    f.storageHook(async request => {
      const result = await f.storage.storeGeneratedModel(request);
      if (variant === "close") {
        const original = fs.open;
        const patched = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
          const handle = await original(...args);
          if (String(args[0]) === path.join(result.localPath, "config.json")) {
            const close = handle.close.bind(handle);
            handle.close = async () => {effects++; await close(); throw new Error("synthetic-unknown-close");};
          }
          return handle;
        });
        restore = () => patched.mock.restore();
      } else {
        const original = fs.unlink;
        const patched = t.mock.method(fs, "unlink", async (filename: Parameters<typeof fs.unlink>[0]) => {
          await original(filename);
          if (String(filename).includes(path.sep + "receiver" + path.sep)) {effects++; throw new Error("synthetic-unknown-unlink");}
        });
        restore = () => patched.mock.restore();
      }
      syncBuiltinESMExports(); return result;
    });
    try {
      await f.registry.startApprovedModelSource(f.request, f.control);
      assert.equal((await f.registry.getTaskStatus(taskId)).status, "unknown");
      assert.equal((await f.registry.getTaskStatus(taskId)).status, "unknown");
      assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined);
      assert.equal(effects, 1); assert.equal(f.counts().stores, 1); assert.equal(f.counts().settlementEffects, 0);
      assert.ok((await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers"))).length > 0);
    } finally {restore?.(); syncBuiltinESMExports();}
  }
});

test("business permission remains live at storage invocation across the final helper-return handoff", async t => {
  const f = await fixture(t); let checks = 0; const observed: boolean[] = [];
  f.policyHook(() => {
    if (f.counts().sourcePosts && f.status().phase === "acknowledged" && ++checks === 3)
      queueMicrotask(() => queueMicrotask(() => f.deny()));
  });
  f.storageHook(async request => {observed.push(f.livePolicy()); return f.storage.storeGeneratedModel(request);});
  await f.registry.startApprovedModelSource(f.request, f.control);
  assert.equal((await f.registry.getTaskStatus(taskId)).status, "unknown");
  assert.deepEqual(observed, [true], "An extra allowed() return would invoke storage after permission withdrawal.");
  assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined); assert.equal(f.counts().stores, 1);
});

test("permission withdrawn during final settlement withholds completion without reopening confirmed cleanup", async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  f.finalAck(async () => {entered(); await held;});
  await f.registry.startApprovedModelSource(f.request, f.control);
  const pending = f.registry.getTaskStatus(taskId); await started; f.deny(); release();
  const denied = await pending; assert.equal(denied.status, "failed");
  if ("recordType" in denied) assert.fail();
  assert.equal(denied.error?.code, "model_source_completion_denied"); assert.equal(denied.error?.retryable, false);
  assert.equal(await f.registry.readCompletedModelDownload(taskId), undefined);
  assert.deepEqual(await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers")), []);
  assert.equal(f.counts().stores, 1); assert.equal(f.counts().settlementEffects, 1);
});

test("protected pending source capacity denies new work before readiness or dispatch", {timeout: 10000}, async t => {
  const f = await fixture(t); let release!: () => void, entered = 0, captured = 0, installs = 0;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const registry = createPythonRuntimeTaskRegistryAdapter(f.client as PythonRuntimePort, {
    async ensureRuntimeReady() {installs++;}, async ensureRuntimeReadyWithoutInstalling() {entered++; await gate;},
    modelSource: {cacheRoot: f.cacheRoot, storage: f.storage, async captureSession() {captured++; return f.client.captureModelSourceTaskSession();}},
  });
  const inputs = Array.from({length: 256}, () => ({...f.request, requestId: randomUUID()}));
  const starts = inputs.map(input => registry.startApprovedModelSource(input, f.control));
  try {
    assert.equal((await registry.startApprovedModelSource({...f.request, requestId: randomUUID()}, f.control)).kind, "unavailable");
    await assert.rejects(registry.startTask({requestId: "ordinary-at-capacity", workspaceId, taskType: TaskType.MODEL_TRAINING, payload: {}}));
    assert.equal((await registry.getTaskStatus(inputs[0]!.requestId)).status, "queued");
    assert.equal(captured, 0); assert.equal(installs, 0); assert.equal(f.counts().sourcePosts, 0);
    f.deny();
  } finally {release();}
  assert.ok((await Promise.all(starts)).every(value => value.kind === "unavailable"));
  assert.ok(entered <= 256); assert.equal(captured, 0); assert.equal(installs, 0);
});

test("absent support, active input and denied original permission produce no source effect or installer fallback", async t => {
  const f = await fixture(t); let getters = 0;
  const bad = {...f.request}; Object.defineProperty(bad, "sourceManifest", {get() {getters++; return f.request.sourceManifest;}, enumerable: true});
  assert.equal((await f.registry.startApprovedModelSource(bad, f.control)).kind, "unavailable");
  assert.equal((await f.registry.startApprovedModelSource({...f.request, install: true} as never, f.control)).kind, "unavailable");
  f.deny(); assert.equal((await f.registry.startApprovedModelSource(f.request, f.control)).kind, "unavailable");
  const unsupported = createPythonRuntimeTaskRegistryAdapter(f.client as PythonRuntimePort);
  assert.equal((await unsupported.startApprovedModelSource(f.request, f.control)).kind, "unavailable");
  assert.equal(getters, 0); assert.equal(f.counts().sourcePosts, 0); assert.equal(f.counts().installations, 0);
  await assert.rejects(lstat(path.join(f.cacheRoot, ".aisb-model-source-transfers")), {code: "ENOENT"});
});

async function foundationFixture(t: TestContext) {
  const f = await fixture(t); f.worker(false);
  const children: (EventEmitter & {stdout: PassThrough; stderr: PassThrough; kill: (signal?: string) => boolean})[] = [];
  let installedProbes = 0, installers = 0;
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: f.fetcher as never},
    supervisor: {command: "synthetic-installed-python", args: ["main.py"], startupTimeoutMs: 100, healthCheckIntervalMs: 1,
      async verifyRuntimeEnvironment() {installedProbes++; return true;}, async prepareRuntimeEnvironment() {installers++;},
      spawnImplementation: ((_command: unknown, _args: unknown, options: {env?: Record<string, string>}) => {
        const child = new EventEmitter() as typeof children[number]; child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.once("exit", () => f.worker(false)); f.worker(true);
        child.kill = signal => {queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM")); return true;};
        queueMicrotask(() => child.stdout.write(OWNED_RUNTIME_READY_PREFIX + options.env?.PYTHON_RUNTIME_STARTUP_PROOF + " 127.0.0.1:" + options.env?.PYTHON_RUNTIME_PORT + "\n"));
        children.push(child); return child;
      }) as never}});
  foundation.bindHostAdmission(() => {});
  t.after(async () => {await foundation.supervisor.stop();});
  const prepare = async (id = taskId) => {
    const session = await foundation.captureModelSourceTaskSession();
    let captured: ModelSourceRecipient | undefined;
    const owner = await prepareModelSourceRecipient({cacheRoot: f.cacheRoot, taskId: id, manifest: f.request.sourceManifest,
      maximumDurationSeconds: 10, allowedOrigins: ["https://huggingface.co"], identityProbe: session.identityProbe,
      isCurrent: f.control.isCurrent, isBusinessAllowed: f.control.stillAllowed, captureCustodian(value) {captured = value;}});
    assert.equal(captured, owner); return {session, owner};
  };
  return {...f, foundation, children, prepare, countsFoundation: () => ({installedProbes, installers})};
}

test("foundation retains source custody through sibling timeout/cancel and releases only after receiver settlement", async t => {
  const f = await foundationFixture(t); await f.foundation.supervisor.startWithoutInstalling!();
  const {session, owner} = await f.prepare(), started = await session.start(owner, workspaceId);
  if (started.kind !== "accepted") assert.fail();
  await f.foundation.runtimePort.startTask({requestId: "sibling", taskType: "train-model", payload: {}, timeoutMs: 1000});
  const originalClock = Date.now;
  const clock = t.mock.method(Date, "now", () => originalClock() + 5000);
  try {
    assert.equal((await f.foundation.runtimePort.readTaskStatus("sibling")).status, "running");
    assert.equal((await f.foundation.runtimePort.cancelTask("sibling")).cancelled, false);
    assert.equal(f.children.length, 1);
    assert.equal(f.countsFoundation().installers, 0);
    await assert.rejects(f.foundation.runtimePort.readTaskStatus(taskId)); await assert.rejects(f.foundation.runtimePort.cancelTask(taskId));
    const second = await f.prepare("22222222-2222-4222-8222-222222222222");
    await assert.rejects(second.session.start(second.owner, workspaceId)); await second.owner.retireUnissued();
    assert.equal(f.counts().sourcePosts, 1);
    const source = await started.task.read(); await owner.observeReceipt(source.receipt);
    await started.task.acknowledge("receiver-observed"); await owner.confirmSenderCleanup();
    await owner.consume(async snapshot => {assert.ok((await readFile(path.join(snapshot, "config.json"))).length);});
    await owner.retire(); await started.task.acknowledge("receiver-settled");
    await started.task.acknowledge("receiver-settled"); // Saved settlement replay cannot release a new owner.
    assert.equal((await f.foundation.runtimePort.readTaskStatus("sibling")).status, "failed");
    assert.equal(f.children.length, 2);
    assert.equal(f.countsFoundation().installers, 1, "After source settlement, ordinary sibling recovery keeps its existing preparation policy.");
  } finally {clock.mock.restore();}
});

test("actual owned-worker exit preserves uncertain Node source custody and denies another source issue", async t => {
  const f = await foundationFixture(t);
  await assert.rejects(f.foundation.captureModelSourceTaskSession()); assert.equal(f.children.length, 0);
  await f.foundation.supervisor.startWithoutInstalling!(); const first = await f.prepare();
  assert.equal((await first.session.start(first.owner, workspaceId)).kind, "accepted");
  f.children[0]!.emit("exit", 1, null);
  assert.equal(first.owner.phase, "uncertain"); assert.equal(first.owner.cleanupPending, true);
  await assert.rejects(f.foundation.captureModelSourceTaskSession()); assert.equal(f.children.length, 1);
  await f.foundation.supervisor.startWithoutInstalling!();
  const second = await f.prepare("22222222-2222-4222-8222-222222222222");
  await assert.rejects(second.session.start(second.owner, workspaceId)); await second.owner.retireUnissued();
  assert.equal(f.counts().sourcePosts, 1); assert.equal(f.countsFoundation().installers, 0);
});

test("an ordinary held start reserves its ID and its late ACK cannot overwrite a later source owner", {timeout: 10000}, async t => {
  const f = await foundationFixture(t); await f.foundation.supervisor.startWithoutInstalling!();
  const source = await f.prepare(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  f.genericStart(async body => {
    if (body.requestId === taskId) {entered(); await held;}
    return Response.json({requestId: body.requestId, taskType: body.taskType, accepted: true, status: "queued"});
  });
  const ordinary = f.foundation.runtimePort.startTask({requestId: taskId, taskType: "train-model", payload: {}});
  await started;
  await assert.rejects(source.session.start(source.owner, workspaceId)); assert.equal(f.counts().sourcePosts, 0);
  // Positive ordinary terminal reads can retire that tracker. Fill the existing
  // bounded terminal cache so the old ID is legitimately no longer reserved.
  f.ordinaryStatus("succeeded"); assert.equal((await f.foundation.runtimePort.readTaskStatus(taskId)).status, "succeeded");
  for (let i = 0; i < 257; i++) {
    const requestId = "completed-filler-" + i;
    await f.foundation.runtimePort.startTask({requestId, taskType: "train-model", payload: {}});
    await f.foundation.runtimePort.readTaskStatus(requestId);
  }
  const accepted = await source.session.start(source.owner, workspaceId); assert.equal(accepted.kind, "accepted");
  release(); await ordinary;
  await assert.rejects(f.foundation.runtimePort.readTaskStatus(taskId), /captured model source/);
  const second = await f.prepare("22222222-2222-4222-8222-222222222222");
  await assert.rejects(second.session.start(second.owner, workspaceId)); await second.owner.retireUnissued();
  assert.equal(f.counts().sourcePosts, 1); assert.equal(source.owner.phase, "issued");
});
