import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs, {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {mock, test} from "node:test";
import {createOrganizationId} from "../../../../../contracts/organization";
import type {OrganizationRequestContext} from "../../../../../contracts/organization";
import {createFilesystemTrainingResultFileByteStorageAdapter as create} from "../createFilesystemTrainingResultFileByteStorageAdapter";
import {encodeTrainingResultInventory as encodeInventory} from "../trainingResultInventory";
import {createNativeTrainingResultFileByteStorageAdapter as createNative} from "../createNativeTrainingResultFileByteStorageAdapter";

const publicationId = "a".repeat(32), context = {workspaceId: "workspace-a"};
const key = (index = 0) => `workspaces/workspace-a/artifacts/training-results/${publicationId}/${index}`;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const stream = async function* (bytes: Uint8Array) {yield bytes;};
const input = (fileIndex = 0, bytes = new Uint8Array([1, 2, 3])) => ({fileIndex,
  mediaType: "application/octet-stream" as const, expectedSizeBytes: bytes.length, expectedSha256: digest(bytes), content: stream(bytes)});
const configuration = (rootDirectory: string) => ({rootDirectory, publicationId, maximumFileBytes: 32, maximumTotalBytes: 64, maximumFiles: 4});
async function fixture(run: (root: string, storage: ReturnType<typeof create>) => Promise<void>) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(path.join(parent, "training-private-bytes-")));
  const original = await lstat(root, {bigint: true});
  try {await run(root, create(configuration(root)));}
  finally {
    const current = await lstat(root, {bigint: true});
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    assert.equal(await realpath(root), root); assert.equal(path.dirname(root), parent);
    await rm(root, {recursive: true});
  }
}
const safe = (result: unknown) => assert.doesNotMatch(JSON.stringify(result), /training-private-bytes|private-synthetic|RangeError|byteLength|[A-Z]:\\/);

const inventoryLimits = {maximumFiles: 256, maximumFileBytes: 64, maximumTotalBytes: 512};
const nativeInventory = () => ({publicationId, totalBytes: 5, files: [
  {fileIndex: 0, groupIndex: 0, name: "config.json", role: "checkpoint" as const, mediaType: "application/json" as const,
    expectedSizeBytes: 2, expectedSha256: "sha256:" + "a".repeat(64)},
  {fileIndex: 1, groupIndex: 1, name: "model.safetensors", role: "candidate" as const, mediaType: "application/octet-stream" as const,
    expectedSizeBytes: 3, expectedSha256: "sha256:" + "b".repeat(64)},
]});
const invalidInventory = (value: unknown, limits = inventoryLimits) => assert.throws(
  () => encodeInventory(value, limits), {message: "Private training result inventory is invalid."});

/** Inert ABI-shaped dependency. It performs no native or filesystem operation
 * and supplies no physical protection or qualification evidence. */
function nativeFixture() {
  const originalStore = Object.freeze({}), calls: {name: string; args: any[]}[] = [];
  const state = {pending: false, fenced: false, uncertain: false, prepared: false, closed: false, completedFiles: 0, readers: 0, stage: 0};
  const chunks = new Map<number, Buffer[]>(), readers = new Map<object, {index: number; offset: number}>();
  const implementations: Record<string, (...args: any[]) => any> = {
    createStore: () => originalStore,
    inspect: store => {assert.equal(store, originalStore); return Object.freeze({...state,
      diagnostics: Object.freeze({sealStep: 0, nativeStatus: 0, permissionBits: 0, permissionControl: 0, grantedAccess: 0})});},
    prepare: async (store, encoded) => {assert.equal(store, originalStore); assert.equal(encoded.toString("ascii", 0, 8), "ASBTRS02"); state.prepared = true; state.stage = 8; return true;},
    append: async (store, index, bytes) => {assert.equal(store, originalStore); assert.equal(index, state.completedFiles);
      assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8192);
      chunks.set(index, [...(chunks.get(index) ?? []), Buffer.from(bytes)]); return true;},
    finishFile: async (store, index) => {assert.equal(store, originalStore); assert.equal(index, state.completedFiles); state.completedFiles++; return true;},
    fence: store => {assert.equal(store, originalStore); state.fenced = true; return true;},
    openReader: (store, index) => {assert.equal(store, originalStore); const reader = Object.freeze({}); readers.set(reader, {index, offset: 0}); state.readers++; return reader;},
    read: async (reader, maximum) => {const current = readers.get(reader)!; assert.ok(current);
      const bytes = Buffer.concat(chunks.get(current.index) ?? []), result = Buffer.from(bytes.subarray(current.offset, current.offset + maximum)); current.offset += result.length; return result;},
    closeReader: reader => {assert.ok(readers.delete(reader)); state.readers--; return true;},
    discard: async store => {assert.equal(store, originalStore); state.closed = true; state.stage = 14; return true;},
  };
  const api = Object.freeze(Object.defineProperties({}, Object.fromEntries(Object.keys(implementations).map(name =>
    [name, {value: (...args: any[]) => {calls.push({name, args}); return implementations[name]!(...args);}}]))));
  const actor = {workspaceId: "workspace-a", organizationId: createOrganizationId("organization-a"), principalId: "actor-a", requestId: "native-test-request"};
  const options = {nativeApi: api, parentDirectory: "X:\\synthetic-result-parent", publicationId, scopeDigest: "d".repeat(64),
    maximumFiles: 4, maximumFileBytes: 20000, maximumTotalBytes: 40000, maximumMetadataBytes: 32768, maximumOperationMs: 10000, context: actor};
  const values = [Buffer.from("{}"), Buffer.from([1, 2, 3])];
  const inventory = () => ({...nativeInventory(), totalBytes: values.reduce((sum, value) => sum + value.length, 0),
    files: nativeInventory().files.map((row, index) => ({...row, expectedSizeBytes: values[index]!.length, expectedSha256: digest(values[index]!)}))});
  const packet = (index: number, content = stream(values[index]!)) => {
    const row = inventory().files[index]!;
    return {fileIndex: row.fileIndex, mediaType: row.mediaType, expectedSizeBytes: row.expectedSizeBytes, expectedSha256: row.expectedSha256, content};
  };
  const createAdapter = () => createNative(options);
  return {calls, state, chunks, api, options, actor, values, implementations, inventory, packet, createAdapter,
    count: (name: string) => calls.filter(call => call.name === name).length};
}
const gate = () => {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};
const tickNative = () => new Promise<void>(done => setImmediate(done));

test("native publication binds the original ABI, complete inventory, ordered bytes and original readers", async () => {
  const f = nativeFixture(), adapter = f.createAdapter();
  const retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  assert.throws(() => adapter.storage.captureIoRetirement!({publicationId}, f.actor));
  assert.throws(() => adapter.originalOwner.openReader(0, f.actor));
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  assert.equal((await adapter.storage.publishResultFile(f.packet(1), f.actor)).ok, false);
  assert.equal(f.count("append"), 0);
  for (const index of [0, 1]) {
    const result = await adapter.storage.publishResultFile(f.packet(index), f.actor); assert.equal(result.ok, true);
    assert.deepEqual(Buffer.concat(f.chunks.get(index)!), f.values[index]);
  }
  assert.equal(f.count("createStore"), 1); assert.equal(f.count("prepare"), 1); assert.equal(f.count("finishFile"), 2);
  assert.deepEqual(f.calls.find(call => call.name === "prepare")!.args[1], encodeInventory(f.inventory(),
    {maximumFiles: 4, maximumFileBytes: 20000, maximumTotalBytes: 40000}));
  retirement.fencePublication(); assert.equal(retirement.inspect().phase, "closed");
  const reader = adapter.originalOwner.openReader(0, {...f.actor, requestId: "new-read-request"});
  await assert.rejects(adapter.originalOwner.discard(f.actor));
  assert.deepEqual(await reader.read(), f.values[0]); assert.equal((await reader.read()).length, 0); reader.close();
  await adapter.originalOwner.discard(f.actor); assert.equal(f.state.closed, true);
  await assert.rejects(adapter.originalOwner.discard(f.actor)); assert.equal(f.count("discard"), 1);
  safe(adapter.storage.inspectPublication());
});

test("native publication captures actor/configuration and denies foreign or duplicate calls before consuming content", async () => {
  const f = nativeFixture(), actor = {...f.actor}, adapter = f.createAdapter(); let consumed = 0;
  const body = async function* () {consumed++; yield f.values[0]!;};
  f.options.context.workspaceId = "other-workspace"; f.options.publicationId = "b".repeat(32); f.options.nativeApi = Object.freeze({});
  await assert.rejects(adapter.storage.preparePublication!(f.inventory(), {...actor, principalId: "other-actor"}));
  assert.equal(f.count("prepare"), 0);
  await adapter.storage.preparePublication!(f.inventory(), actor);
  assert.equal((await adapter.storage.publishResultFile(f.packet(0, body()), {...actor, workspaceId: "other-workspace"})).ok, false);
  assert.equal(consumed, 0); assert.equal(f.count("append"), 0);
  assert.equal((await adapter.storage.publishResultFile(f.packet(0), actor)).ok, true);
  assert.equal((await adapter.storage.publishResultFile(f.packet(0, body()), actor)).ok, false);
  assert.equal(consumed, 0); assert.equal(f.count("finishFile"), 1);
  assert.equal(adapter.storage.inspectPublication().declaredPayloadBytes, 2);
});

test("native publication keeps a pending producer flight after fencing and refuses its late bytes", {timeout: 2000}, async () => {
  const f = nativeFixture(), adapter = f.createAdapter(), wait = gate(), entered = gate();
  const retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  const body = async function* () {entered.resolve(); await wait.promise; yield f.values[0]!;};
  const pending = adapter.storage.publishResultFile(f.packet(0, body()), f.actor); await entered.promise;
  retirement.fencePublication(); assert.equal(retirement.inspect().phase, "pending");
  await assert.rejects(adapter.originalOwner.discard(f.actor)); wait.resolve();
  assert.equal((await pending).ok, false); assert.equal(f.count("append"), 0); assert.equal(f.count("finishFile"), 0);
  assert.equal(retirement.inspect().phase, "closed"); assert.equal(retirement.inspect().publicationUnconfirmed, true);
  assert.equal(retirement.inspect().declaredPayloadBytes, 2);
});

test("native publication observes the actual pending append and keeps declarations after a late acknowledgement", {timeout: 2000}, async () => {
  const f = nativeFixture(), adapter = f.createAdapter(), wait = gate(), entered = gate();
  const retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  const append = f.implementations.append!;
  f.implementations.append = (...args) => {f.state.pending = true; entered.resolve(); return (async () => {await wait.promise; f.state.pending = false; return append(...args);})();};
  const pending = adapter.storage.publishResultFile(f.packet(0), f.actor); await entered.promise;
  retirement.fencePublication(); assert.equal(retirement.inspect().phase, "pending");
  assert.ok(retirement.inspect().pendingOperations > 0); await assert.rejects(adapter.originalOwner.discard(f.actor));
  wait.resolve(); assert.equal((await pending).ok, false); assert.equal(f.count("append"), 1); assert.equal(f.count("finishFile"), 0);
  assert.equal(retirement.inspect().phase, "closed"); assert.equal(retirement.inspect().publicationUnconfirmed, true);
});

for (const mode of ["false", "thenable", "native-error"] as const) {
  test(`native publication retains ${mode} without retry, cleanup credit or private errors`, async () => {
    const f = nativeFixture(), adapter = f.createAdapter(); let thenCalls = 0;
    const retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
    await adapter.storage.preparePublication!(f.inventory(), f.actor);
    f.implementations.append = mode === "thenable" ? (() => ({then() {thenCalls++;}})) : mode === "false" ? (async () => false) :
      (async () => {f.state.uncertain = true; throw Error("private-synthetic failed at X:\\private");});
    const result = await adapter.storage.publishResultFile(f.packet(0), f.actor);
    assert.equal(result.ok, false); safe(result); assert.equal(retirement.inspect().phase, "unconfirmed");
    assert.equal(retirement.inspect().declaredPayloadBytes, 2); assert.equal(thenCalls, 0);
    assert.equal((await adapter.storage.publishResultFile(f.packet(0), f.actor)).ok, false);
    await assert.rejects(adapter.originalOwner.discard(f.actor)); assert.equal(f.count("append"), 1); assert.equal(f.count("discard"), 0);
  });
}

test("native publication enforces8KiB intrinsic chunks and preserves source-independent bytes", async () => {
  const f = nativeFixture(); f.values[1] = Buffer.alloc(8300, 90); const adapter = f.createAdapter();
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  assert.equal((await adapter.storage.publishResultFile(f.packet(0), f.actor)).ok, true);
  const source = async function* () {yield f.values[1]!.subarray(0, 8192); yield f.values[1]!.subarray(8192);};
  assert.equal((await adapter.storage.publishResultFile(f.packet(1, source()), f.actor)).ok, true);
  assert.deepEqual(f.calls.filter(call => call.name === "append").map(call => call.args[2].length), [2, 8192, 108]);
  const tooLarge = nativeFixture(); tooLarge.values[0] = Buffer.alloc(8193); const rejected = tooLarge.createAdapter();
  const retirement = rejected.storage.captureIoRetirement!({publicationId}, tooLarge.actor);
  await rejected.storage.preparePublication!(tooLarge.inventory(), tooLarge.actor);
  const oversized = tooLarge.packet(0);
  Object.defineProperty(tooLarge.values[0], "byteLength", {get() {throw Error("must not read instance length");}});
  assert.equal((await rejected.storage.publishResultFile(oversized, tooLarge.actor)).ok, false);
  assert.equal(tooLarge.count("append"), 0); assert.equal(retirement.inspect().publicationUnconfirmed, true);
});

test("native adapter rejects API/configuration accessors and proxies before original store creation", () => {
  const f = nativeFixture(); let calls = 0;
  const options: any = {...f.options}; Object.defineProperty(options, "nativeApi", {enumerable: true, get() {calls++; throw Error("private-synthetic");}});
  assert.throws(() => createNative(options), {message: "Private training publication is unavailable."});
  const proxy = new Proxy(f.options, {getPrototypeOf() {calls++; throw Error("private-synthetic");}});
  assert.throws(() => createNative(proxy));
  const descriptors = Object.getOwnPropertyDescriptors(f.api); descriptors.append = {enumerable: false, get() {calls++; throw Error("private-synthetic");}};
  assert.throws(() => createNative({...f.options, nativeApi: Object.freeze(Object.defineProperties({}, descriptors))}));
  assert.throws(() => createNative({...f.options, context: {workspaceId: "workspace-a"}}));
  assert.equal(f.count("createStore"), 0); assert.equal(calls, 0);
});

test("native adapter rejects noncanonical workspace context before native store creation", () => {
  const f = nativeFixture();
  for (const workspaceId of [" workspace-a ", "\tworkspace-a", "workspace-a\n", "", "../workspace-a", "workspace/a",
    "https://workspace.invalid", "workspace..a", "a".repeat(97), undefined]) {
    assert.throws(() => createNative({...f.options, context: {...f.actor, workspaceId}}),
      {message: "Private training publication is unavailable."});
  }
  assert.equal(f.count("createStore"), 0); assert.equal(f.count("inspect"), 0);
  f.createAdapter(); assert.equal(f.count("createStore"), 1);
});

test("native readers reject concurrent reads without erasing the original reader lifetime", {timeout: 2000}, async () => {
  const f = nativeFixture(), adapter = f.createAdapter(); await adapter.storage.preparePublication!(f.inventory(), f.actor);
  for (const index of [0, 1]) assert.equal((await adapter.storage.publishResultFile(f.packet(index), f.actor)).ok, true);
  adapter.originalOwner.fencePublication(); const reader = adapter.originalOwner.openReader(0, f.actor);
  const wait = gate(), entered = gate(), read = f.implementations.read!;
  f.implementations.read = (...args) => {entered.resolve(); return (async () => {await wait.promise; return read(...args);})();};
  const pending = reader.read(); await entered.promise;
  await assert.rejects(reader.read()); assert.throws(() => reader.close()); await assert.rejects(adapter.originalOwner.discard(f.actor));
  wait.resolve(); assert.deepEqual(await pending, f.values[0]); reader.close();
  await adapter.originalOwner.discard(f.actor); assert.equal(f.count("discard"), 1);
});

test("native publication verifies complete bytes before finishing a file and retains a failed copy", async () => {
  const f = nativeFixture(), adapter = f.createAdapter(), retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  const result = await adapter.storage.publishResultFile(f.packet(0, stream(Buffer.from("xx"))), f.actor);
  assert.equal(result.ok, false); safe(result); assert.equal(f.count("append"), 1); assert.equal(f.count("finishFile"), 0);
  assert.equal(f.count("discard"), 0); assert.equal(retirement.inspect().declaredPayloadBytes, 2);
  assert.equal(retirement.inspect().publicationUnconfirmed, true);
});

test("native publication rejects stream accessors and proxies without consuming a file index", async () => {
  const f = nativeFixture(), adapter = f.createAdapter(); let invoked = 0;
  await adapter.storage.preparePublication!(f.inventory(), f.actor);
  const accessor = Object.defineProperty({}, Symbol.asyncIterator, {get() {invoked++; throw Error("private-synthetic");}});
  const proxy = new Proxy({}, {getPrototypeOf() {invoked++; throw Error("private-synthetic");}});
  for (const content of [accessor, proxy]) {
    const result = await adapter.storage.publishResultFile({...f.packet(0), content: content as AsyncIterable<Uint8Array>}, f.actor);
    assert.equal(result.ok, false); safe(result);
  }
  assert.equal(invoked, 0); assert.equal(adapter.storage.inspectPublication().attemptedFileCount, 0); assert.equal(f.count("append"), 0);
  assert.equal((await adapter.storage.publishResultFile(f.packet(0), f.actor)).ok, true);
});

test("native publication never reads an own promise then and retains its unknown acknowledgement", async () => {
  const f = nativeFixture(), adapter = f.createAdapter(), retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  await adapter.storage.preparePublication!(f.inventory(), f.actor); let reads = 0;
  const original = Promise.resolve(true);
  Object.defineProperty(original, "then", {get() {reads++; throw Error("private-synthetic");}});
  f.implementations.append = () => original;
  assert.equal((await adapter.storage.publishResultFile(f.packet(0), f.actor)).ok, false); await tickNative();
  assert.equal(reads, 0); assert.equal(retirement.inspect().phase, "unconfirmed");
  assert.ok(retirement.inspect().pendingOperations > 0); await assert.rejects(adapter.originalOwner.discard(f.actor));
});

for (const mode of ["fence", "inspect"] as const) {
  test(`an asynchronous native ${mode} cannot establish synchronous closure or leak a rejection`, async () => {
    const f = nativeFixture(), adapter = f.createAdapter(), retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
    f.implementations[mode] = async () => {throw Error("private-synthetic");};
    if (mode === "fence") assert.throws(() => retirement.fencePublication(), {message: "Private training publication is unavailable."});
    assert.equal(retirement.inspect().phase, "unconfirmed"); await tickNative();
    await assert.rejects(adapter.originalOwner.discard(f.actor)); assert.equal(f.count("discard"), 0);
  });
}

test("native reader overrun stays retained and cannot close or discard its original owner", async () => {
  const f = nativeFixture(), adapter = f.createAdapter(); await adapter.storage.preparePublication!(f.inventory(), f.actor);
  for (const index of [0, 1]) assert.equal((await adapter.storage.publishResultFile(f.packet(index), f.actor)).ok, true);
  adapter.originalOwner.fencePublication(); const reader = adapter.originalOwner.openReader(0, f.actor);
  f.implementations.read = async () => Buffer.alloc(8193);
  await assert.rejects(reader.read()); assert.throws(() => reader.close()); await assert.rejects(adapter.originalOwner.discard(f.actor));
  assert.equal(f.count("closeReader"), 0); assert.equal(f.count("discard"), 0); assert.equal(f.state.readers, 1);
});

test("lost original native discard acknowledgement never authorizes another effect or capacity credit", async () => {
  const f = nativeFixture(), adapter = f.createAdapter(), retirement = adapter.storage.captureIoRetirement!({publicationId}, f.actor);
  retirement.fencePublication(); f.implementations.discard = async () => {f.state.closed = true; throw Error("private-synthetic");};
  await assert.rejects(adapter.originalOwner.discard(f.actor), {message: "Private training publication is unavailable."});
  await assert.rejects(adapter.originalOwner.discard(f.actor)); assert.equal(f.count("discard"), 1);
  assert.equal(retirement.inspect().phase, "unconfirmed"); assert.equal(retirement.inspect().publicationUnconfirmed, true);
});

test("private native inventory matches the fixed independent ASBTRS02 golden vector", () => {
  const expected = Buffer.from("415342545253303202000000" +
    "00000000000001010200000000000000" + "a".repeat(64) +
    "01000000010002090300000000000000" + "b".repeat(64), "hex");
  assert.equal(expected.length, 108);
  const original = nativeInventory(), encoded = encodeInventory(original, inventoryLimits);
  assert.deepEqual(encoded, expected);
  const independent = encodeInventory(original, inventoryLimits);
  original.files[0]!.name = "changed.json"; original.files[0]!.expectedSha256 = "sha256:" + "c".repeat(64);
  assert.deepEqual(encoded, expected); encoded[0] = 0;
  assert.deepEqual(independent, expected);
});

test("native inventory preserves all thirteen fixed name ordinals without using paths", () => {
  const labels = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
    "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors",
    "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"];
  const files = labels.map((name, index) => ({...nativeInventory().files[1]!, fileIndex: index, groupIndex: 0,
    name, mediaType: name.endsWith(".json") ? "application/json" : "application/octet-stream", expectedSizeBytes: 1}));
  const encoded = encodeInventory({publicationId, files, totalBytes: 13}, inventoryLimits);
  files.forEach((_, index) => assert.equal(encoded[12 + index * 48 + 7], index + 1));
});

test("native inventory bounds rows and preserves exact large integer sizes without allocating payload", () => {
  const files = Array.from({length: 256}, (_, index) => ({...nativeInventory().files[0]!, fileIndex: index,
    groupIndex: index, role: index === 255 ? "candidate" : "checkpoint", expectedSizeBytes: 1}));
  const encoded = encodeInventory({publicationId, files, totalBytes: 256}, inventoryLimits);
  assert.equal(encoded.length, 12300); assert.equal(encoded.readUInt32LE(8), 256);
  assert.equal(encoded.readUInt16LE(12 + 255 * 48 + 4), 255);
  invalidInventory({publicationId, files: [...files, {...files[255], fileIndex: 256}], totalBytes: 257});
  const size = 2 ** 32 + 17, row = {...nativeInventory().files[1]!, fileIndex: 0, groupIndex: 0, expectedSizeBytes: size};
  const large = encodeInventory({publicationId, files: [row], totalBytes: size},
    {maximumFiles: 1, maximumFileBytes: size, maximumTotalBytes: size});
  assert.equal(large.length, 60); assert.equal(large.readBigUInt64LE(20), BigInt(size));
  const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
  invalidInventory({publicationId, files: nativeInventory().files.map(file => ({...file, expectedSizeBytes: half})),
    totalBytes: Number.MAX_SAFE_INTEGER}, {maximumFiles: 2, maximumFileBytes: half, maximumTotalBytes: Number.MAX_SAFE_INTEGER});
});

for (const mode of ["publication", "total", "empty", "sparse", "extra-array", "array-prototype", "index", "group-start",
  "group-gap", "role", "no-candidate", "mixed-role", "duplicate", "traversal", "unknown-name", "media", "zero", "over-file", "unsafe-size", "hash", "extra-row", "symbol-row"]) {
  test(`native inventory denies ${mode} before producing bytes`, () => {
    const value: any = nativeInventory();
    if (mode === "publication") value.publicationId = "../private-synthetic";
    if (mode === "total") value.totalBytes++;
    if (mode === "empty") value.files = [];
    if (mode === "sparse") delete value.files[0];
    if (mode === "extra-array") value.files.extra = true;
    if (mode === "array-prototype") Object.setPrototypeOf(value.files, Object.create(Array.prototype));
    if (mode === "index") value.files[1].fileIndex = 0;
    if (mode === "group-start") value.files[0].groupIndex = 1;
    if (mode === "group-gap") value.files[1].groupIndex = 2;
    if (mode === "role") value.files[1].role = "executable";
    if (mode === "no-candidate") value.files[1].role = "checkpoint";
    if (mode === "mixed-role") value.files[0].role = "candidate";
    if (mode === "duplicate") {value.files[0].role = "candidate"; value.files[1].groupIndex = 0; value.files[1].name = "config.json"; value.files[1].mediaType = "application/json";}
    if (mode === "traversal") value.files[0].name = "../private-synthetic";
    if (mode === "unknown-name") value.files[0].name = "unlisted.bin";
    if (mode === "media") value.files[0].mediaType = "application/octet-stream";
    if (mode === "zero") value.files[0].expectedSizeBytes = 0;
    if (mode === "over-file") value.files[0].expectedSizeBytes = 65;
    if (mode === "unsafe-size") value.files[0].expectedSizeBytes = Number.MAX_SAFE_INTEGER + 1;
    if (mode === "hash") value.files[0].expectedSha256 = "sha256:" + "A".repeat(64);
    if (mode === "extra-row") value.files[0].private = "private-synthetic";
    if (mode === "symbol-row") value.files[0][Symbol("private")] = true;
    invalidInventory(value);
  });
}

test("native inventory refuses proxies and accessors without invoking supplied code", () => {
  let calls = 0;
  const trap = () => {calls++; throw Error("private-synthetic must not run");};
  const proxy = <T extends object>(value: T): T => new Proxy(value, {get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap});
  invalidInventory(proxy(nativeInventory())); invalidInventory(nativeInventory(), proxy(inventoryLimits));
  for (const target of ["files-proxy", "row-proxy", "files-getter", "row-getter", "entry-getter", "limits-getter"]) {
    const value: any = nativeInventory(), limits = {...inventoryLimits};
    if (target === "files-proxy") value.files = proxy(value.files);
    if (target === "row-proxy") value.files[0] = proxy(value.files[0]);
    if (target === "files-getter") Object.defineProperty(value, "files", {enumerable: true, get: trap});
    if (target === "row-getter") Object.defineProperty(value.files[0], "name", {enumerable: true, get: trap});
    if (target === "entry-getter") Object.defineProperty(value.files, "0", {enumerable: true, get: trap});
    if (target === "limits-getter") Object.defineProperty(limits, "maximumFileBytes", {enumerable: true, get: trap});
    invalidInventory(value, limits);
  }
  for (const limits of [{...inventoryLimits, maximumFiles: 257}, {...inventoryLimits, maximumFileBytes: 513},
    {...inventoryLimits, maximumTotalBytes: Infinity}, {...inventoryLimits, maximumFiles: true},
    {...inventoryLimits, unknown: true}]) invalidInventory(nativeInventory(), limits as typeof inventoryLimits);
  assert.equal(calls, 0);
});

test("optional actual writer retirement is captured once and fences only the same private publication", async () => fixture(async root => {
  const storage = create({...configuration(root), trackIoRetirement: true});
  assert.equal(typeof storage.captureIoRetirement, "function");
  assert.throws(() => storage.captureIoRetirement!({publicationId: "b".repeat(32)}, context));
  const retirement = storage.captureIoRetirement!({publicationId}, context);
  assert.throws(() => storage.captureIoRetirement!({publicationId}, context));
  assert.equal(retirement.inspect().phase, "open");
  assert.equal((await storage.publishResultFile(input(), context)).ok, true);
  retirement.fencePublication();
  const observed = retirement.inspect(); assert.equal(observed.phase, "closed"); assert.equal(observed.fileCount, 1);
  assert.equal(observed.pendingOperations, 0); assert.equal(observed.publicationUnconfirmed, false); assert.equal(observed.declaredPayloadBytes, 3);
  assert.equal((await storage.publishResultFile(input(1), context)).ok, false);
  assert.deepEqual(retirement.inspect(), observed); safe(observed);
}));
test("pending real private publication remains pending after permanent publication fencing", async () => fixture(async root => {
  const storage = create({...configuration(root), trackIoRetirement: true}), retirement = storage.captureIoRetirement!({publicationId}, context);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {entered = resolve;});
  const content = async function* () {entered(); await gate; yield new Uint8Array([1, 2, 3]);};
  const pending = storage.publishResultFile({...input(), content: content()}, context);
  try {await started; retirement.fencePublication(); assert.equal(retirement.inspect().phase, "pending");
    assert.equal((await storage.publishResultFile(input(1), context)).ok, false); release();
    assert.equal((await pending).ok, true); assert.equal(retirement.inspect().phase, "closed");
  } finally {release(); await pending;}
}));
test("known failed-file IO closure does not clear uncertain publication or its byte charge", async () => fixture(async root => {
  const storage = create({...configuration(root), trackIoRetirement: true}), retirement = storage.captureIoRetirement!({publicationId}, context);
  const request = {...input(), expectedSha256: "sha256:" + "0".repeat(64)};
  const result = await storage.publishResultFile(request, context); assert.equal(result.ok, false);
  retirement.fencePublication();
  const observed = retirement.inspect(); assert.equal(observed.phase, "closed"); assert.equal(observed.publicationUnconfirmed, true);
  assert.equal(observed.declaredPayloadBytes, 3); assert.equal(storage.inspectPublication().phase, "unconfirmed");
  assert.equal((await storage.publishResultFile(input(), context)).ok, false); assert.deepEqual(retirement.inspect(), observed); safe(observed);
}));
test("captured retirement scope is immutable and rejects getters or a later different actor", async () => fixture(async root => {
  const storage = create({...configuration(root), trackIoRetirement: true}); let getters = 0;
  assert.throws(() => storage.captureIoRetirement!({publicationId}, {get workspaceId() {getters++; return "workspace-a";}}));
  assert.equal(getters, 0);
  const originalContext = {...context, principalId: "original-actor"}, retirement = storage.captureIoRetirement!({publicationId}, originalContext);
  originalContext.principalId = "changed-actor";
  assert.equal((await storage.publishResultFile(input(), originalContext)).ok, false);
  assert.equal((await storage.publishResultFile(input(), {...context, principalId: "original-actor"})).ok, true);
  retirement.fencePublication(); assert.equal(retirement.inspect().phase, "closed");
}));
test("retirement cannot be retroactively captured after an accepted write", async () => fixture(async root => {
  const storage = create({...configuration(root), trackIoRetirement: true});
  assert.equal((await storage.publishResultFile(input(), context)).ok, true);
  assert.throws(() => storage.captureIoRetirement!({publicationId}, context));
}));

test("training publication writes several exact private files without catalog or model registration", async () => fixture(async (root, storage) => {
  for (const [fileIndex, mediaType, bytes] of [[0, "application/json", new TextEncoder().encode('{"synthetic":true}')],
    [1, "application/octet-stream", new Uint8Array([4, 5, 6])]] as const) {
    const request = {...input(fileIndex, bytes), mediaType};
    const result = await storage.publishResultFile(request, context);
    assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.value,
      {key: key(fileIndex), mediaType, sizeBytes: bytes.length, checksum: {algorithm: "sha256", value: request.expectedSha256.slice(7)}});
    assert.deepEqual(new Uint8Array(await readFile(path.join(root, key(fileIndex)))), bytes);
  }
  assert.deepEqual(await readdir(root), ["workspaces"]);
  assert.deepEqual(storage.inspectPublication(), {phase: "open", attemptedFileCount: 2, acknowledgedFileCount: 2, declaredPayloadBytes: 21});
  assert.deepEqual(Object.keys(storage).sort(), ["inspectPublication", "publishResultFile"]);
}));

test("training publication requires explicit finite configuration before any IO", async () => fixture(async (root) => {
  for (const patch of [{publicationId: "../escape"}, {publicationId: "A".repeat(32)}, {maximumFileBytes: 0},
    {maximumTotalBytes: 0}, {maximumTotalBytes: 1}, {maximumFiles: 0}, {maximumFiles: 257},
    {maximumFileBytes: Infinity}, {maximumTotalBytes: Number.MAX_SAFE_INTEGER + 1}, {maximumFiles: 1.5}])
    assert.throws(() => create({...configuration(root), ...patch}));
  assert.deepEqual(await readdir(root), []);
}));

test("malformed file metadata and stream descriptors have no effects or consumed indices", async () => fixture(async (root, storage) => {
  for (const patch of [{fileIndex: -1}, {fileIndex: 4}, {fileIndex: 0.5}, {expectedSizeBytes: 0}, {expectedSizeBytes: 33},
    {expectedSizeBytes: NaN}, {expectedSha256: "invalid"}, {expectedSha256: `sha256:${"B".repeat(64)}`},
    {mediaType: "text/plain"}, {mediaType: "application/json;private=true"}, {content: undefined}, {content: null},
    {content: {}}, {unknown: "private-synthetic"}]) {
    let reads = 0;
    const request = {...input(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})(), ...patch};
    const result = await storage.publishResultFile(request as ReturnType<typeof input>, context);
    assert.equal(result.ok, false); assert.equal(reads, 0); safe(result);
  }
  let getters = 0;
  const request = input(); Object.defineProperty(request, "expectedSizeBytes", {enumerable: true, get() {getters++; return 3;}});
  assert.equal((await storage.publishResultFile(request, context)).ok, false);
  const badStream = Object.defineProperty({}, Symbol.asyncIterator, {get() {getters++; return () => stream(new Uint8Array([1]));}});
  assert.equal((await storage.publishResultFile({...input(), content: badStream as AsyncIterable<Uint8Array>}, context)).ok, false);
  const proxy = new Proxy(input(), {getPrototypeOf() {getters++; return Object.prototype;}});
  assert.equal((await storage.publishResultFile(proxy, context)).ok, false);
  assert.equal(getters, 0); assert.deepEqual(await readdir(root), []);
  assert.deepEqual(storage.inspectPublication(), {phase: "open", attemptedFileCount: 0, acknowledgedFileCount: 0, declaredPayloadBytes: 0});
  assert.equal((await storage.publishResultFile(input(), context)).ok, true);
}));

test("finite cumulative declarations and indices refuse before consuming a source", async () => fixture(async (root) => {
  const storage = create({...configuration(root), maximumFileBytes: 4, maximumTotalBytes: 6, maximumFiles: 2});
  assert.equal((await storage.publishResultFile(input(0, new Uint8Array(4)), context)).ok, true);
  let reads = 0;
  const source = (async function* () {reads++; yield new Uint8Array(4);})();
  assert.equal((await storage.publishResultFile({...input(1, new Uint8Array(4)), content: source}, context)).ok, false);
  assert.equal((await storage.publishResultFile({...input(2), content: source}, context)).ok, false);
  assert.equal((await storage.publishResultFile({...input(0), content: source}, context)).ok, false);
  assert.equal(reads, 0); assert.equal(storage.inspectPublication().declaredPayloadBytes, 4);
  assert.equal((await storage.publishResultFile(input(1, new Uint8Array(2)), context)).ok, true);
  assert.equal(storage.inspectPublication().declaredPayloadBytes, 6);
}));

test("foreign or missing caller scope cannot bind, consume or redirect a publication", async () => fixture(async (root, storage) => {
  let reads = 0; const content = (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})();
  assert.equal((await storage.publishResultFile({...input(), content}, {})).ok, false);
  assert.equal(reads, 0); assert.deepEqual(await readdir(root), []);
  assert.equal((await storage.publishResultFile(input(), context)).ok, true);
  for (const foreign of [{workspaceId: "workspace-b"}, {...context, organizationId: createOrganizationId("foreign")}])
    assert.equal((await storage.publishResultFile({...input(1), content}, foreign)).ok, false);
  assert.equal(reads, 0);
  assert.equal((await storage.publishResultFile(input(1), context)).ok, true);
}));

test("organization caller and provider facts and request scalars are captured before waits", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a"), observed = {organizationId, principalId: "principal-a"};
  const provider = {getCurrentOrganizationContext: () => observed};
  const options = {...configuration(root), organizationContextProvider: provider};
  const storage = create(options), supplied = {...context, organizationId}, request = input();
  request.content = (async function* () {
    observed.organizationId = createOrganizationId("organization-b"); supplied.workspaceId = "workspace-b";
    supplied.organizationId = createOrganizationId("organization-c"); request.fileIndex = 3; request.expectedSizeBytes = 30;
    options.publicationId = "b".repeat(32); options.rootDirectory = "private-synthetic-never-used";
    yield new Uint8Array([1, 2, 3]);
  })();
  assert.equal((await storage.publishResultFile(request, supplied)).ok, true);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, "organizations", organizationId, key()))), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await readdir(path.join(root, "organizations")), [organizationId]);
}));

test("missing or wrong organization denies before reading bytes or writing a target", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a");
  for (const actual of [undefined, {organizationId, principalId: "principal-a"}]) {
    const storage = create({...configuration(root), organizationContextProvider: {getCurrentOrganizationContext: () => actual}});
    let reads = 0;
    for (const supplied of [context, {...context, organizationId: createOrganizationId("organization-b")}]) {
      const result = await storage.publishResultFile({...input(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()}, supplied);
      assert.equal(result.ok, false); safe(result);
    }
    assert.equal(reads, 0); assert.deepEqual(await readdir(root), []);
  }
}));

test("a configured provider cannot publish under an absent or malformed organization identity", async () => fixture(async (root) => {
  for (const organizationId of [undefined, null, "", " organization-a ", "../escape", "token_private"]) {
    const record = {organizationId, principalId: "principal-a"} as unknown as OrganizationRequestContext;
    const storage = create({...configuration(root), organizationContextProvider: {getCurrentOrganizationContext: () => record}});
    let reads = 0;
    const supplied = {...context, ...(organizationId === undefined ? {} : {organizationId})} as Parameters<typeof storage.publishResultFile>[1];
    const result = await storage.publishResultFile({...input(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()}, supplied);
    assert.equal(result.ok, false); assert.equal(reads, 0); safe(result);
    assert.equal(storage.inspectPublication().attemptedFileCount, 0);
    assert.deepEqual(await readdir(root), []);
  }
}));

test("a changing provider organization accessor is refused before getter execution or namespace selection", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a"); let getters = 0, reads = 0;
  const record = {principalId: "principal-a"};
  Object.defineProperty(record, "organizationId", {enumerable: true, get() {
    getters++; return getters === 1 ? organizationId : createOrganizationId("organization-b");
  }});
  const storage = create({...configuration(root), organizationContextProvider: {getCurrentOrganizationContext: () => record as OrganizationRequestContext}});
  const result = await storage.publishResultFile({...input(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()}, {...context, organizationId});
  assert.equal(result.ok, false); assert.equal(getters, 0); assert.equal(reads, 0); safe(result);
  assert.deepEqual(await readdir(root), []);
}));

test("provider identity must be original data without principal getters or proxy traps", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a"); let getters = 0, reads = 0;
  const withGetter = {organizationId};
  Object.defineProperty(withGetter, "principalId", {get() {getters++; return "principal-a";}});
  const proxy = new Proxy({organizationId, principalId: "principal-a"}, {
    getOwnPropertyDescriptor() {getters++; throw new Error("private-synthetic-proxy");},
  });
  for (const value of [{organizationId}, {organizationId, principalId: null}, {organizationId, principalId: ""}, withGetter, proxy]) {
    const storage = create({...configuration(root), organizationContextProvider: {getCurrentOrganizationContext: () => value as OrganizationRequestContext}});
    const result = await storage.publishResultFile({...input(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()}, {...context, organizationId});
    assert.equal(result.ok, false); safe(result); assert.equal(storage.inspectPublication().attemptedFileCount, 0);
  }
  assert.equal(getters, 0); assert.equal(reads, 0); assert.deepEqual(await readdir(root), []);
}));

for (const failure of ["digest", "short", "long", "late-extra", "producer-error", "non-bytes"] as const) {
  test(`an accepted ${failure} failure fences all further copies without a retry or metadata`, async () => fixture(async (root, storage) => {
    const request = input();
    if (failure === "digest") request.expectedSha256 = `sha256:${"b".repeat(64)}`;
    if (failure === "short") request.content = stream(new Uint8Array([1]));
    if (failure === "long") request.content = stream(new Uint8Array([1, 2, 3, 4]));
    if (failure === "late-extra") request.content = (async function* () {yield new Uint8Array([1, 2, 3]); yield new Uint8Array([4]);})();
    if (failure === "producer-error") request.content = (async function* () {yield new Uint8Array([1]); throw new Error("private-synthetic");})();
    if (failure === "non-bytes") request.content = (async function* () {yield "private-synthetic" as unknown as Uint8Array;})();
    const result = await storage.publishResultFile(request, context); assert.equal(result.ok, false); safe(result);
    const status = storage.inspectPublication();
    assert.deepEqual(status, {phase: "unconfirmed", attemptedFileCount: 1, acknowledgedFileCount: 0, declaredPayloadBytes: 3});
    let reads = 0; const retry = (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})();
    assert.equal((await storage.publishResultFile({...input(), content: retry}, context)).ok, false);
    assert.equal((await storage.publishResultFile({...input(1), content: retry}, context)).ok, false);
    assert.equal(reads, 0); assert.deepEqual(storage.inspectPublication(), status);
    await assert.rejects(readFile(path.join(root, key())), {code: "ENOENT"});
  }));
}

test("a conflicting final target is preserved and never adopted or retried", async () => fixture(async (root, storage) => {
  await mkdir(path.dirname(path.join(root, key())), {recursive: true});
  await writeFile(path.join(root, key()), "foreign-sentinel");
  assert.equal((await storage.publishResultFile(input(), context)).ok, false);
  assert.equal(await readFile(path.join(root, key()), "utf8"), "foreign-sentinel");
  assert.equal(storage.inspectPublication().phase, "unconfirmed");
  let reads = 0;
  assert.equal((await storage.publishResultFile({...input(), content: (async function* () {reads++; yield new Uint8Array([1]);})()}, context)).ok, false);
  assert.equal(reads, 0);
}));

test("concurrent and source-reentrant calls do not reset or replace the original live copy", async () => fixture(async (root, storage) => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const request = input();
  request.content = (async function* () {
    enter(); await gate;
    assert.equal((await storage.publishResultFile(input(2), context)).ok, false);
    yield new Uint8Array([1, 2, 3]);
  })();
  const running = storage.publishResultFile(request, context); await entered;
  let otherReads = 0;
  try {
    assert.equal(storage.inspectPublication().phase, "writing");
    assert.equal((await storage.publishResultFile({...input(1), content: (async function* () {otherReads++; yield new Uint8Array([1]);})()}, context)).ok, false);
  } finally {release();}
  assert.equal((await running).ok, true); assert.equal(otherReads, 0);
  assert.equal((await storage.publishResultFile(input(1), context)).ok, true);
  assert.equal(storage.inspectPublication().acknowledgedFileCount, 2);
}));

test("provider reentry cannot take the checking slot or consume another stream", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a"), supplied = {...context, organizationId};
  let storage!: ReturnType<typeof create>, nested: Promise<unknown> | undefined, reads = 0;
  storage = create({...configuration(root), organizationContextProvider: {getCurrentOrganizationContext() {
    nested = storage.publishResultFile({...input(1), content: (async function* () {reads++; yield new Uint8Array([1]);})()}, supplied);
    return {organizationId, principalId: "principal-a"};
  }}});
  assert.equal((await storage.publishResultFile(input(), supplied)).ok, true);
  assert.equal((await nested as {ok: boolean}).ok, false); assert.equal(reads, 0);
  assert.equal(storage.inspectPublication().acknowledgedFileCount, 1);
}));

test("intrinsic chunk admission copies original bytes and ignores false instance lengths", async () => fixture(async (root, storage) => {
  const bytes = new Uint8Array([7, 8, 9]), request = input(0, bytes); let getters = 0;
  Object.defineProperty(bytes, "byteLength", {get() {getters++; return 0;}});
  request.content = (async function* () {yield bytes; bytes.fill(0);})();
  assert.equal((await storage.publishResultFile(request, context)).ok, true);
  assert.equal(getters, 0); assert.deepEqual(new Uint8Array(await readFile(path.join(root, key()))), new Uint8Array([7, 8, 9]));
}));

test("a real final link followed by a lost acknowledgement retains bytes and fences the publication", async () => fixture(async (root, storage) => {
  const original = fs.link; let calls = 0;
  const patched = mock.method(fs, "link", async (...args: Parameters<typeof fs.link>) => {
    calls++; await original(...args); throw new Error("private-synthetic-lost-link-ack");
  });
  syncBuiltinESMExports();
  try {
    const result = await storage.publishResultFile(input(), context); assert.equal(result.ok, false); safe(result);
    assert.equal(calls, 1);
  } finally {patched.mock.restore(); syncBuiltinESMExports();}
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, key()))), new Uint8Array([1, 2, 3]));
  assert.equal(storage.inspectPublication().phase, "unconfirmed");
  assert.equal((await storage.publishResultFile(input(), context)).ok, false);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, key()))), new Uint8Array([1, 2, 3]));
}));
