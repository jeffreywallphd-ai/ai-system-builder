import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, readdir} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createOriginalTrainingPort, ORIGINAL_TRAINING_CAPABILITY, type OriginalTrainingOwnedChannel} from "../client/approvedTrainingTaskSession";
import {createOriginalTrainingOutputReceiver, type OriginalTrainingOutputStorage} from "../client/originalTrainingOutputReceiver";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {createFilesystemTrainingResultFileByteStorageAdapter} from "../../../storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter";
import type {ApprovedLocalTrainingDefinition, TrainingResultFileByteStoragePort} from "../../../../application/ports/model";
import type {WorkspaceId} from "../../../../contracts/workspace";
import type {OrganizationId} from "../../../../contracts/organization";

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const profile = {profileId: "inert-only", profileFingerprint: "sha256:" + "a".repeat(64)};
const runtime = {runtimeId: "inert-runtime", workerStartedAt: "2026-11-23T00:00:00Z"};
const identity = {...runtime, ...profile}, binding = {...identity, requestId: id, workspaceId: workspace, sessionId: "b".repeat(64)};
const publicationId = "c".repeat(32);
function definition(): ApprovedLocalTrainingDefinition {
  return {requestId: id, workspaceId: workspace, owner: {organizationId: "org", principalId: "actor", clientId: id, hostIncarnationId: workspace},
    request: {workspaceId: workspace, trainingTask: "llm-instruction", baseModel: {modelRecordId: "base"},
      datasets: [{artifactId: "input-0", splitRole: "train"}], method: "lora", commonParameters: {}, output: {outputModelName: "inert", destination: {local: {enabled: false}}}},
    modelUpdatedAt: runtime.workerStartedAt, dataset: {datasetId: "dataset", versionId: "v1", versionDigest: profile.profileFingerprint, recipeDigest: profile.profileFingerprint},
    proposalDigest: profile.profileFingerprint, inputs: [{artifactId: "input-0", role: "train", mediaType: "application/jsonl", digest: profile.profileFingerprint, sizeBytes: 4}], recipeSizeBytes: 4};
}
const staged = () => ({payload: definition().request, recipe: {path: "inert/recipe", digest: profile.profileFingerprint, sizeBytes: 4}, outputDirectory: "inert/output"});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) {for (let i = 0; i < 500 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 2)); assert.ok(predicate(), "bounded observation did not complete");}
function deferred<T = void>() {let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};}
function frames(large = false) {
  const bytes = [Buffer.from('{"checkpoint":true}'), Buffer.from("synthetic-checkpoint-bytes"), Buffer.from('{"candidate":true}'), Buffer.from("synthetic-candidate-bytes")];
  if (large) bytes[1] = Buffer.alloc(16_401, 120);
  const files = bytes.map((data, index) => ({fileIndex: index, groupIndex: Math.floor(index / 2),
    name: index % 2 ? "adapter_model.safetensors" : "config.json", sizeBytes: data.length,
    sha256: "sha256:" + createHash("sha256").update(data).digest("hex"), role: index < 2 ? "checkpoint" : "candidate"}));
  const rows: Record<string, any>[] = [];
  const add = (kind: string, fields: object) => rows.push({schema: "original-training-output-delivery-v1", sequence: rows.length + 1, kind, ...fields});
  add("manifest", {taskId: id, files, totalBytes: bytes.reduce((n, data) => n + data.length, 0)});
  const segment = large ? 8192 : 8;
  bytes.forEach((data, fileIndex) => {for (let offset = 0; offset < data.length; offset += segment) add("data", {fileIndex, offset, data: data.subarray(offset, offset + segment).toString("base64")}); add("file-eof", {fileIndex, sizeBytes: data.length});});
  add("streams-complete", {fileCount: files.length, totalBytes: bytes.reduce((n, data) => n + data.length, 0), provisional: true});
  return {rows, bytes, files};
}
async function fixture(large = false) {
  const root = await mkdtemp(path.join(tmpdir(), "training-receive-"));
  const original = createFilesystemTrainingResultFileByteStorageAdapter({rootDirectory: root, publicationId, maximumFiles: 8, maximumFileBytes: 32768, maximumTotalBytes: 131072});
  const input = frames(large), calls: string[] = [], acks: number[] = [];
  let current = true, permission = true, releases = 0, published = 0, ack = 0, completed = false;
  const f = {root, original, input, calls, acks, publications: [] as number[], factoryCalls: 0,
    sendHook: undefined as undefined | ((action: string, body: any) => Promise<unknown> | unknown),
    storageHook: undefined as undefined | ((input: Parameters<TrainingResultFileByteStoragePort["publishResultFile"]>[0]) => Promise<void> | void),
    configureHook: undefined as undefined | (() => void),
    get published() {return published;}, get completed() {return completed;}, get releases() {return releases;},
    end() {current = false;}, deny() {permission = false;}};
  const storage: TrainingResultFileByteStoragePort = {inspectPublication: () => original.inspectPublication(), async publishResultFile(file, context) {
    f.publications.push(file.fileIndex); await f.storageHook?.(file);
    const result = await original.publishResultFile(file, context);
    if (result.ok) published++; return result;
  }};
  const configuration: OriginalTrainingOutputStorage = {storage, context: {requestId: id, workspaceId: workspace, organizationId: "org" as OrganizationId, principalId: "actor"},
    publicationId, maximumFiles: 8, maximumFileBytes: 32768, maximumTotalBytes: 131072, maximumDurationMs: 10000};
  const channel: OriginalTrainingOwnedChannel = {identity, assertCurrent() {assert.ok(current);}, async retireOriginalWorker() {return true;}, releaseUnusedWorker() {},
    async send(endpoint, body: any, dispatch) {
      dispatch?.(); const segments = endpoint.split("/"), action = segments[segments.length - 1]!; calls.push(action);
      const result = await f.sendHook?.(action, body); if (result !== undefined) return result;
      if (action === "prepare" || action === "seal") return {binding, phase: "ready"};
      if (action === "start") return {binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"};
      if (action === "cancel") return {binding, cancelled: true};
      if (action === "settle") return {binding, settled: true, retirement: "settled"};
      if (action === "output-read") return {binding, output: {phase: "active", acknowledged: ack, frame: input.rows[ack]}};
      if (action === "output-ack") {
        assert.deepEqual(Object.keys(body).sort(), ["binding", "sequence"]); assert.equal(body.sequence, ack + 1);
        const row = input.rows[ack]!;
        if (row.kind === "file-eof") {
          assert.equal(published, row.fileIndex + 1, "EOF acknowledged before actual verified publication");
          assert.deepEqual(await readFile(path.join(root, `workspaces/${workspace}/artifacts/training-results/${publicationId}/${row.fileIndex}`)), input.bytes[row.fileIndex]);
        }
        acks.push(++ack); if (row.kind === "streams-complete") completed = true;
        return {binding, acknowledged: true};
      }
      return {binding, record: {requestId: id, taskType: "train-model", status: "succeeded", metadata: {workspaceId: workspace}, data: {runId: id}}};
    }};
  const options = {captureChannel: async () => channel, reserve: () => () => {releases++;},
    createOutputStorage() {f.factoryCalls++; f.configureHook?.(); return configuration;}};
  const session = createOriginalTrainingPort(options).createSession(definition(), {isCurrent: () => current, stillAllowed: async () => permission})!;
  return Object.assign(f, {configuration, storage, channel, options, session,
    async start() {assert.equal(await session.prepare(), "ready"); assert.equal((await session.start(staged(), () => true)).kind, "accepted");},
    async close() {await rm(root, {recursive: true, force: true});}});
}

test("original session receives checkpoint and candidate bytes through actual verified filesystem publication", async () => {
  const f = await fixture(); try {
    assert.equal(f.factoryCalls, 0); await f.start(); await until(() => f.completed); await tick();
    assert.equal(f.factoryCalls, 1); assert.equal(f.published, 4); assert.deepEqual(f.publications, [0, 1, 2, 3]);
    assert.equal(f.acks.length, f.input.rows.length); assert.equal(await f.session.settle(), true); assert.equal(f.releases, 1);
  } finally {await f.close();}
});
test("maximum 8 KiB wire segments survive the original session and verified byte publication", async () => {
  const f = await fixture(true); try {
    await f.start(); await until(() => f.completed); await tick();
    assert.equal(f.published, 4); assert.equal(await f.session.settle(), true);
  } finally {await f.close();}
});
test("pending publication prevents retirement and reservation release", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  try {f.storageHook = async () => {entered.resolve(); await gate.promise;}; await f.start(); await entered.promise;
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0); assert.deepEqual(f.acks, [1]);
    f.storageHook = undefined; gate.resolve(); await until(() => f.completed); await tick(); assert.equal(await f.session.settle(), true);
  } finally {gate.resolve(); await f.close();}
});
test("pending final ACK retains the original reservation until the exact reply arrives", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  try {f.sendHook = async (action, body) => {if (action === "output-ack" && body.sequence === f.input.rows.length) {entered.resolve(); await gate.promise;}};
    await f.start(); await entered.promise; assert.equal(f.published, 4); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
    gate.resolve(); await until(() => f.completed); await tick(); assert.equal(await f.session.settle(), true);
  } finally {gate.resolve(); await f.close();}
});
test("pending frame observations do not republish or create another receive flight", async () => {
  const f = await fixture(); let pending = 3;
  try {f.sendHook = action => action === "output-read" && pending-- > 0 ? {binding, output: {phase: "bound", acknowledged: 0, frame: null}} : undefined;
    await f.start(); await assert.rejects(() => f.session.start(staged(), () => true)); await until(() => f.completed); await tick();
    assert.deepEqual(f.publications, [0, 1, 2, 3]); assert.equal(f.factoryCalls, 1); assert.equal(f.acks.length, f.input.rows.length);
  } finally {await f.close();}
});
test("wrong original session binding cannot publish any output", async () => {
  const f = await fixture();
  try {f.sendHook = action => action === "output-read" ? {binding: {...binding, sessionId: "d".repeat(64)}, output: {phase: "active", acknowledged: 0, frame: f.input.rows[0]}} : undefined;
    await f.start(); await until(() => f.calls.includes("output-read")); await tick(); await tick();
    assert.deepEqual(f.publications, []); assert.deepEqual(f.acks, []); assert.equal(await f.session.settle(), false);
  } finally {await f.close();}
});
test("lost file EOF ACK retains published bytes without another copy or ACK attempt", async () => {
  const f = await fixture(); let failures = 0;
  try {f.sendHook = (action, body) => {if (action === "output-ack" && f.input.rows[body.sequence - 1]?.kind === "file-eof") {failures++; throw Error("unknown accepted ACK");}};
    await f.start(); await until(() => failures === 1); await tick(); await tick();
    assert.equal(f.published, 1); assert.deepEqual(f.publications, [0]); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
    assert.equal(failures, 1); assert.deepEqual(await readFile(path.join(f.root, `workspaces/${workspace}/artifacts/training-results/${publicationId}/0`)), f.input.bytes[0]);
  } finally {await f.close();}
});
test("cancel during an outstanding ACK prevents the next read even after that ACK returns", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  try {f.sendHook = async (action, body) => {if (action === "output-ack" && body.sequence === 1) {entered.resolve(); await gate.promise;}};
    await f.start(); await entered.promise; await f.session.cancel(); const reads = f.calls.filter(action => action === "output-read").length;
    assert.equal(await f.session.settle(), false); gate.resolve(); await tick(); await tick();
    assert.equal(f.calls.filter(action => action === "output-read").length, reads); assert.deepEqual(f.publications, []); assert.equal(f.releases, 0);
  } finally {gate.resolve(); await f.close();}
});
test("concurrent iterator advancement fences the receiver before any publication", async () => {
  const f = await fixture();
  try {f.storageHook = async file => {const iterator = file.content[Symbol.asyncIterator](); const first = iterator.next(), second = iterator.next();
      const replies = await Promise.allSettled([first, second]); assert.ok(replies.some(reply => reply.status === "rejected"));};
    await f.start(); await until(() => f.publications.length === 1); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.published, 0); assert.deepEqual(f.acks, [1]); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  } finally {await f.close();}
});
test("private wire accessors are rejected without executing them", async () => {
  const f = await fixture(); let traps = 0;
  try {const row = f.input.rows[0]!; Object.defineProperty(row, "files", {enumerable: true, get() {traps++; throw Error("accessor");}});
    await f.start(); await until(() => f.calls.includes("output-read")); await tick(); await tick();
    assert.equal(traps, 0); assert.deepEqual(f.publications, []); assert.equal(await f.session.settle(), false);
  } finally {await f.close();}
});
test("abort in the last permission/current callback prevents the physical read", async () => {
  const f = await fixture(); let checks = 0, reads = 0;
  try {let receiver: ReturnType<typeof createOriginalTrainingOutputReceiver>;
    receiver = createOriginalTrainingOutputReceiver({configuration: f.configuration, definition: definition(),
      assertCurrent() {if (++checks === 2) receiver.abort();}, assertAllowed: async () => {},
      async read() {reads++; return {phase: "bound", acknowledged: 0, frame: null};}, async acknowledge() {return true;}});
    receiver.start(); await tick(); await tick();
    assert.equal(reads, 0); assert.equal(receiver.isComplete(), false);
  } finally {await f.close();}
});
test("abort in the guard-to-effect microtask gap prevents dispatch", async () => {
  const f = await fixture(); let checks = 0, reads = 0;
  try {let receiver: ReturnType<typeof createOriginalTrainingOutputReceiver>;
    receiver = createOriginalTrainingOutputReceiver({configuration: f.configuration, definition: definition(),
      assertCurrent() {if (++checks === 2) queueMicrotask(() => receiver.abort());}, assertAllowed: async () => {},
      async read() {reads++; return {phase: "bound", acknowledged: 0, frame: null};}, async acknowledge() {return true;}});
    receiver.start(); await tick(); await tick(); assert.equal(reads, 0); assert.equal(receiver.isComplete(), false);
  } finally {await f.close();}
});
test("abort in the final completion callback cannot revive a transfer", async () => {
  const f = await fixture(); let finalChecks = 0;
  try {let receiver: ReturnType<typeof createOriginalTrainingOutputReceiver>;
    receiver = createOriginalTrainingOutputReceiver({configuration: f.configuration, definition: definition(),
      assertCurrent() {if (f.completed && ++finalChecks === 3) receiver.abort();}, assertAllowed: async () => {},
      read: async () => (await f.channel.send(`/training/original/${id}/output-read`, {binding}) as any).output,
      acknowledge: async sequence => (await f.channel.send(`/training/original/${id}/output-ack`, {binding, sequence}) as any).acknowledged});
    receiver.start(); await until(() => f.completed); await tick(); await tick();
    assert.equal(receiver.isComplete(), false); assert.equal(f.published, 4);
  } finally {await f.close();}
});
test("caught second iterator acquisition permanently fences the original consumer", async () => {
  const f = await fixture();
  try {const publish = f.storage.publishResultFile;
    f.storage.publishResultFile = async (file, context) => {const iterator = file.content[Symbol.asyncIterator]();
      assert.throws(() => file.content[Symbol.asyncIterator]());
      return publish({...file, content: {[Symbol.asyncIterator]: () => iterator}}, context);};
    await f.start(); await until(() => f.publications.length === 1); await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(f.published, 0); assert.equal(f.completed, false); assert.deepEqual(f.acks, [1]); assert.equal(await f.session.settle(), false);
  } finally {await f.close();}
});
for (const mode of ["task", "unknown-field", "group", "role", "name", "size", "hash", "offset", "sequence", "base64", "eof", "totals", "provisional"])
  test(`malformed ${mode} fences one receive flight without replay or release`, async () => {
    const f = await fixture();
    try {
      const manifest = f.input.rows[0]!, data = f.input.rows[1]!, eof = f.input.rows.find(row => row.kind === "file-eof")!, end = f.input.rows[f.input.rows.length - 1]!;
      if (mode === "task") manifest.taskId = workspace;
      if (mode === "unknown-field") manifest.extra = "denied";
      if (mode === "group") manifest.files[0].groupIndex = 1;
      if (mode === "role") manifest.files[0].role = "candidate";
      if (mode === "name") manifest.files[0].name = "../escape";
      if (mode === "size") manifest.files[0].sizeBytes = 32769;
      if (mode === "hash") manifest.files[0].sha256 = "sha256:" + "0".repeat(64);
      if (mode === "offset") data.offset = 1;
      if (mode === "sequence") data.sequence = 1;
      if (mode === "base64") data.data = "Zh=="; // Noncanonical pad bits.
      if (mode === "eof") eof.sizeBytes++;
      if (mode === "totals") end.totalBytes++;
      if (mode === "provisional") end.provisional = false;
      await f.start(); await until(() => f.calls.filter(action => action === "output-read").length > 0); await new Promise(resolve => setTimeout(resolve, 90));
      assert.equal(f.completed, false); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
      const count = f.calls.length; await tick(); await tick(); assert.equal(f.calls.length, count);
      assert.equal(new Set(f.publications).size, f.publications.length); assert.ok(f.publications.length <= 4);
    } finally {await f.close();}
  });
test("lost accepted publication is retained and never reissued or acknowledged", async () => {
  const f = await fixture();
  try {const publish = f.storage.publishResultFile; // Factory captures this original method before startup.
    f.storage.publishResultFile = async (file, context) => {const result = await publish(file, context); assert.ok(result.ok); throw Error("lost acknowledgement");};
    await f.start(); await until(() => f.published === 1); await tick();
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0); assert.deepEqual(f.publications, [0]);
    assert.equal(f.acks.some(sequence => f.input.rows[sequence - 1]?.kind === "file-eof"), false);
    assert.equal((await readdir(path.join(f.root, `workspaces/${workspace}/artifacts/training-results/${publicationId}`))).length, 1);
  } finally {await f.close();}
});
test("cancel fences receiver before withdrawn permission can deny remote cancel", async () => {
  const f = await fixture(), gate = deferred(), entered = deferred();
  try {f.storageHook = async () => {entered.resolve(); await gate.promise;}; await f.start(); await entered.promise;
    f.deny(); await assert.rejects(() => f.session.cancel()); assert.equal(f.calls.includes("cancel"), false);
    assert.equal(await f.session.settle(), false); gate.resolve(); await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(f.acks, [1]); assert.equal(f.published, 0); assert.equal(f.releases, 0);
  } finally {gate.resolve(); await f.close();}
});
test("factory reentrant cancellation cannot start the channel", async () => {
  const f = await fixture(); let cancellation: Promise<unknown> | undefined;
  try {f.configureHook = () => {cancellation = f.session.cancel();}; assert.equal(await f.session.prepare(), "unconfirmed");
    await assert.rejects(() => cancellation!); assert.deepEqual(f.calls, []); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
  } finally {await f.close();}
});
test("captured port and context cannot be replaced while startup awaits", async () => {
  const f = await fixture();
  try {const gate = deferred(), entered = deferred(); f.sendHook = async action => {if (action === "prepare") {entered.resolve(); await gate.promise;}};
    const prepare = f.session.prepare(); await entered.promise;
    f.storage.publishResultFile = async () => {throw Error("replacement");};
    (f.configuration.context as any).workspaceId = id; f.options.createOutputStorage = () => {throw Error("replacement factory");};
    gate.resolve(); assert.equal(await prepare, "ready"); assert.equal((await f.session.start(staged(), () => true)).kind, "accepted");
    await until(() => f.completed); await tick(); assert.equal(f.published, 4); assert.equal(await f.session.settle(), true);
  } finally {await f.close();}
});
test("mismatched owner, accessor factory and async factory fail before startup", async () => {
  const f = await fixture(); try {
    (f.configuration.context as any).principalId = "other";
    assert.equal(await f.session.prepare(), "unconfirmed"); assert.deepEqual(f.calls, []);
    const base = {captureChannel: async () => f.channel, reserve: () => () => {}};
    assert.throws(() => createOriginalTrainingPort({...base, get createOutputStorage(): never {throw Error("getter ran");}}), error => !String(error).includes("getter ran"));
    const session = createOriginalTrainingPort({...base, createOutputStorage: (async () => {throw Error("async denied");}) as never}).createSession(definition(), {isCurrent: () => true, stillAllowed: async () => true})!;
    assert.equal(await session.prepare(), "unconfirmed"); assert.equal(await session.settle(), false); await tick();
  } finally {await f.close();}
});
test("finite deadline fences a still-pending read without claiming IO retirement", async () => {
  const f = await fixture(), gate = deferred<unknown>();
  try {(f.configuration as any).maximumDurationMs = 15; f.sendHook = action => action === "output-read" ? gate.promise : undefined;
    await f.start(); await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
    gate.resolve({binding, output: {phase: "active", acknowledged: 0, frame: f.input.rows[0]}}); await tick();
    assert.deepEqual(f.publications, []); assert.equal(await f.session.settle(), false);
  } finally {gate.resolve(undefined); await f.close();}
});
test("original HTTP output-only body limit is 128 KiB; existing actions stay at 64 KiB", async () => {
  let bodyBytes = 70 * 1024; const requests: string[] = [];
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: "synthetic-token-".padEnd(40, "x"),
    captureProcessOwnership: () => () => {}, fetchImplementation: (async (url, init) => {
      const endpoint = new URL(String(url)).pathname; requests.push(endpoint); assert.ok(new Headers(init?.headers).get("authorization")?.startsWith("Bearer "));
      if (endpoint === "/health") return Response.json({healthy: true, status: {...runtime, status: "ready"}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId, capabilities: [ORIGINAL_TRAINING_CAPABILITY]});
      return new Response(JSON.stringify({padding: "x".repeat(bodyBytes)}));
    }) as typeof fetch});
  const channel = await client.captureOriginalTrainingChannel(profile);
  assert.equal((await channel.send(`/training/original/${id}/output-read`, {binding}) as any).padding.length, bodyBytes);
  assert.equal((await channel.send(`/training/original/${id}/output-ack`, {binding, sequence: 1}) as any).padding.length, bodyBytes);
  for (const action of ["seal", "start", "read", "cancel", "settle"]) await assert.rejects(() => channel.send(`/training/original/${id}/${action}`, {binding}));
  bodyBytes = 128 * 1024; await assert.rejects(() => channel.send(`/training/original/${id}/output-read`, {binding}));
  const count = requests.length; await assert.rejects(() => channel.send(`/training/original/${id}/output-delete`, {binding})); assert.equal(requests.length, count);
});
