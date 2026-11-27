import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import operations, {link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {test, mock} from "node:test";
import type {ReviewedGeneratedModelControl, ReviewedGeneratedModelRequest} from "../../../../application/ports/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createLocalGeneratedModelStorageAdapter} from "../createLocalGeneratedModelStorageAdapter";

const saveId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const sha = (b: string | Buffer) => "sha256:" + createHash("sha256").update(b).digest("hex");
const context = () => ({requestId: saveId, organizationId: createOrganizationId("org"), principalId: "tester", workspaceId: "workspace"});
const control = (): ReviewedGeneratedModelControl => ({isCurrent: () => true, stillAllowed: async () => true, mayDiscard: async () => true});
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); const original = await lstat(f.root, {bigint: true});
  try {await run(f);} finally {
    const current = await lstat(f.root, {bigint: true});
    assert.equal(path.dirname(f.root), await realpath(tmpdir())); assert.equal(await realpath(f.root), f.root);
    assert.ok(original.ino > 0n && current.ino === original.ino && current.dev === original.dev && current.isDirectory() && !current.isSymbolicLink());
    await rm(f.root, {recursive: true});
  }
}
async function setup() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "reviewed-model-copy-"));
  const source = path.join(root, "source"), storage = path.join(root, "private");
  await mkdir(source); await mkdir(storage);
  const contents = new Map<string, Buffer>([["config.json", Buffer.from("{}")], ["model.safetensors", Buffer.from("synthetic weights")], ["tokenizer.json", Buffer.from("{}")]]);
  for (const [name, bytes] of contents) await writeFile(path.join(source, name), bytes);
  const options = {rootDirectory: storage, maximumFiles: 13, maximumTotalBytes: 4 * 1024 ** 2, maximumDurationMs: 10000, minimumFreeBytes: 0};
  const request = (): ReviewedGeneratedModelRequest => ({taskId, saveId, candidateDigest: sha("candidate"), sourceDirectory: source,
    artifactForm: "full-model", files: [...contents].map(([name, b]) => ({name, expectedSizeBytes: b.length, expectedSha256: sha(b)}))});
  const adapter = () => createLocalGeneratedModelStorageAdapter({env: {HF_HUB_CACHE: path.join(root, "ordinary")}, reviewedStorage: options});
  const bind = (r = request(), c = control()) => {const s = adapter().createReviewedSession!(r, context(), c); assert.ok(s); return s;};
  return {root, source, storage, contents, options, request, adapter, bind};
}
function deferred() {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};}

test("ordinary adapter omits reviewed copying and binding performs no IO", async () => fixture(async f => {
  assert.equal(createLocalGeneratedModelStorageAdapter({env: {HF_HUB_CACHE: f.storage}}).createReviewedSession, undefined);
  const request = {...f.request(), sourceDirectory: path.join(f.root, "not-created")};
  const s = f.bind(request); assert.equal(s.inspect().phase, "bound");
  assert.equal(s.inspect().declaredPayloadBytes, 0); assert.deepEqual(await readdir(f.storage), []);
  assert.equal(await s.discard(), true); await assert.rejects(s.write());
}));

test("copies only reviewed files with bounded buffers and waits for original closure", async () => fixture(async f => {
  const weights = Buffer.alloc(1024 ** 2 + 37, 0x61); f.contents.set("model.safetensors", weights);
  await writeFile(path.join(f.source, "model.safetensors"), weights);
  await writeFile(path.join(f.source, "checkpoint-not-selected"), "not a candidate");
  const s = f.bind(), result = await s.write();
  assert.equal(result.storageProfile, "bounded-local-v1"); assert.equal(result.candidateDigest, sha("candidate"));
  assert.equal(result.fileCount, 3); assert.equal(result.totalBytes, [...f.contents.values()].reduce((n, b) => n + b.length, 0));
  assert.equal(path.dirname(result.localPath), f.storage); assert.match(path.basename(result.localPath), /^\.model-copy-[a-f0-9]{32}$/);
  assert.deepEqual((await readdir(result.localPath)).sort(), [...f.contents.keys()].sort());
  for (const [name, bytes] of f.contents) assert.deepEqual(await readFile(path.join(result.localPath, name)), bytes);
  assert.deepEqual(s.inspect(), {phase: "ready", fenced: false, pendingOperations: 0, openFiles: 0, ioClosed: true,
    declaredPayloadBytes: result.totalBytes, physicalQuotaEnforced: false});
  await assert.rejects(s.write()); assert.equal(await s.discard(), true);
  assert.equal(s.inspect().declaredPayloadBytes, 0); assert.deepEqual(await readdir(f.storage), []);
  assert.equal(await readFile(path.join(f.source, "checkpoint-not-selected"), "utf8"), "not a candidate");
}));

test("supports an exact adapter layout without creating an ordinary cache snapshot", async () => fixture(async f => {
  const files = ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"];
  for (const name of files) await writeFile(path.join(f.source, name), "adapter fixture");
  const r = {...f.request(), artifactForm: "adapter" as const, files: files.map(name => ({name, expectedSizeBytes: 15, expectedSha256: sha("adapter fixture")}))};
  const s = f.bind(r), result = await s.write(); assert.deepEqual((await readdir(result.localPath)).sort(), files.sort());
  assert.deepEqual((await readdir(f.root)).sort(), ["private", "source"]); assert.equal(await s.discard(), true);
}));

test("captures request, context, settings and original control methods before awaits", async () => fixture(async f => {
  const r = f.request(), c = control(), ctx = context(), adapter = f.adapter();
  const s = adapter.createReviewedSession!(r, ctx, c); assert.ok(s);
  Object.assign(r, {sourceDirectory: path.join(f.root, "elsewhere"), candidateDigest: sha("changed")});
  Object.assign(r.files[0]!, {name: "foreign", expectedSha256: sha("changed")});
  ctx.workspaceId = "changed"; f.options.rootDirectory = path.join(f.root, "elsewhere");
  c.isCurrent = () => false; c.stillAllowed = async () => false; c.mayDiscard = async () => false;
  const result = await s.write(); assert.equal(result.candidateDigest, sha("candidate"));
  assert.equal(path.dirname(result.localPath), f.storage); assert.equal(await s.discard(), true);
}));

test("refuses malformed options and closed request/context shapes without invoking accessors", async () => fixture(async f => {
  for (const patch of [{maximumFiles: 2}, {maximumTotalBytes: Infinity}, {maximumDurationMs: 0}, {minimumFreeBytes: -1}, {rootDirectory: path.parse(f.storage).root}]) {
    assert.throws(() => createLocalGeneratedModelStorageAdapter({reviewedStorage: {...f.options, ...patch}}));
  }
  let invoked = 0;
  const accessor = Object.defineProperty({...f.request()}, "sourceDirectory", {enumerable: true, get() {invoked++; return f.source;}});
  const proxy = new Proxy(f.request(), {getPrototypeOf() {invoked++; return Object.prototype;}});
  const a = f.adapter();
  for (const r of [accessor, proxy, {...f.request(), extra: true}, {...f.request(), saveId: "wrong"}, {...f.request(), sourceDirectory: f.storage}])
    assert.equal(a.createReviewedSession!(r, context(), control()), undefined);
  assert.equal(a.createReviewedSession!(f.request(), {...context(), requestId: taskId}, control()), undefined);
  const badFiles = Object.defineProperty([...f.request().files], "0", {enumerable: true, get() {invoked++; return {};}});
  assert.equal(a.createReviewedSession!({...f.request(), files: badFiles}, context(), control()), undefined);
  assert.equal(invoked, 0); assert.deepEqual(await readdir(f.storage), []);
}));

test("refuses unsafe, duplicate, incomplete and mixed candidate layouts before IO", async () => fixture(async f => {
  const r = f.request(), files = r.files;
  const variants = [[...files, files[0]!], files.slice(1), [{...files[0]!, name: "../config.json"}, ...files.slice(1)],
    [...files, {...files[0]!, name: "adapter_model.safetensors"}], [{...files[0]!, expectedSizeBytes: 0}, ...files.slice(1)],
    [{...files[0]!, expectedSha256: "sha256:bad"}, ...files.slice(1)]];
  for (const selected of variants) assert.equal(f.adapter().createReviewedSession!({...r, files: selected}, context(), control()), undefined);
  assert.deepEqual(await readdir(f.storage), []);
}));

test("enforces total selected bytes before creating destination", async () => fixture(async f => {
  f.options.maximumTotalBytes = 3;
  assert.equal(f.adapter().createReviewedSession!(f.request(), context(), control()), undefined);
  assert.deepEqual(await readdir(f.storage), []);
}));

test("refuses denied or fenced admission without starting IO", async () => fixture(async f => {
  for (const deny of ["fence", "current", "permission"] as const) {
    const c = control(); if (deny === "current") c.isCurrent = () => false; if (deny === "permission") c.stillAllowed = async () => false;
    const s = f.bind(f.request(), c); if (deny === "fence") s.fence();
    await assert.rejects(s.write()); assert.deepEqual(await readdir(f.storage), []); assert.equal(s.inspect().ioClosed, true);
    assert.equal(await s.discard(), true);
  }
}));

test("a malformed original permission Promise remains unconfirmed without retry or cleanup credit", async () => fixture(async f => {
  const c = control(); c.stillAllowed = (() => ({then() {throw new Error("must not assimilate");}})) as unknown as typeof c.stillAllowed;
  const s = f.bind(f.request(), c); await assert.rejects(s.write());
  assert.equal(s.inspect().phase, "unconfirmed"); assert.equal(s.inspect().ioClosed, false);
  assert.equal(s.inspect().pendingOperations, 1); assert.equal(await s.discard(), false); await assert.rejects(s.write());
  assert.deepEqual(await readdir(f.storage), []);
}));

test("available disk space is checked before destination creation", async () => fixture(async f => {
  const replacement = mock.method(operations, "statfs", async () => ({bsize: 4096n, bavail: 0n})); syncBuiltinESMExports();
  const s = f.bind(); try {await assert.rejects(s.write());} finally {replacement.mock.restore(); syncBuiltinESMExports();}
  assert.deepEqual(await readdir(f.storage), []); assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true);
}));

for (const mismatch of ["size", "hash"] as const) test(`refuses a changed ${mismatch} and can remove only its closed known partial copy`, async () => fixture(async f => {
  const r = f.request();
  Object.assign(r.files[1]!, mismatch === "size" ? {expectedSizeBytes: 1} : {expectedSha256: sha("different")});
  const s = f.bind(r); await assert.rejects(s.write());
  assert.equal(s.inspect().phase, "failed"); assert.equal(s.inspect().ioClosed, true);
  assert.equal(await s.discard(), true); assert.deepEqual(await readdir(f.storage), []);
  assert.equal(await readFile(path.join(f.source, "model.safetensors"), "utf8"), "synthetic weights");
}));

test("permission loss after destination creation closes original handles before cleanup", async () => fixture(async f => {
  let calls = 0; const c = control(); c.stillAllowed = async () => ++calls < 7;
  const s = f.bind(f.request(), c); await assert.rejects(s.write());
  assert.ok(calls >= 7); assert.equal(s.inspect().ioClosed, true); assert.equal(s.inspect().openFiles, 0);
  assert.equal(await s.discard(), true); assert.deepEqual(await readdir(f.storage), []);
}));

test("a real deadline denial cannot be treated as successful copy", async () => fixture(async f => {
  f.options.maximumDurationMs = 1;
  const gate = deferred(), entered = deferred(), c = control();
  c.stillAllowed = async () => {entered.resolve(); await gate.promise; return true;};
  const s = f.bind(f.request(), c), attempt = s.write(); const observed = assert.rejects(attempt);
  await entered.promise; await new Promise(r => setTimeout(r, 15));
  assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
  gate.resolve(); await observed; assert.equal(s.inspect().ioClosed, true); assert.deepEqual(await readdir(f.storage), []);
}));

test("late original opens remain pending through a fence and are actually closed before discard", async () => fixture(async f => {
  const openFile = open, gate = deferred(), entered = deferred(); let delayed = false;
  const opening = mock.method(operations, "open", async (...args: Parameters<typeof openFile>) => {
    const h = await openFile(...args);
    if (!delayed && args[0] === path.join(f.source, "config.json")) {delayed = true; entered.resolve(); await gate.promise;}
    return h;
  }); syncBuiltinESMExports();
  const s = f.bind(), attempt = s.write(), rejected = assert.rejects(attempt);
  try {
    await entered.promise; s.fence(); assert.equal(s.inspect().phase, "writing"); assert.equal(s.inspect().pendingOperations, 1);
    assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
    gate.resolve(); await rejected; assert.equal(s.inspect().openFiles, 0); assert.equal(s.inspect().ioClosed, true);
    assert.equal(await s.discard(), true);
  } finally {gate.resolve(); await rejected; opening.mock.restore(); syncBuiltinESMExports();}
}));

test("failed original close retains the handle, declared bytes and copy without cleanup or retry", async () => fixture(async f => {
  const openFile = open; let actualClose: (() => Promise<void>) | undefined;
  const opening = mock.method(operations, "open", async (...args: Parameters<typeof openFile>) => {
    const h = await openFile(...args);
    if (!actualClose && args[0] === path.join(f.source, "config.json")) {
      actualClose = h.close.bind(h); mock.method(h, "close", async () => {throw new Error("synthetic uncertain close");});
    }
    return h;
  }); syncBuiltinESMExports(); const s = f.bind();
  try {
    await assert.rejects(s.write()); assert.equal(s.inspect().phase, "unconfirmed"); assert.equal(s.inspect().openFiles, 1);
    assert.equal(s.inspect().ioClosed, false); assert.ok(s.inspect().declaredPayloadBytes > 0);
    assert.equal(await s.discard(), false); await assert.rejects(s.write());
  } finally {opening.mock.restore(); syncBuiltinESMExports(); if (actualClose) await actualClose();}
}));

test("existing destination is never adopted, overwritten or deleted", async () => fixture(async f => {
  const a = f.bind(), saved = await a.write();
  const b = f.bind(); await assert.rejects(b.write()); assert.equal(b.inspect().declaredPayloadBytes, 0);
  assert.equal(await b.discard(), true); assert.equal(await readFile(path.join(saved.localPath, "config.json"), "utf8"), "{}");
  assert.equal(await a.discard(), true);
}));

test("discard needs independent no-reference permission, even after write permission expires", async () => fixture(async f => {
  let canWrite = true, canDiscard = false; const c = control();
  c.isCurrent = () => canWrite; c.mayDiscard = async () => canDiscard;
  const s = f.bind(f.request(), c), saved = await s.write(); canWrite = false;
  assert.equal(await s.discard(), false); assert.equal(await readFile(path.join(saved.localPath, "config.json"), "utf8"), "{}");
  canDiscard = true; assert.equal(await s.discard(), true); assert.equal(await s.discard(), true);
}));

for (const change of ["foreign-entry", "changed-file", "replaced-directory"] as const) test(`discard preserves ${change} without cleanup credit`, async () => fixture(async f => {
  const s = f.bind(), result = await s.write();
  if (change === "foreign-entry") await writeFile(path.join(result.localPath, "foreign"), "preserve");
  if (change === "changed-file") await writeFile(path.join(result.localPath, "config.json"), "changed");
  if (change === "replaced-directory") {await rename(result.localPath, path.join(f.storage, "retained-original")); await mkdir(result.localPath); await writeFile(path.join(result.localPath, "foreign"), "preserve");}
  assert.equal(await s.discard(), false); assert.equal(s.inspect().phase, "unconfirmed"); assert.ok(s.inspect().declaredPayloadBytes > 0);
  assert.ok((await readdir(result.localPath)).length > 0); assert.equal(await s.discard(), false);
}));

test("source hardlinks are refused without changing either original file", async () => fixture(async f => {
  const original = path.join(f.source, "model.safetensors"), alias = path.join(f.root, "alias"); await link(original, alias);
  const s = f.bind(); await assert.rejects(s.write()); assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true);
  assert.equal(await readFile(alias, "utf8"), "synthetic weights"); assert.equal(await readFile(original, "utf8"), "synthetic weights");
}));

test("an original source file changed during reading is refused", async () => fixture(async f => {
  const openFile = open; let changed = false;
  const opening = mock.method(operations, "open", async (...args: Parameters<typeof openFile>) => {
    const h = await openFile(...args);
    if (!changed && args[0] === path.join(f.source, "model.safetensors")) {
      changed = true; const read = h.read.bind(h);
      mock.method(h, "read", async (buffer: Buffer, offset: number, length: number, position: number | null) => {
        await writeFile(path.join(f.source, "model.safetensors"), "different bytes!"); return read(buffer, offset, length, position);
      });
    } return h;
  }); syncBuiltinESMExports(); const s = f.bind();
  try {await assert.rejects(s.write());} finally {opening.mock.restore(); syncBuiltinESMExports();}
  assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true);
}));

for (const permissionNumber of [2, 4, 5, 6, 7, 8, 9, 10]) test(`queued fence at permission ${permissionNumber} prevents new file work in its caller continuation`, async () => fixture(async f => {
  let permissions = 0, afterPermission = false, withdrawn = false;
  const afterFence: string[] = [], patches: {mock: {restore(): void}}[] = [], c = control();
  let s: ReturnType<typeof f.bind>;
  c.stillAllowed = async () => {permissions++; afterPermission = true; return true;};
  c.isCurrent = () => {
    if (afterPermission) {
      afterPermission = false;
      if (permissions === permissionNumber) queueMicrotask(() => {withdrawn = true; s.fence();});
    }
    return true;
  };
  const originalOpen = open, originalMkdir = mkdir;
  patches.push(mock.method(operations, "mkdir", async (...args: Parameters<typeof mkdir>) => {
    if (withdrawn) afterFence.push("mkdir"); return originalMkdir(...args);
  }));
  patches.push(mock.method(operations, "open", async (...args: Parameters<typeof open>) => {
    if (withdrawn) afterFence.push("open");
    const h = await originalOpen(...args);
    const originalRead = h.read.bind(h), originalWrite = h.write.bind(h), originalSync = h.sync.bind(h);
    patches.push(mock.method(h, "read", async (buffer: Buffer, offset: number, length: number, position: number | null) => {
      if (withdrawn) afterFence.push("read"); return originalRead(buffer, offset, length, position);
    }));
    patches.push(mock.method(h, "write", async (buffer: Buffer, offset: number, length: number, position: number | null) => {
      if (withdrawn) afterFence.push("write"); return originalWrite(buffer, offset, length, position);
    }));
    patches.push(mock.method(h, "sync", async () => {if (withdrawn) afterFence.push("sync"); return originalSync();}));
    return h;
  }));
  syncBuiltinESMExports(); s = f.bind(f.request(), c);
  try {
    await assert.rejects(s.write()); assert.equal(withdrawn, true); assert.deepEqual(afterFence, []);
    assert.equal(s.inspect().ioClosed, true); assert.equal(s.inspect().openFiles, 0);
    if (permissionNumber === 2) assert.deepEqual(await readdir(f.storage), []);
    assert.equal(await s.discard(), true);
  } finally {for (const patch of patches.reverse()) patch.mock.restore(); syncBuiltinESMExports();}
}));
