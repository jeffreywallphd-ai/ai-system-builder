import assert from "node:assert/strict";
import fs, {lstat, mkdtemp, readFile, readdir, realpath, rm} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {createContainedFileStreamLifetime as create, inspectContainedFileStreamLifetime as inspect,
  writeContainedFileStream as write, type ContainedFileStreamLifetime} from "../../../../filesystem-security";

const originalFilesystemOpen = fs.open;
function replaceMethod(object: object, name: string, method: Function) {
  Object.defineProperty(object, name, {configurable: true, writable: true, enumerable: true, value: method});
}
const bytes = Buffer.from("synthetic-file-lifetime");
const content = async function* () {yield bytes.subarray(0, 4); yield bytes.subarray(4);};
function deferred<T = void>() {let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};}
async function fixture(run: (root: string) => Promise<void>) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(path.join(parent, "contained-lifetime-")));
  const before = await lstat(root, {bigint: true});
  try {await run(root);} finally {
    fs.open = originalFilesystemOpen; syncBuiltinESMExports();
    const after = await lstat(root, {bigint: true});
    assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino); assert.ok(after.isDirectory() && !after.isSymbolicLink());
    assert.equal(await realpath(root), root); assert.equal(path.dirname(root), parent); await rm(root, {recursive: true});
  }
}
const input = (rootDirectory: string) => ({rootDirectory, key: "private/result.bin", content: content(), maximumBytes: bytes.length, overwrite: false});
const safe = (value: unknown) => assert.doesNotMatch(JSON.stringify(value), /contained-lifetime-|result\.bin|[A-Z]:\\|private-synthetic/);

test("genuine writer lifetime proves exact close and publication once without exposing handles or paths", async () => fixture(async root => {
  const owner = create(); assert.equal(inspect(owner).phase, "unused");
  const result = await write(input(root), owner); assert.equal(result.sizeBytes, bytes.length);
  assert.deepEqual(await readFile(path.join(root, "private/result.bin")), bytes);
  const snapshot = inspect(owner); assert.equal(snapshot.phase, "closed"); assert.equal(snapshot.pendingOperations, 0);
  assert.equal(snapshot.issuedOperations, snapshot.returnedOperations); assert.equal(snapshot.closeAttempted, true);
  assert.equal(snapshot.closeAcknowledged, true); assert.equal(snapshot.publication, "published"); safe(snapshot);
  await assert.rejects(() => write({...input(root), key: "other.bin"}, owner));
  assert.deepEqual(await readdir(root), ["private"]); assert.deepEqual(inspect(owner), snapshot);
}));
test("foreign copied and proxy lifetime objects cannot start writer effects or invoke request getters", async () => fixture(async root => {
  let traps = 0; const owner = create(); const raw = {get rootDirectory() {traps++; return root;}} as any;
  for (const invalid of [{}, Object.create(owner), new Proxy(owner, {get() {traps++; throw Error("proxy");}})]) {
    await assert.rejects(() => write(raw, invalid as ContainedFileStreamLifetime));
    assert.throws(() => inspect(invalid as ContainedFileStreamLifetime));
  }
  assert.equal(traps, 0); assert.deepEqual(await readdir(root), []); assert.equal(inspect(owner).phase, "unused");
}));
test("tracked root key bounds and mode are frozen before the first containment await", async () => fixture(async root => {
  const owner = create(), request = input(root), pending = write(request, owner);
  request.key = "changed.bin"; request.rootDirectory = path.join(root, "changed"); request.maximumBytes = 0; request.overwrite = true;
  await pending; assert.deepEqual(await readFile(path.join(root, "private/result.bin")), bytes);
  assert.deepEqual(await readdir(root), ["private"]); assert.equal(inspect(owner).phase, "closed");
}));
test("pending actual write remains owned after an observer timeout", async () => fixture(async root => {
  const owner = create(), entered = deferred(), gate = deferred(), originalOpen = fs.open;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args), originalWrite = handle.write.bind(handle);
    replaceMethod(handle, "write", async (...writeArgs: any[]) => {entered.resolve(); await gate.promise; return (originalWrite as any)(...writeArgs);});
    return handle;
  }); syncBuiltinESMExports();
  const pending = write(input(root), owner);
  try {
    await entered.promise; const timed = await Promise.race([pending.then(() => "finished"), Promise.resolve("observer-ended")]);
    assert.equal(timed, "observer-ended"); assert.equal(inspect(owner).phase, "active"); assert.equal(inspect(owner).pendingOperations, 1);
    assert.equal(inspect(owner).invocationFinished, false); gate.resolve(); await pending; assert.equal(inspect(owner).phase, "closed");
  } finally {gate.resolve(); await pending.catch(() => {});}
}));
test("pending original close blocks local retirement and file publication", async () => fixture(async root => {
  const owner = create(), entered = deferred(), gate = deferred(), originalOpen = fs.open;
  let closes = 0;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args), originalClose = handle.close.bind(handle);
    replaceMethod(handle, "close", async () => {closes++; entered.resolve(); await gate.promise; await originalClose();}); return handle;
  }); syncBuiltinESMExports();
  const pending = write(input(root), owner);
  try {
    await entered.promise; const snapshot = inspect(owner); assert.equal(snapshot.phase, "active");
    assert.equal(snapshot.closeAttempted, true); assert.equal(snapshot.closeAcknowledged, false); assert.equal(snapshot.pendingOperations, 1);
    await assert.rejects(() => readFile(path.join(root, "private/result.bin")));
    gate.resolve(); await pending; assert.equal(inspect(owner).phase, "closed"); assert.equal(closes, 1);
  } finally {gate.resolve(); await pending.catch(() => {});}
}));
test("failed source followed by exact known close gives local IO closure with uncertain publication", async () => fixture(async root => {
  const owner = create(); let closes = 0; const originalOpen = fs.open;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args), originalClose = handle.close.bind(handle);
    replaceMethod(handle, "close", async () => {closes++; await originalClose();}); return handle;
  }); syncBuiltinESMExports();
  const source = async function* () {yield bytes; throw Error("private-synthetic-source-error");};
  await assert.rejects(() => write({...input(root), content: source()}, owner));
  const snapshot = inspect(owner); assert.equal(snapshot.phase, "closed"); assert.equal(snapshot.publication, "unconfirmed");
  assert.equal(snapshot.closeAcknowledged, true); assert.equal(snapshot.pendingOperations, 0); assert.equal(closes, 1); safe(snapshot);
  assert.deepEqual(await readdir(path.join(root, "private")), []);
}));
test("lost close acknowledgement stays uncertain after fixture-only handle cleanup and is never reissued", async () => fixture(async root => {
  const owner = create(), originalOpen = fs.open; let closeFixture: (() => Promise<void>) | undefined, closes = 0;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args); closeFixture = handle.close.bind(handle);
    replaceMethod(handle, "close", async () => {closes++; throw Error("private-synthetic-close-error");}); return handle;
  }); syncBuiltinESMExports();
  try {
    const source = async function* () {yield bytes; throw Error("private-synthetic-source-error");};
    await assert.rejects(() => write({...input(root), content: source()}, owner));
    assert.equal(inspect(owner).phase, "unconfirmed"); assert.equal(inspect(owner).closeAcknowledged, false); assert.equal(closes, 1);
    await closeFixture!(); closeFixture = undefined; assert.equal(inspect(owner).phase, "unconfirmed");
    await assert.rejects(() => write(input(root), owner)); assert.equal(closes, 1); safe(inspect(owner));
  } finally {await closeFixture?.();}
}));
test("lost accepted open cannot become no-handle proof", async () => fixture(async root => {
  const owner = create(), originalOpen = fs.open; let closeFixture: (() => Promise<void>) | undefined;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args); closeFixture = handle.close.bind(handle); throw Error("private-synthetic-lost-open");
  }); syncBuiltinESMExports();
  try {
    await assert.rejects(() => write(input(root), owner)); const snapshot = inspect(owner);
    assert.equal(snapshot.phase, "unconfirmed"); assert.equal(snapshot.handleAcquired, false); assert.equal(snapshot.invocationFinished, true);
    assert.equal(snapshot.pendingOperations, 0); await closeFixture!(); closeFixture = undefined;
    assert.equal(inspect(owner).phase, "unconfirmed"); safe(snapshot);
  } finally {await closeFixture?.();}
}));
test("original handle methods are captured before a source can replace them", async () => fixture(async root => {
  const owner = create(), originalOpen = fs.open; let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  replaceMethod(fs, "open", async (...args: Parameters<typeof fs.open>) => {handle = await originalOpen(...args); return handle;}); syncBuiltinESMExports();
  const source = async function* () {
    replaceMethod(handle!, "write", async () => {throw Error("replacement write");});
    replaceMethod(handle!, "sync", async () => {throw Error("replacement sync");});
    replaceMethod(handle!, "close", async () => {throw Error("replacement close");}); yield bytes;
  };
  await write({...input(root), content: source()}, owner); assert.equal(inspect(owner).phase, "closed");
  assert.deepEqual(await readFile(path.join(root, "private/result.bin")), bytes);
}));
test("live operation storage stays serial while cumulative observations grow", async () => fixture(async root => {
  const owner = create(); let maximumPending = 0;
  const source = async function* () {for (let i = 0; i < 256; i++) {maximumPending = Math.max(maximumPending, inspect(owner).pendingOperations); yield new Uint8Array([i % 256]);}};
  await write({...input(root), content: source(), maximumBytes: 256}, owner);
  const snapshot = inspect(owner); assert.equal(snapshot.phase, "closed"); assert.ok(snapshot.issuedOperations > 256);
  assert.equal(snapshot.returnedOperations, snapshot.issuedOperations); assert.ok(maximumPending <= 1);
  assert.equal((await readFile(path.join(root, "private/result.bin"))).length, 256);
}));
