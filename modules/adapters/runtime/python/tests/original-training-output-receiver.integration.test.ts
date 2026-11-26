import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
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
async function fixture(large = false, trackIoRetirement = false, exitReady = false) {
  const root = await mkdtemp(path.join(tmpdir(), "training-receive-"));
  const original = createFilesystemTrainingResultFileByteStorageAdapter({rootDirectory: root, publicationId, maximumFiles: 8, maximumFileBytes: 32768, maximumTotalBytes: 131072, trackIoRetirement});
  const input = frames(large), calls: string[] = [], acks: number[] = [];
  let current = true, permission = true, releases = 0, published = 0, ack = 0, completed = false;
  const f = {root, original, input, calls, acks, publications: [] as number[], factoryCalls: 0, workerRetirements: 0,
    retireHook: undefined as undefined | (() => Promise<boolean>),
    releaseHook: undefined as undefined | (() => unknown),
    ioRetirement: undefined as ReturnType<NonNullable<TrainingResultFileByteStoragePort["captureIoRetirement"]>> | undefined,
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
  if (trackIoRetirement) storage.captureIoRetirement = (input, context) => {
    f.ioRetirement = original.captureIoRetirement!(input, context); return f.ioRetirement;
  };
  const configuration: OriginalTrainingOutputStorage = {storage, context: {requestId: id, workspaceId: workspace, organizationId: "org" as OrganizationId, principalId: "actor"},
    publicationId, maximumFiles: 8, maximumFileBytes: 32768, maximumTotalBytes: 131072, maximumDurationMs: 10000};
  const channel: OriginalTrainingOwnedChannel = {identity, assertCurrent() {assert.ok(current);},
    async retireOriginalWorker() {f.workerRetirements++; return f.retireHook ? f.retireHook() : true;}, releaseUnusedWorker() {},
    async send(endpoint, body: any, dispatch) {
      dispatch?.(); const segments = endpoint.split("/"), action = segments[segments.length - 1]!; calls.push(action);
      const result = await f.sendHook?.(action, body); if (result !== undefined) return result;
      if (action === "prepare" || action === "seal") return {binding, phase: "ready"};
      if (action === "start") return {binding, kind: "accepted", requestId: id, workspaceId: workspace, status: "running"};
      if (action === "cancel") return {binding, cancelled: true};
      if (action === "settle") return {binding, settled: true, retirement: "settled"};
      if (action === "exit-ready") return {binding, schema: "original-training-exit-ready-v1", ready: true, retirement: "ready"};
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
  const options = {captureChannel: async () => channel, reserve: () => () => {releases++; return f.releaseHook?.();},
    ...(exitReady ? {retirementProtocol: "original-exit-ready-v1" as const} : {}),
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

test("exit-ready parent fences actual storage before readiness and retains bytes after original worker retirement", async () => {
  const f = await fixture(false, true, true);
  try {
    f.sendHook = action => {if (action === "exit-ready") {
      assert.equal(f.ioRetirement!.inspect().phase, "closed");
      assert.equal(f.ioRetirement!.inspect().pendingOperations, 0);
      assert.equal(f.published, 4); assert.equal(f.releases, 0);
    }};
    await f.start(); await until(() => f.completed); await tick();
    assert.equal(await f.session.settle(), true); assert.equal(await f.session.settle(), true);
    assert.equal(f.calls.filter(action => action === "exit-ready").length, 1); assert.equal(f.calls.includes("settle"), false);
    assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 1);
    const calls = [...f.calls]; assert.equal((await f.session.read()).status, "succeeded"); await f.session.cancel();
    assert.deepEqual(f.calls, calls); await assert.rejects(() => f.session.start(staged(), () => true));
    for (let i = 0; i < 4; i++) assert.deepEqual(await readFile(path.join(f.root,
      `workspaces/${workspace}/artifacts/training-results/${publicationId}/${i}`)), f.input.bytes[i]);
  } finally {await f.close();}
});

test("exit-ready requires parent IO support before any original channel startup", async () => {
  const f = await fixture(false, false, true);
  try {assert.equal(await f.session.prepare(), "unconfirmed"); assert.deepEqual(f.calls, []);
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0); assert.equal(f.workerRetirements, 0);
  } finally {await f.close();}
});

test("exit-ready no-effect preparation closes only its unused local IO before releasing execution", async () => {
  const f = await fixture(false, true, true);
  try {
    f.sendHook = action => action === "prepare" ? {binding, phase: "unavailable"} : undefined;
    assert.equal(await f.session.prepare(), "unavailable"); assert.equal(f.ioRetirement!.inspect().phase, "closed");
    assert.equal(f.releases, 1); assert.equal(f.workerRetirements, 0); assert.equal(await f.session.settle(), true);
    assert.deepEqual(f.calls, ["prepare"]); assert.deepEqual(f.publications, []);
  } finally {await f.close();}
});

test("exit-ready uncertainty detected after original worker retirement still retains execution and bytes", async () => {
  const f = await fixture(false, true, true); let retired = false;
  try {
    const capture = f.storage.captureIoRetirement!;
    f.storage.captureIoRetirement = (input, context) => {
      const capability = capture(input, context);
      return {fencePublication: capability.fencePublication,
        inspect() {const row = capability.inspect(); return retired ? {...row, phase: "unconfirmed"} : row;}};
    };
    f.retireHook = async () => {retired = true; return true;};
    await f.start(); await until(() => f.completed); await tick();
    assert.equal(await f.session.settle(), false); const calls = [...f.calls];
    assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 0); assert.equal(await f.session.settle(), false);
    assert.deepEqual(f.calls, calls); assert.equal(f.workerRetirements, 1); assert.equal(f.published, 4);
  } finally {await f.close();}
});

test("exit-ready waits for the actual cancelled ACK promise without requiring renewed permission", async () => {
  const f = await fixture(false, true, true), gate = deferred(), entered = deferred();
  try {
    f.sendHook = async (action, body) => {
      if (action === "output-ack" && body.sequence === 1) {entered.resolve(); await gate.promise;}
      if (action === "read") return {binding, record: {requestId: id, taskType: "train-model", status: "cancelled", metadata: {workspaceId: workspace}}};
    };
    await f.start(); await entered.promise; await f.session.cancel();
    assert.equal(await f.session.settle(), false); const calls = [...f.calls];
    assert.equal(calls.includes("exit-ready"), false); assert.equal(f.workerRetirements, 0); assert.equal(f.releases, 0);
    f.deny(); gate.resolve(); await tick(); await tick();
    assert.equal(await f.session.settle(), true); assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 1);
    assert.equal(f.published, 0); assert.equal(f.calls.filter(action => action === "read").length, 1);
  } finally {gate.resolve(); await tick(); await f.close();}
});

test("known pending exit readiness permits only another nonconsuming readiness observation", async () => {
  const f = await fixture(false, true, true); let observations = 0;
  try {
    f.sendHook = action => action === "exit-ready" && ++observations === 1
      ? {binding, schema: "original-training-exit-ready-v1", ready: false, retirement: "pending"} : undefined;
    await f.start(); await until(() => f.completed); await tick();
    assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0); const calls = [...f.calls];
    await f.session.read(); await f.session.cancel(); assert.deepEqual(f.calls, calls);
    assert.equal(await f.session.settle(), true); assert.deepEqual(f.calls.slice(calls.length), ["exit-ready"]);
    assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 1);
  } finally {await f.close();}
});

test("exit-ready retains a late actual publication and its bytes until the original promise returns", async () => {
  const f = await fixture(false, true, true), gate = deferred(), entered = deferred();
  try {
    const publish = f.storage.publishResultFile;
    f.storage.publishResultFile = async (file, context) => {
      const result = await publish(file, context); entered.resolve(); await gate.promise; return result;
    };
    f.sendHook = action => action === "read" ? {binding, record: {requestId: id, taskType: "train-model", status: "failed", metadata: {workspaceId: workspace}}} : undefined;
    await f.start(); await entered.promise;
    assert.equal(await f.session.settle(), false); assert.equal(f.published, 1); assert.equal(f.workerRetirements, 0);
    assert.equal(f.calls.includes("exit-ready"), false); assert.equal(f.releases, 0);
    gate.resolve(); await tick(); await tick(); assert.equal(await f.session.settle(), true);
    assert.equal(f.releases, 1); assert.deepEqual(f.publications, [0]);
    assert.deepEqual(await readFile(path.join(f.root,
      `workspaces/${workspace}/artifacts/training-results/${publicationId}/0`)), f.input.bytes[0]);
  } finally {gate.resolve(); await tick(); await f.close();}
});

for (const mode of ["lost", "legacy", "mixed", "extra", "binding"] as const)
  test(`unknown ${mode} exit readiness never retries, retires worker or releases execution`, async () => {
    const f = await fixture(false, true, true);
    try {
      f.sendHook = action => {
        if (action !== "exit-ready") return undefined;
        if (mode === "lost") throw Error("synthetic lost readiness");
        if (mode === "legacy") return {binding, settled: true, retirement: "settled"};
        return {binding: mode === "binding" ? {...binding, workspaceId: "other"} : binding,
          schema: "original-training-exit-ready-v1", ready: mode !== "mixed", retirement: "ready", ...(mode === "extra" ? {settled: true} : {})};
      };
      await f.start(); await until(() => f.completed); await tick();
      assert.equal(await f.session.settle(), false); f.sendHook = undefined;
      const calls = [...f.calls]; assert.equal(await f.session.settle(), false);
      assert.equal((await f.session.read()).status, "succeeded"); await f.session.cancel();
      assert.deepEqual(f.calls, calls); assert.equal(f.calls.filter(action => action === "exit-ready").length, 1);
      assert.equal(f.workerRetirements, 0); assert.equal(f.releases, 0);
    } finally {await f.close();}
  });

test("exit-ready keeps the same retirement owner and cached result while actual worker exit is pending", async () => {
  const f = await fixture(false, true, true), entered = deferred(), gate = deferred<boolean>();
  try {
    f.retireHook = () => {entered.resolve(); return gate.promise;};
    await f.start(); await until(() => f.completed); await tick();
    const retirement = f.session.settle(); await entered.promise;
    f.channel.retireOriginalWorker = async () => {throw Error("replacement must not run");};
    const calls = [...f.calls]; assert.equal(await f.session.settle(), false); assert.equal(f.releases, 0);
    assert.equal((await f.session.read()).status, "succeeded"); await f.session.cancel(); assert.deepEqual(f.calls, calls);
    gate.resolve(true); assert.equal(await retirement, true); assert.equal(f.workerRetirements, 1); assert.equal(f.releases, 1);
  } finally {gate.resolve(false); await tick(); await f.close();}
});

for (const mode of ["throw", "resolved-promise", "rejected-promise", "value"] as const)
  test(`uncertain exit-ready release is attempted once after original retirement (${mode})`, async () => {
    const f = await fixture(false, true, true);
    try {
      f.releaseHook = () => {
        if (mode === "throw") throw Error("synthetic unknown release");
        if (mode === "resolved-promise") return Promise.resolve();
        if (mode === "rejected-promise") return Promise.reject(Error("synthetic unknown asynchronous release"));
        return false;
      };
      await f.start(); await until(() => f.completed); await tick();
      assert.equal(await f.session.settle(), false); const calls = [...f.calls];
      f.releaseHook = undefined;
      assert.equal(await f.session.settle(), false); await tick();
      assert.equal(f.releases, 1); assert.equal(f.workerRetirements, 1); assert.deepEqual(f.calls, calls);
      assert.equal(f.calls.filter(action => action === "exit-ready").length, 1); assert.equal(f.published, 4);
      assert.deepEqual(await readFile(path.join(f.root,
        `workspaces/${workspace}/artifacts/training-results/${publicationId}/0`)), f.input.bytes[0]);
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
for (const mode of ["task", "unknown-field", "group", "role", "name", "unknown-name", "duplicate-name", "no-candidate", "mixed-role", "size", "hash", "offset", "sequence", "base64", "eof", "totals", "provisional"])
  test(`malformed ${mode} fences one receive flight without replay or release`, async () => {
    const f = await fixture(); let preparations = 0;
    try {
      f.storage.preparePublication = async () => {preparations++;};
      const manifest = f.input.rows[0]!, data = f.input.rows[1]!, eof = f.input.rows.find(row => row.kind === "file-eof")!, end = f.input.rows[f.input.rows.length - 1]!;
      if (mode === "task") manifest.taskId = workspace;
      if (mode === "unknown-field") manifest.extra = "denied";
      if (mode === "group") manifest.files[0].groupIndex = 1;
      if (mode === "role") manifest.files[0].role = "candidate";
      if (mode === "name") manifest.files[0].name = "../escape";
      if (mode === "unknown-name") manifest.files[0].name = "unlisted.bin";
      if (mode === "duplicate-name") manifest.files[1].name = manifest.files[0].name;
      if (mode === "no-candidate") manifest.files.forEach((file: any) => {file.role = "checkpoint";});
      if (mode === "mixed-role") manifest.files[2].role = "checkpoint";
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
      assert.equal(preparations, ["task", "unknown-field", "group", "role", "name", "unknown-name", "duplicate-name", "no-candidate", "mixed-role", "size"].includes(mode) ? 0 : 1);
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
function directReceiver(f: Awaited<ReturnType<typeof fixture>>, hooks: {
  read?: () => Promise<unknown>; acknowledge?: (sequence: number) => Promise<unknown>;
  assertAllowed?: () => Promise<void>; assertCurrent?: () => void;
} = {}) {
  let ack = 0;
  return createOriginalTrainingOutputReceiver({configuration: f.configuration, definition: definition(),
    assertCurrent: hooks.assertCurrent ?? (() => {}), assertAllowed: hooks.assertAllowed ?? (async () => {}),
    read: hooks.read ?? (async () => ({phase: "active", acknowledged: ack, frame: f.input.rows[ack]})),
    acknowledge: hooks.acknowledge ?? (async sequence => {assert.equal(sequence, ack + 1); ack++; return true;})});
}

test("complete frozen inventory is prepared once before the manifest ACK releases any file data", async () => {
  const f = await fixture(), gate = deferred(); let preparations = 0, reads = 0;
  let prepared: Parameters<NonNullable<TrainingResultFileByteStoragePort["preparePublication"]>>[0] | undefined;
  try {
    f.storage.preparePublication = async (inventory, context) => {
      preparations++; assert.equal(context.workspaceId, workspace); assert.ok(Object.isFrozen(context));
      assert.equal(inventory.publicationId, publicationId); assert.equal(inventory.totalBytes, f.input.bytes.reduce((n, b) => n + b.length, 0));
      assert.ok(Object.isFrozen(inventory)); assert.ok(Object.isFrozen(inventory.files));
      assert.deepEqual(inventory.files, f.input.files.map(file => ({fileIndex: file.fileIndex,
        groupIndex: file.groupIndex, name: file.name, role: file.role,
        mediaType: file.name.endsWith(".json") ? "application/json" : "application/octet-stream",
        expectedSizeBytes: file.sizeBytes, expectedSha256: file.sha256})));
      assert.ok(inventory.files.every(Object.isFrozen));
      assert.throws(() => {(inventory.files[0] as any).expectedSizeBytes++;});
      assert.throws(() => {(inventory.files[0] as any).groupIndex = 9;});
      assert.throws(() => {(inventory.files[0] as any).name = "redirected.bin";});
      assert.throws(() => {(inventory.files[0] as any).role = "candidate";});
      prepared = inventory; await gate.promise;
    };
    const receiver = directReceiver(f, {read: async () => {reads++; return {phase: "active", acknowledged: 0, frame: f.input.rows[0]};},
      acknowledge: async () => {f.acks.push(1); throw Error("stop after preparation");}});
    f.storage.preparePublication = async () => {throw Error("replacement must not run");};
    receiver.start(); await until(() => preparations === 1); await tick();
    assert.ok(prepared);
    f.input.files[0]!.groupIndex = 9; f.input.files[0]!.name = "../redirected"; f.input.files[0]!.role = "candidate";
    assert.equal(prepared.files[0]!.groupIndex, 0); assert.equal(prepared.files[0]!.name, "config.json");
    assert.equal(prepared.files[0]!.role, "checkpoint");
    assert.equal(reads, 1); assert.deepEqual(f.acks, []); assert.equal(f.published, 0);
    assert.equal(receiver.inspectIoRetirement().pendingOperations, 1);
    gate.resolve(); await until(() => receiver.inspectIoRetirement().drainFinished);
    assert.equal(preparations, 1); assert.deepEqual(f.acks, [1]); assert.equal(f.published, 0);
  } finally {gate.resolve(); await f.close();}
});

test("optional inventory preparation preserves the complete original-session publication flow", async () => {
  const f = await fixture(); let preparations = 0;
  try {
    f.storage.preparePublication = async () => {preparations++; assert.equal(f.published, 0); assert.deepEqual(f.acks, []);};
    await f.start(); await until(() => f.completed); await tick();
    assert.equal(preparations, 1); assert.equal(f.published, 4); assert.equal(await f.session.settle(), true);
  } finally {await f.close();}
});

for (const mode of ["reject", "malformed-result", "thenable"] as const) {
  test(`inventory preparation ${mode} cannot release the first data frame or retry`, async () => {
    const f = await fixture(false, true); let preparations = 0, thenCalls = 0;
    try {
      f.storage.preparePublication = (mode === "thenable" ? (() => {preparations++; return {then() {thenCalls++;}};}) :
        (async () => {preparations++; if (mode === "reject") throw Error("private preparation detail"); return true;})) as never;
      const receiver = directReceiver(f, {acknowledge: async sequence => {f.acks.push(sequence); return true;}});
      receiver.start(); await until(() => receiver.inspectIoRetirement().drainFinished); receiver.abort();
      assert.equal(receiver.isComplete(), false); assert.deepEqual(f.acks, []); assert.equal(f.published, 0);
      assert.equal(preparations, 1); assert.equal(thenCalls, 0); assert.throws(() => receiver.start());
      assert.equal(receiver.inspectIoRetirement().pendingOperations, mode === "thenable" ? 1 : 0);
      if (mode === "thenable") assert.equal(receiver.inspectIoRetirement().phase, "unconfirmed");
    } finally {await f.close();}
  });
}

for (const mode of ["abort", "deadline", "permission-withdrawn"] as const) {
  test(`inventory preparation retains its actual operation after ${mode} without a late data ACK`, async () => {
    const f = await fixture(false, true), gate = deferred(), entered = deferred(); let permission = true, preparations = 0;
    try {
      if (mode === "deadline") (f.configuration as any).maximumDurationMs = 15;
      f.storage.preparePublication = async () => {preparations++; entered.resolve(); await gate.promise;};
      const receiver = directReceiver(f, {assertAllowed: async () => {assert.equal(permission, true);},
        acknowledge: async sequence => {f.acks.push(sequence); return true;}});
      receiver.start(); await entered.promise;
      if (mode === "deadline") await new Promise(resolve => setTimeout(resolve, 40));
      else if (mode === "abort") receiver.abort();
      else permission = false;
      assert.equal(receiver.inspectIoRetirement().pendingOperations, 1);
      assert.notEqual(receiver.inspectIoRetirement().phase, "closed"); assert.deepEqual(f.acks, []);
      gate.resolve(); await until(() => receiver.inspectIoRetirement().drainFinished && receiver.inspectIoRetirement().pendingOperations === 0); receiver.abort();
      assert.equal(receiver.inspectIoRetirement().pendingOperations, 0); assert.equal(receiver.isComplete(), false);
      assert.deepEqual(f.acks, []); assert.equal(f.published, 0); assert.equal(preparations, 1);
      assert.equal(receiver.inspectIoRetirement().phase, "closed");
    } finally {gate.resolve(); await f.close();}
  });
}

test("invalid manifest and preparation accessors are rejected before invoking preparation", async () => {
  const f = await fixture(); let invoked = 0;
  try {
    Object.defineProperty(f.storage, "preparePublication", {configurable: true, enumerable: true, get() {invoked++; throw Error("must not run");}});
    assert.throws(() => directReceiver(f)); assert.equal(invoked, 0);
    Object.defineProperty(f.storage, "preparePublication", {value: async () => {invoked++;}});
    f.input.rows[0]!.files[0].name = "not-approved.exe";
    const receiver = directReceiver(f); receiver.start(); await until(() => receiver.inspectIoRetirement().drainFinished);
    assert.equal(invoked, 0); assert.equal(f.published, 0); assert.equal(receiver.isComplete(), false);
  } finally {await f.close();}
});

test("tracked real publication closes locally only after its permanent fence; methods were captured", async () => {
  const f = await fixture(true, true);
  try {
    const receiver = directReceiver(f); f.storage.captureIoRetirement = () => {throw Error("replaced capture");};
    receiver.start(); await until(() => receiver.isComplete());
    assert.equal(f.published, 4); assert.equal(receiver.inspectIoRetirement().phase, "open");
    receiver.abort(); const row = receiver.inspectIoRetirement();
    assert.equal(row.phase, "closed"); assert.equal(row.pendingOperations, 0);
    assert.equal(row.issuedOperations, row.returnedOperations); assert.ok(row.issuedOperations > 8);
    assert.equal(row.publicationUnconfirmed, false); assert.throws(() => receiver.start());
    assert.equal(f.releases, 0, "local IO proof cannot release the original reservation");
  } finally {await f.close();}
});

test("legacy two-method storage remains compatible and supplies no failure-path retirement proof", async () => {
  const f = await fixture();
  try {const receiver = directReceiver(f); receiver.start(); await until(() => receiver.isComplete()); receiver.abort();
    assert.equal(receiver.inspectIoRetirement().phase, "unconfirmed");
    assert.equal(receiver.inspectIoRetirement().storagePhase, "unavailable"); assert.equal(f.published, 4);
  } finally {await f.close();}
});

for (const action of ["read", "acknowledge", "permission"] as const)
  test(`deadline does not retire the actual pending ${action}; late return closes without another effect`, async () => {
    const f = await fixture(false, true), gate = deferred<any>(), entered = deferred(); let calls = 0;
    try {
      (f.configuration as any).maximumDurationMs = 20;
      const hook = () => {calls++; entered.resolve(); return gate.promise;};
      // Permission has no effect deadline of its own: abort and let its actual
      // promise remain pending until return, without requiring new permission.
      const receiver = directReceiver(f, action === "permission" ? {assertAllowed: hook} : {[action]: hook});
      receiver.start(); await entered.promise; receiver.abort(); await new Promise(resolve => setTimeout(resolve, 45));
      const pending = receiver.inspectIoRetirement(); assert.equal(pending.phase, "pending"); assert.ok(pending.pendingOperations > 0);
      if (action !== "permission") assert.equal(pending.drainFinished, true);
      gate.resolve(action === "acknowledge" ? true : action === "read" ? {phase: "active", acknowledged: 0, frame: f.input.rows[0]} : undefined);
      await until(() => receiver.inspectIoRetirement().phase === "closed");
      assert.equal(calls, 1); assert.equal(f.published, 0); assert.equal(f.releases, 0);
    } finally {gate.resolve(undefined); await tick(); await f.close();}
  });

test("a publisher returning while an iterator is still advancing cannot erase read or iterator operations", async () => {
  const f = await fixture(false, true), gate = deferred<unknown>(), entered = deferred(); let reads = 0;
  try {
    (f.configuration as any).maximumDurationMs = 25;
    f.storage.publishResultFile = async file => {
      const pending = file.content[Symbol.asyncIterator]().next(); void pending.catch(() => {});
      await entered.promise; throw Error("publisher returned before iterator");
    };
    const receiver = directReceiver(f, {read() {if (++reads === 1) return Promise.resolve({phase: "active", acknowledged: 0, frame: f.input.rows[0]});
      entered.resolve(); return gate.promise;}});
    receiver.start(); await entered.promise; await new Promise(resolve => setTimeout(resolve, 40));
    const pending = receiver.inspectIoRetirement(); assert.equal(pending.drainFinished, true); assert.equal(pending.phase, "pending");
    assert.ok(pending.pendingOperations > 0); gate.resolve({phase: "active", acknowledged: 1, frame: f.input.rows[1]});
    await until(() => receiver.inspectIoRetirement().phase === "closed"); assert.equal(reads, 2); assert.equal(f.published, 0);
  } finally {gate.resolve(undefined); await tick(); await f.close();}
});

test("a late publication wrapper remains pending after timeout even though its real file has closed", async () => {
  const f = await fixture(false, true), gate = deferred(), entered = deferred();
  try {
    (f.configuration as any).maximumDurationMs = 25; const publish = f.storage.publishResultFile;
    f.storage.publishResultFile = async (file, context) => {const result = await publish(file, context); entered.resolve(); await gate.promise; return result;};
    const receiver = directReceiver(f); receiver.start(); await entered.promise; await new Promise(resolve => setTimeout(resolve, 45));
    const row = receiver.inspectIoRetirement(); assert.equal(row.drainFinished, true); assert.equal(row.phase, "pending");
    assert.equal(row.storagePhase, "closed"); assert.equal(row.pendingOperations, 1); assert.equal(f.published, 1);
    gate.resolve(); await until(() => receiver.inspectIoRetirement().phase === "closed");
    assert.equal(f.published, 1); assert.equal(f.releases, 0);
  } finally {gate.resolve(); await tick(); await f.close();}
});

for (const mode of ["throw", "thenable"])
  test(`an accepted ${mode} without an original promise leaves a permanent unknown operation`, async () => {
    const f = await fixture(false, true);
    try {let calls = 0; const receiver = directReceiver(f, {read: (() => {calls++; if (mode === "throw") throw Error("unknown dispatch"); return {then() {throw Error("must not assimilate");}};}) as never});
      receiver.start(); await tick(); await tick(); receiver.abort();
      const row = receiver.inspectIoRetirement(); assert.equal(row.phase, "unconfirmed"); assert.equal(row.pendingOperations, 1);
      assert.equal(row.drainFinished, true); assert.equal(calls, 1); assert.equal(f.published, 0);
    } finally {await f.close();}
  });

test("retirement capability getters and unknown port fields are denied without running them", async () => {
  const f = await fixture(); let getters = 0;
  try {
    Object.defineProperty(f.storage, "captureIoRetirement", {configurable: true, enumerable: true, get() {getters++; throw Error("getter ran");}});
    assert.throws(() => directReceiver(f)); assert.equal(getters, 0);
    Object.defineProperty(f.storage, "captureIoRetirement", {value: () => ({fencePublication() {}, get inspect() {getters++; throw Error("getter ran");}})});
    assert.throws(() => directReceiver(f)); assert.equal(getters, 0);
  } finally {await f.close();}
});

test("async retirement capabilities cannot claim synchronous closure or leak rejected promises", () => {
  // A separate bounded Node process observes unhandled rejections without
  // weakening the test runner's own unhandled-rejection failure behavior.
  const program = `
    const {createOriginalTrainingOutputReceiver:create}=require('./modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts');
    const {createFilesystemTrainingResultFileByteStorageAdapter:storageFactory}=require('./modules/adapters/storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter.ts');
    const definition=${JSON.stringify(definition())}, publicationId=${JSON.stringify(publicationId)};
    let unhandled=0, thenCalls=0; process.on('unhandledRejection',()=>{unhandled++}); const rows=[],fenceAttempts=[];
    for(const mode of ['capture-reject','capture-thenable','fence-pending','fence-resolve','fence-reject','inspect-reject']) {
      const storage=storageFactory({rootDirectory:'synthetic-no-io',publicationId,maximumFiles:8,maximumFileBytes:32768,maximumTotalBytes:131072,trackIoRetirement:true});
      const capture=storage.captureIoRetirement;
      storage.captureIoRetirement=(input,context)=>{
        if(mode==='capture-reject')return Promise.reject(Error('synthetic capture rejection'));
        if(mode==='capture-thenable')return {get then(){thenCalls++;throw Error('must not assimilate')}};
        const cap=capture(input,context);
        return {fencePublication(){fenceAttempts.push(mode);cap.fencePublication();
          if(mode==='fence-pending')return new Promise(()=>{});
          if(mode==='fence-resolve')return Promise.resolve();
          if(mode==='fence-reject')return Promise.reject(Error('synthetic fence rejection'));
        },inspect(){if(mode==='inspect-reject')return Promise.reject(Error('synthetic inspection rejection'));return cap.inspect();}};
      };
      try {
        const receiver=create({configuration:{storage,context:{requestId:definition.requestId,workspaceId:definition.workspaceId,organizationId:'org',principalId:'actor'},publicationId,maximumFiles:8,maximumFileBytes:32768,maximumTotalBytes:131072,maximumDurationMs:1000},definition,
          assertCurrent(){},async assertAllowed(){},async read(){throw Error('must not read')},async acknowledge(){throw Error('must not ACK')}});
        receiver.abort();receiver.abort();rows.push({mode,phase:receiver.inspectIoRetirement().phase,fenceCalls:fenceAttempts.filter(value=>value===mode).length});
      }catch{rows.push({mode,phase:'denied'});}
    }
    setTimeout(()=>process.stdout.write(JSON.stringify({rows,unhandled,thenCalls})),30);
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program],
    {encoding: "utf8", timeout: 5000, maxBuffer: 65536}));
  assert.deepEqual(result.rows, [
    {mode: "capture-reject", phase: "denied"}, {mode: "capture-thenable", phase: "denied"},
    ...["fence-pending", "fence-resolve", "fence-reject", "inspect-reject"].map(mode => ({mode, phase: "unconfirmed", fenceCalls: 1})),
  ]);
  assert.equal(result.unhandled, 0); assert.equal(result.thenCalls, 0);
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


test("completed delivery retains detached four-file facts only after final ACK and fenced IO retirement", async () => {
  const f = await fixture(false, true), finalAck = deferred(); let ack = 0, finalEntered = false;
  try {
    const receiver = directReceiver(f, {read: async () => ({phase: "active", acknowledged: ack, frame: f.input.rows[ack]}),
      acknowledge: async sequence => {
        assert.equal(sequence, ack + 1);
        if (sequence === f.input.rows.length) {finalEntered = true; await finalAck.promise;}
        ack++; return true;
      }});
    assert.equal(receiver.inspectCompletedDelivery(), undefined);
    receiver.start(); await until(() => finalEntered);
    assert.equal(f.published, 4); assert.equal(receiver.isComplete(), false);
    assert.equal(receiver.inspectCompletedDelivery(), undefined);
    finalAck.resolve(); await until(() => receiver.inspectIoRetirement().drainFinished);
    assert.equal(receiver.isComplete(), true); assert.equal(receiver.inspectCompletedDelivery(), undefined);
    receiver.abort(); assert.equal(receiver.inspectIoRetirement().phase, "closed");
    const record = receiver.inspectCompletedDelivery()!;
    assert.deepEqual(record, {schema: "original-training-completed-output-delivery-v1", requestId: id,
      workspaceId: workspace, publicationId, acknowledgedSequence: f.input.rows.length,
      totalBytes: f.input.bytes.reduce((sum, bytes) => sum + bytes.length, 0),
      files: f.input.files.map(file => ({fileIndex: file.fileIndex, groupIndex: file.groupIndex,
        name: file.name, role: file.role, mediaType: file.name.endsWith(".json") ? "application/json" : "application/octet-stream",
        expectedSizeBytes: file.sizeBytes, expectedSha256: file.sha256}))});
    assert.ok(Object.isFrozen(record) && Object.isFrozen(record.files) && record.files.every(Object.isFrozen));
    assert.throws(() => {(record.files[0] as any).role = "candidate";});
    const again = receiver.inspectCompletedDelivery()!;
    assert.notEqual(again, record); assert.notEqual(again.files, record.files); assert.notEqual(again.files[0], record.files[0]);
    f.input.files[0]!.name = "redirected"; f.input.files[0]!.groupIndex = 9;
    assert.equal(receiver.inspectCompletedDelivery()!.files[0]!.name, "config.json");
    assert.equal(receiver.inspectCompletedDelivery()!.files[0]!.groupIndex, 0);
    const calls = [...f.publications]; assert.deepEqual(receiver.inspectCompletedDelivery(), record);
    assert.deepEqual(f.publications, calls, "metadata inspection cannot republish files");
    assert.throws(() => receiver.start());
  } finally {finalAck.resolve(); await f.close();}
});

for (const mode of ["lost-final-ack", "withdraw-current", "withdraw-permission", "invalid-complete"] as const) {
  test(`completed delivery is unavailable after ${mode} despite four published files`, async () => {
    const f = await fixture(false, true); let ack = 0, current = true, allowed = true;
    try {
      if (mode === "invalid-complete") f.input.rows[f.input.rows.length - 1]!.totalBytes++;
      const receiver = directReceiver(f, {assertCurrent() {assert.ok(current);}, assertAllowed: async () => {assert.ok(allowed);},
        read: async () => ({phase: "active", acknowledged: ack, frame: f.input.rows[ack]}),
        acknowledge: async sequence => {
          assert.equal(sequence, ack + 1);
          if (sequence === f.input.rows.length) {
            if (mode === "lost-final-ack") throw Error("private lost acknowledgement");
            if (mode === "withdraw-current") current = false;
            if (mode === "withdraw-permission") allowed = false;
          }
          ack++; return true;
        }});
      receiver.start(); await until(() => receiver.inspectIoRetirement().drainFinished); receiver.abort();
      assert.equal(f.published, 4); assert.equal(receiver.isComplete(), false);
      assert.equal(receiver.inspectCompletedDelivery(), undefined); assert.throws(() => receiver.start());
    } finally {await f.close();}
  });
}

for (const mode of ["no-retirement", "failed-fence", "failed-inspection"] as const) {
  test(`completed delivery needs confirmed IO retirement: ${mode}`, async () => {
    const f = await fixture(false, mode !== "no-retirement"); let badInspection = false;
    try {
      if (mode !== "no-retirement") {
        const capture = f.storage.captureIoRetirement!;
        f.storage.captureIoRetirement = (input, context) => {
          const original = capture(input, context);
          return Object.freeze({fencePublication() {original.fencePublication(); if (mode === "failed-fence") throw Error("private fence detail");},
            inspect() {if (badInspection) throw Error("private inspection detail"); return original.inspect();}});
        };
      }
      const receiver = directReceiver(f);
      receiver.start(); await until(() => receiver.inspectIoRetirement().drainFinished);
      assert.equal(receiver.isComplete(), true); assert.equal(f.published, 4);
      receiver.abort(); if (mode === "failed-inspection") badInspection = true;
      assert.equal(receiver.inspectCompletedDelivery(), undefined);
      badInspection = false;
      assert.equal(receiver.inspectCompletedDelivery(), undefined, "unknown original inspection cannot later become proof");
    } finally {await f.close();}
  });
}

test("late original read after abort cannot manufacture completed delivery", async () => {
  const f = await fixture(false, true), read = deferred<unknown>(); let reads = 0, acks = 0;
  try {
    const receiver = directReceiver(f, {read: async () => {reads++; return read.promise;}, acknowledge: async () => {acks++; return true;}});
    receiver.start(); await until(() => reads === 1); receiver.abort();
    assert.equal(receiver.inspectCompletedDelivery(), undefined);
    assert.equal(receiver.inspectIoRetirement().pendingOperations, 1);
    read.resolve({phase: "active", acknowledged: 0, frame: f.input.rows[0]});
    await until(() => receiver.inspectIoRetirement().drainFinished);
    assert.equal(receiver.inspectCompletedDelivery(), undefined); assert.equal(acks, 0); assert.equal(f.published, 0);
  } finally {read.resolve(undefined); await f.close();}
});
