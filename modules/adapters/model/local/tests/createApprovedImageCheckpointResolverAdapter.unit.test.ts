import assert from "node:assert/strict";
import test, {mock, type TestContext} from "node:test";
import {syncBuiltinESMExports} from "node:module";
import {createHash} from "node:crypto";
import {readdirSync, statSync} from "node:fs";
import fileOperations, {mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, link, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import type {ApprovedImageGenerationFence} from "../../../../application/ports/image/approved-image-generation.port";
import {createApprovedImageCheckpointResolverAdapter} from "../createApprovedImageCheckpointResolverAdapter";

async function fixture(t: TestContext) {
  const parent = path.resolve(tmpdir()), root = await mkdtemp(path.join(parent, "image-checkpoint-"));
  const identity = await lstat(root, {bigint: true});
  t.after(async () => {
    const current = await lstat(root, {bigint: true});
    assert.equal(path.dirname(root), parent); assert.equal(current.isSymbolicLink(), false);
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(root, {recursive: true});
  });
  const source = path.join(root, "source"), target = path.join(root, "target"); await mkdir(source); await mkdir(target);
  const bytes = Buffer.alloc(65537, 9), sha256 = createHash("sha256").update(bytes).digest("hex");
  const reference = {workspaceId: "workspace.checkpoint", modelRecordId: "model.checkpoint", updatedAt: "2026-11-27T00:00:00.000Z",
    fileName: "image.safetensors", byteLength: bytes.length, sha256};
  const sourceFile = path.join(source, reference.fileName); await writeFile(sourceFile, bytes);
  const model: ModelInventoryRecord = {workspaceId: createWorkspaceId(reference.workspaceId), modelRecordId: reference.modelRecordId,
    createdAt: reference.updatedAt, updatedAt: reference.updatedAt, displayName: "Synthetic image checkpoint", localPath: source,
    source: "local", lifecycleStatus: "downloaded", artifactForm: "checkpoint", provider: "huggingface", serializationFormat: "safetensors", taskTags: ["text-to-image"]};
  const state = {reads: 0, current: true, onRead: (_count: number) => {}, onAssert: () => {}, readGate: undefined as Promise<void> | undefined};
  const models = {async readRecordedModel(workspace: unknown, id: unknown) {
    assert.equal(workspace, reference.workspaceId); assert.equal(id, reference.modelRecordId);
    state.onRead(++state.reads); await state.readGate; return model;
  }, async listModels() {throw Error("Discovery is forbidden.");}};
  const fence: ApprovedImageGenerationFence = {async authorize() {if (!state.current) throw Error("private policy");},
    assertCurrent() {state.onAssert(); if (!state.current) throw Error("private current");}};
  const dependencies = {models, reference, checkpointDirectory: target, maximumCheckpointBytes: bytes.length, minimumFreeDiskBytes: 0};
  const resolve = createApprovedImageCheckpointResolverAdapter(dependencies);
  const request = {workspaceId: reference.workspaceId, selectedModel: reference.modelRecordId, taskTag: "text-to-image"};
  return {root, source, target, bytes, reference, sourceFile, model, state, models, fence, dependencies, resolve, request,
    targetFile: path.join(target, "aisb-" + sha256 + ".safetensors")};
}

test("exact registered checkpoint copies verified bytes and reuses only the same content-addressed entry", async t => {
  const f = await fixture(t), result = await f.resolve(f.request, f.fence);
  assert.equal(result.checkpoint, path.basename(f.targetFile));
  assert.deepEqual(await readFile(f.targetFile), f.bytes); assert.deepEqual(await readFile(f.sourceFile), f.bytes);
  const first = await lstat(f.targetFile, {bigint: true});
  assert.deepEqual(await f.resolve(f.request, f.fence), result);
  assert.equal((await lstat(f.targetFile, {bigint: true})).ino, first.ino);
  assert.deepEqual(await readdir(f.target), [result.checkpoint]); assert.ok(f.state.reads >= 3);
});

test("legacy recorded creation timestamp matches the original metadata owner's updatedAt fallback", async t => {
  const f = await fixture(t); delete f.model.updatedAt;
  const value = await f.resolve(f.request, f.fence); assert.equal(value.checkpoint, path.basename(f.targetFile));
});

test("exact selectors refuse foreign models, workspace, task and extra runtime fields before reading models", async t => {
  const f = await fixture(t);
  for (const request of [{...f.request, selectedModel: "foreign"}, {...f.request, workspaceId: "workspace.foreign"},
    {...f.request, taskTag: "chat"}, {...f.request, runtimeDeviceMode: "auto"}, {...f.request, checkpoint: "foreign"}])
    await assert.rejects(f.resolve(request, f.fence), /^Error: The approved image checkpoint is unavailable\.$/);
  assert.equal(f.state.reads, 0); assert.deepEqual(await readdir(f.target), []);
});

test("immutable predeclared reference cannot be replaced through later caller mutation", async t => {
  const f = await fixture(t); f.reference.sha256 = "a".repeat(64); f.reference.fileName = "foreign.safetensors";
  assert.equal((await f.resolve(f.request, f.fence)).checkpoint, path.basename(f.targetFile));
});

test("wrong digest, source size and corrupt existing target cannot publish or overwrite bytes", async t => {
  for (const change of ["hash", "size", "target"]) {
    const f = await fixture(t);
    if (change === "hash") await writeFile(f.sourceFile, Buffer.alloc(f.bytes.length, 8));
    if (change === "size") await writeFile(f.sourceFile, Buffer.alloc(f.bytes.length + 1, 9));
    if (change === "target") await writeFile(f.targetFile, Buffer.alloc(f.bytes.length, 8));
    await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
    if (change === "target") assert.deepEqual(await readFile(f.targetFile), Buffer.alloc(f.bytes.length, 8));
    assert.deepEqual(await readdir(f.target), change === "target" ? [path.basename(f.targetFile)] : []);
  }
});

test("record timestamp, path or format substitution before publication retires only owned staging", async t => {
  for (const changed of ["timestamp", "path", "format"]) {
    const f = await fixture(t); f.state.onRead = count => {
      if (count !== 2) return;
      if (changed === "timestamp") f.model.updatedAt = "2026-11-26T00:00:00.000Z";
      if (changed === "path") f.model.localPath = f.target;
      if (changed === "format") f.model.serializationFormat = "pytorch-bin";
    };
    await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
    assert.deepEqual(await readdir(f.target), []); assert.deepEqual(await readFile(f.sourceFile), f.bytes);
  }
});

test("hardlinked source files and redirected source directories are refused", async t => {
  const f = await fixture(t); await link(f.sourceFile, path.join(f.source, "alias.safetensors"));
  await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
  const other = await fixture(t), alias = path.join(other.root, "redirected");
  await symlink(other.source, alias, process.platform === "win32" ? "junction" : "dir"); other.model.localPath = alias;
  await assert.rejects(other.resolve(other.request, other.fence), /approved image checkpoint is unavailable/);
  assert.deepEqual(await readdir(other.target), []);
});

test("finite byte and available-disk limits deny without staging or model loading", async t => {
  const f = await fixture(t);
  assert.throws(() => createApprovedImageCheckpointResolverAdapter({...f.dependencies, maximumCheckpointBytes: f.bytes.length - 1}), /approved image checkpoint is unavailable/);
  const noSpace = createApprovedImageCheckpointResolverAdapter({...f.dependencies, minimumFreeDiskBytes: Number.MAX_SAFE_INTEGER});
  await assert.rejects(noSpace(f.request, f.fence), /approved image checkpoint is unavailable/);
  assert.deepEqual(await readdir(f.target), []);
});

test("withdrawal before dispatch and during actual staged copy keeps private errors closed and cleans new bytes", async t => {
  const denied = await fixture(t); denied.state.current = false;
  await assert.rejects(denied.resolve(denied.request, denied.fence), /^Error: The approved image checkpoint is unavailable\.$/);
  assert.equal(denied.state.reads, 0);
  const f = await fixture(t); let observedCopy = false;
  f.state.onAssert = () => {
    const staging = readdirSync(f.target).find(name => name.startsWith(".aisb-stage-"));
    if (staging && statSync(path.join(f.target, staging)).size > 0) {observedCopy = true; f.state.current = false;}
  };
  await assert.rejects(f.resolve(f.request, f.fence), /^Error: The approved image checkpoint is unavailable\.$/);
  assert.equal(observedCopy, true); assert.deepEqual(await readdir(f.target), []);
  assert.deepEqual(await readFile(f.sourceFile), f.bytes);
});

test("unselected private Model fields are never evaluated and missing point reader cannot fall back", async t => {
  const f = await fixture(t); let invoked = 0;
  Object.defineProperty(f.model, "metadata", {get() {invoked++; throw Error("private metadata");}});
  await f.resolve(f.request, f.fence); assert.equal(invoked, 0);
  const unavailable = createApprovedImageCheckpointResolverAdapter({...f.dependencies, models: {}});
  await assert.rejects(unavailable(f.request, f.fence), /approved image checkpoint is unavailable/);
});

test("unconfirmed original read or write closure retains staging and fences this resolver against another attempt", async t => {
  for (const role of ["verification", "reader", "writer"]) {
  const f = await fixture(t), originalOpen = fileOperations.open;
  let sourceReads = 0;
  let closeOriginal: (() => Promise<void>) | undefined, restoreClose: (() => void) | undefined;
  const hook = mock.method(fileOperations, "open", async (...args: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...args);
    if (args[0] === f.sourceFile && args[1] === "r") sourceReads++;
    if (typeof args[0] === "string" && (role === "reader" ? args[0] === f.sourceFile && args[1] === "r" && sourceReads === 2 :
        path.basename(args[0]).startsWith(".aisb-stage-") && args[1] === (role === "writer" ? "wx" : "r"))) {
      assert.equal(closeOriginal, undefined); closeOriginal = handle.close.bind(handle);
      const failure = mock.method(handle, "close", async () => {throw Error("synthetic private close failure");});
      restoreClose = () => failure.mock.restore();
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.resolve(f.request, f.fence), /^Error: The approved image checkpoint is unavailable\.$/);
    const retained = await readdir(f.target); assert.equal(retained.length, 1); assert.ok(retained[0].startsWith(".aisb-stage-"));
    assert.deepEqual(await readFile(path.join(f.target, retained[0])), f.bytes);
    const reads = f.state.reads;
    await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
    assert.equal(f.state.reads, reads); assert.deepEqual(await readdir(f.target), retained);
    assert.ok(closeOriginal, "The original verification handle must be retained by this controlled test.");
  } finally {
    hook.mock.restore(); syncBuiltinESMExports(); restoreClose?.();
    // Only this test's original handle is closed. Product code never assumes it.
    if (closeOriginal) await closeOriginal();
  }
  }
});

test("active Model records and selected accessors are refused without executing traps", async t => {
  const f = await fixture(t); let invoked = 0;
  // Promise resolution in the trusted async provider probes `then` before the
  // adapter receives the value. Keep that probe inert; all data traps must stay unused.
  const traps = {get(_target: object, key: string | symbol) {if (key === "then") return undefined; invoked++; throw Error("private Model");},
    ownKeys() {invoked++; throw Error("private Model");}};
  const proxy = new Proxy<ModelInventoryRecord>(f.model, traps);
  const hostile = createApprovedImageCheckpointResolverAdapter({...f.dependencies, models: {async readRecordedModel() {return proxy;}}});
  await assert.rejects(hostile(f.request, f.fence), /approved image checkpoint is unavailable/);
  f.model.taskTags = new Proxy<NonNullable<ModelInventoryRecord["taskTags"]>>(["text-to-image"], traps);
  await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
  Object.defineProperty(f.model, "taskTags", {enumerable: true, get() {invoked++; throw Error("private Model");}});
  await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
  assert.equal(invoked, 0); assert.deepEqual(await readdir(f.target), []);
});

test("a pending original point read retains the only resolver slot until it settles", async t => {
  const f = await fixture(t); let release!: () => void, entered!: () => void;
  const observed = new Promise<void>(resolve => {entered = resolve;});
  f.state.readGate = new Promise<void>(resolve => {release = resolve;}); f.state.onRead = () => entered();
  const first = f.resolve(f.request, f.fence);
  try {
    await observed;
    await assert.rejects(f.resolve(f.request, f.fence), /approved image checkpoint is unavailable/);
    assert.equal(f.state.reads, 1);
  } finally {release(); await first;}
  assert.deepEqual(await readFile(f.targetFile), f.bytes);
});
