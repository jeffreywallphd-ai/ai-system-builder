import assert from "node:assert/strict";
import {createHash, randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import fs, {link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, unlink, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {readModelDownloadSource} from "../../../../contracts/model";
import {prepareModelSourceRecipient, type ModelSourceRecipient, type ModelSourceRecipientOptions} from "../client/modelSourceRecipient";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {captureManifestExpectation} from "../client/modelDownloadManifest";
import {MODEL_SOURCE_IDENTITY_VERSION, modelSourceIdentityMac, type ModelSourceIdentityProbe,
  type ModelSourceIdentityProof, type ModelSourceIdentityProbeInput, type RuntimeFilesystemIdentity} from "../client/modelSourceIdentity";

const taskId = "11111111-1111-4111-8111-111111111111", revision = "a".repeat(40), modelId = "fixture/model";
const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const data: Record<string, Buffer> = {"config.json": Buffer.from('{"model_type":"synthetic"}'),
  "model.safetensors": Buffer.from("synthetic-safe-weight-fixture"), "tokenizer.json": Buffer.from("{}")};
function manifest() {
  const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors",
    license: {kind: "unknown"}, files: Object.entries(data).map(([name, value]) => ({path: name, sizeBytes: value.length,
      integrity: name.endsWith("safetensors") ? {algorithm: "sha256", digest: createHash("sha256").update(value).digest("hex")} :
        {algorithm: "git-blob-sha1", digest: createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex")}})),
    totalBytes: Object.values(data).reduce((sum, value) => sum + value.length, 0), excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId, revision});
  return {source, manifestDigest: hash(source)};
}
/** Explicit synthetic runtime view; the separate real-worker journey uses Python facts. */
function syntheticProbe(cacheRoot: string, selected: ReturnType<typeof manifest>): ModelSourceIdentityProbe {
  const incarnation = {runtimeId: "synthetic-worker", workerStartedAt: "2026-11-19T00:00:00+00:00"};
  const facts = async (filename: string) => {
    const value = await lstat(filename, {bigint: true});
    return [value.dev.toString(), value.ino.toString(), value.mode.toString(), "0", "0"] as unknown as RuntimeFilesystemIdentity;
  };
  return Object.freeze({...incarnation, assertCurrent() {}, async inspect(input: ModelSourceIdentityProbeInput) {
    const namespace = path.join(cacheRoot, ".aisb-model-source-transfers"), root = path.join(namespace, input.acquisitionId);
    const receiver = path.join(root, "receiver");
    const roots = {acquisition: await facts(root), source: await facts(path.join(root, "source")), receiver: await facts(receiver)};
    const files = [];
    if (input.phase === "snapshot") for (const file of selected.source.files) {
      const filename = path.join(receiver, input.handoffId, "models--fixture--model", "snapshots", revision, file.path);
      const stat = await lstat(filename, {bigint: true});
      files.push({path: file.path, identity: await facts(filename), nlink: Number(stat.nlink), sizeBytes: Number(stat.size),
        mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString()});
    }
    const proof: ModelSourceIdentityProof = {...input, ...incarnation, version: MODEL_SOURCE_IDENTITY_VERSION, roots,
      manifestDigest: input.phase === "roots" ? null : selected.manifestDigest, files};
    const secret = await readFile(path.join(namespace, input.acquisitionId + ".proof"));
    return {proof, mac: modelSourceIdentityMac(secret, proof).toString("hex")};
  }});
}
async function fixture(t: TestContext) {
  const boundary = await realpath(tmpdir()), base = await mkdtemp(path.join(boundary, "source-recipient-"));
  const original = await lstat(base, {bigint: true});
  t.after(async () => {
    const current = await lstat(base, {bigint: true});
    assert.equal(path.dirname(base), boundary); assert.equal(await realpath(base), base);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    await rm(base, {recursive: true});
  });
  const cacheRoot = path.join(base, "cache"); await mkdir(cacheRoot);
  let captured: ModelSourceRecipient | undefined, current = true, allowed = true;
  const selected = manifest();
  const options: ModelSourceRecipientOptions = {cacheRoot, taskId, manifest: selected, maximumDurationSeconds: 10,
    allowedOrigins: ["https://huggingface.co"], isCurrent: () => current, isBusinessAllowed: async () => allowed,
    captureCustodian(owner) {assert.equal(owner.phase, "preparing"); captured = owner;}, identityProbe: syntheticProbe(cacheRoot, selected)};
  const owner = await prepareModelSourceRecipient(options), transfer = owner.transfer;
  const root = path.join(cacheRoot, ".aisb-model-source-transfers", transfer.acquisitionId), sender = path.join(root, "source");
  const receiver = path.join(root, "receiver"), snapshot = path.join(receiver, transfer.handoffId, "models--fixture--model", "snapshots", revision);
  const sourceFiles = path.join(sender, "synthetic-stage");
  async function produce() {
    owner.markIssued(); await mkdir(snapshot, {recursive: true}); await mkdir(sourceFiles);
    const files = [];
    for (const file of selected.source.files) {
      const source = path.join(sourceFiles, file.path), target = path.join(snapshot, file.path);
      await writeFile(source, data[file.path]); await link(source, target);
      const facts = await lstat(target, {bigint: true});
      files.push({path: file.path, device: facts.dev.toString(), inode: facts.ino.toString(), size: file.sizeBytes});
    }
    const native = await lstat(receiver, {bigint: true});
    const witness = hash({task: taskId, handoff: transfer.handoffId,
      root: [native.dev.toString(), native.ino.toString(), native.mode.toString(), "0", "0"]});
    return {task_id: taskId, handoff_id: transfer.handoffId, model_id: modelId, revision,
      manifest_digest: selected.manifestDigest, recipient_witness: witness, file_count: files.length, size_bytes: selected.source.totalBytes,
      receipt_digest: hash({task: taskId, handoff: transfer.handoffId, manifest: selected.manifestDigest, recipient: witness, files})};
  }
  async function senderClean() {
    for (const file of selected.source.files) await unlink(path.join(sourceFiles, file.path));
    await fs.rmdir(sourceFiles);
  }
  async function ready() {const receipt = await produce(); await owner.observeReceipt(receipt); await senderClean(); await owner.confirmSenderCleanup(); return receipt;}
  return {base, cacheRoot, owner, captured, selected, options, transfer, root, sender, receiver, snapshot, sourceFiles,
    produce, senderClean, ready, withdraw: () => {current = false;}, denyBusiness: () => {allowed = false;}};
}

test("fresh private roots capture decimal identities before effects and retire unissued without touching shared siblings", async t => {
  const f = await fixture(t);
  assert.equal(f.captured, f.owner); assert.equal(f.owner.phase, "prepared");
  assert.ok(Object.isFrozen(f.transfer)); assert.ok(Object.isFrozen(f.transfer.roots.receiver));
  assert.doesNotMatch(JSON.stringify(f.transfer), /cacheRoot|isCurrent|captureCustodian/);
  assert.equal(JSON.stringify(f.owner), "{}");
  const facts = await lstat(f.receiver, {bigint: true});
  assert.deepEqual(f.transfer.roots.receiver, {device: facts.dev.toString(), inode: facts.ino.toString()});
  const sibling = path.join(path.dirname(f.root), "unrelated-marker"); await writeFile(sibling, "owned test marker");
  await f.owner.retireUnissued(); assert.equal(f.owner.phase, "settled"); assert.equal(f.owner.cleanupPending, false);
  assert.equal(await readFile(sibling, "utf8"), "owned test marker");
  await assert.rejects(lstat(f.root), {code: "ENOENT"});
  assert.throws(() => f.owner.acknowledgement("receiver-settled"));
});

test("exact complete receipt, sender cleanup, one-use consumption and known retirement stay distinct", async t => {
  const f = await fixture(t), receipt = await f.produce();
  assert.throws(() => f.owner.markIssued());
  await assert.rejects(f.owner.retireUnissued());
  await f.owner.observeReceipt(receipt); assert.equal(f.owner.phase, "observed");
  assert.equal(f.owner.acknowledgement("receiver-observed").receiptDigest, receipt.receipt_digest);
  assert.throws(() => f.owner.acknowledgement("receiver-settled"));
  await f.senderClean(); await f.owner.confirmSenderCleanup();
  const result = await f.owner.consume(async snapshot => {
    assert.equal(snapshot, f.snapshot); assert.equal(f.owner.cleanupPending, true);
    for (const [name, value] of Object.entries(data)) assert.deepEqual(await readFile(path.join(snapshot, name)), value);
    return "synthetic stored outcome";
  });
  assert.equal(result, "synthetic stored outcome"); await assert.rejects(f.owner.consume(async () => assert.fail("No repeat")));
  await f.owner.retire(); assert.equal(f.owner.phase, "settled");
  assert.equal(f.owner.acknowledgement("receiver-settled").receiptDigest, receipt.receipt_digest);
  await assert.rejects(lstat(f.root), {code: "ENOENT"});
});

test("actual owned Python Task and Handoff producer interoperate through full distinct identities and MAC", {
  skip: process.env.AISB_RUN_MODEL_SOURCE_INTEROP !== "1" ? "The mandatory worker feature profile runs this controlled integration with its exact installed Python." : false,
}, async t => {
  assert.ok(process.env.PYTHON, "The focused control-plane environment supplies its installed Python.");
  const boundary = await realpath(tmpdir()), base = await mkdtemp(path.join(boundary, "source-recipient-worker-"));
  const original = await lstat(base, {bigint: true}), cacheRoot = path.join(base, "cache"); await mkdir(cacheRoot);
  const token = randomBytes(32).toString("hex");
  const child = spawn(process.env.PYTHON!, ["-B", "-m", "modules.adapters.runtime.python.worker.tests.model_source_identity_fixture"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {...process.env, AISB_MODEL_SOURCE_FIXTURE_CACHE: cacheRoot,
      PYTHON_RUNTIME_AUTH_TOKEN: token, PYTHON_RUNTIME_ID: "synthetic-owned-model-worker"},
  });
  let ended = false;
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(resolve => child.once("close", (code, signal) => {
    ended = true; resolve({code, signal});
  }));
  child.stderr.on("data", () => {});
  t.after(async () => {
    child.stdin.end("stop\n");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([closed, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error("Owned fixture stop unconfirmed.")), 8000);})]);
      assert.equal(result.code, 0); assert.equal(result.signal, null);
    } finally {
      if (timer) clearTimeout(timer);
      if (!ended) child.kill();
    }
    const current = await lstat(base, {bigint: true});
    assert.equal(path.dirname(base), boundary); assert.equal(await realpath(base), base);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    await rm(base, {recursive: true});
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = await new Promise<{port: number; manifest: unknown}>((resolve, reject) => {
    let buffer = "", bytes = 0, done = false;
    timer = setTimeout(() => reject(new Error("Owned fixture startup unconfirmed.")), 15_000);
    child.once("error", () => reject(new Error("Owned fixture startup unavailable.")));
    void closed.then(() => {if (!done) reject(new Error("Owned fixture exited before startup."));});
    child.stdout.on("data", (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length; if (bytes > 32 * 1024) {reject(new Error("Owned fixture startup exceeded its bound.")); return;}
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const value = JSON.parse(buffer.slice(0, newline));
        if (value.event !== "model-source-identity-fixture-ready" || !Number.isSafeInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error();
        done = true; resolve({port: value.port, manifest: value.manifest});
      } catch {reject(new Error("Owned fixture startup reply invalid."));}
    });
  }).finally(() => {if (timer) clearTimeout(timer);});
  const selected = captureManifestExpectation(ready.manifest), baseUrl = `http://127.0.0.1:${ready.port}`;
  const owned = () => {if (ended || !child.pid) throw new Error("Owned synthetic worker exited.");};
  const client = createPythonRuntimeHttpClient({baseUrl, authorizationToken: token, captureProcessOwnership: () => owned});
  const session = await client.captureModelSourceTaskSession(), identityProbe = session.identityProbe;
  let captured: ModelSourceRecipient | undefined;
  const owner = await prepareModelSourceRecipient({cacheRoot, taskId, manifest: selected, maximumDurationSeconds: 10,
    allowedOrigins: ["https://huggingface.co"], isCurrent: () => !ended, isBusinessAllowed: async () => true,
    captureCustodian: value => {captured = value;}, identityProbe});
  assert.equal(captured, owner);
  const accepted = await session.start(owner, "33333333-3333-4333-8333-333333333333");
  assert.equal(accepted.kind, "accepted");
  if (accepted.kind !== "accepted") assert.fail("The actual producer must accept its captured source job.");
  const task = accepted.task;
  const deadline = Date.now() + 8000;
  let status = await task.read();
  while (["prepared", "running"].includes(status.phase) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10)); status = await task.read();
  }
  assert.equal(status.phase, "awaiting-receiver"); assert.equal(status.receivedBytes, selected.source.totalBytes);
  assert.equal((await task.cancel()).cancelled, false);
  await owner.observeReceipt(status.receipt);
  const acknowledged = await task.acknowledge("receiver-observed");
  assert.equal((await task.acknowledge("receiver-observed")).phase, "acknowledged");
  assert.equal(acknowledged.phase, "acknowledged"); await owner.confirmSenderCleanup();
  await owner.consume(async snapshot => {
    assert.ok((await readFile(path.join(snapshot, "config.json"))).length > 0);
    assert.equal((await lstat(path.join(snapshot, "model.safetensors"))).nlink, 1);
  });
  await owner.retire();
  const settled = await task.acknowledge("receiver-settled");
  assert.equal(settled.phase, "released"); assert.equal(owner.cleanupPending, false);
  assert.deepEqual(await readdir(path.join(cacheRoot, ".aisb-model-source-transfers")), []);
});

test("forged receipt and changed bytes cannot authorize receiver observation or consumption", async t => {
  for (const change of ["receipt", "bytes", "third-link", "foreign-file", "foreign-root-child"]) {
    const f = await fixture(t), receipt = await f.produce();
    if (change === "receipt") receipt.recipient_witness = "sha256:" + "f".repeat(64);
    if (change === "bytes") await writeFile(path.join(f.snapshot, "config.json"), Buffer.alloc(data["config.json"]!.length, 65));
    if (change === "third-link") await link(path.join(f.snapshot, "config.json"), path.join(f.base, "third-link"));
    if (change === "foreign-file") await writeFile(path.join(f.snapshot, "foreign"), "test marker");
    if (change === "foreign-root-child") await writeFile(path.join(f.root, "foreign"), "test marker");
    await assert.rejects(f.owner.observeReceipt(receipt)); assert.equal(f.owner.phase, "uncertain");
    await assert.rejects(f.owner.consume(async () => assert.fail("No consumer")));
    assert.ok((await readdir(f.snapshot)).includes("model.safetensors"));
  }
});

test("an ACK label cannot replace actual sender cleanup and link-count proof", async t => {
  const f = await fixture(t), receipt = await f.produce(); await f.owner.observeReceipt(receipt);
  await assert.rejects(f.owner.confirmSenderCleanup());
  assert.equal(f.owner.phase, "uncertain"); assert.equal((await lstat(path.join(f.snapshot, "config.json"))).nlink, 2);
  assert.ok((await readdir(f.sourceFiles)).length > 0);
});

test("same approved bytes at a foreign inode cannot replace the observed ownership witness", async t => {
  for (const phase of ["observed", "acknowledged", "consumed"]) {
    const f = await fixture(t), receipt = await f.produce(); await f.owner.observeReceipt(receipt); await f.senderClean();
    if (phase !== "observed") await f.owner.confirmSenderCleanup();
    if (phase === "consumed") await f.owner.consume(async () => undefined);
    const target = path.join(f.snapshot, "config.json"), original = await lstat(target, {bigint: true});
    const replacement = path.join(f.base, "same-bytes-replacement"); await writeFile(replacement, data["config.json"]!);
    await fs.rename(replacement, target);
    assert.notEqual((await lstat(target, {bigint: true})).ino, original.ino);
    let effects = 0;
    const removed = t.mock.method(fs, "unlink", async () => {effects++; assert.fail("No replacement unlink");});
    syncBuiltinESMExports();
    try {
      if (phase === "observed") await assert.rejects(f.owner.confirmSenderCleanup());
      if (phase === "acknowledged") await assert.rejects(f.owner.consume(async () => {effects++;}));
      if (phase === "consumed") await assert.rejects(f.owner.retire());
      assert.equal(effects, 0); assert.equal(f.owner.phase, "uncertain");
    } finally {removed.mock.restore(); syncBuiltinESMExports();}
    assert.deepEqual(await readFile(target), data["config.json"]!);
  }
});

test("held consumer retains files and forbids competing consumption or retirement", async t => {
  const f = await fixture(t); await f.ready();
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const consuming = f.owner.consume(async () => {calls++; entered(); await held; return 1;});
  await started;
  try {
    await assert.rejects(f.owner.consume(async () => {calls++;})); await assert.rejects(f.owner.retire());
    assert.ok((await readdir(f.snapshot)).length > 0); assert.equal(f.owner.cleanupPending, true);
  } finally {release();}
  assert.equal(await consuming, 1); assert.equal(calls, 1); await f.owner.retire();
});

test("consumer failure preserves receiver bytes and never reissues storage", async t => {
  const f = await fixture(t); await f.ready(); let calls = 0;
  await assert.rejects(f.owner.consume(async () => {calls++; throw new Error("synthetic private failure");}), /temporary model receiver/);
  await assert.rejects(f.owner.consume(async () => {calls++;})); await assert.rejects(f.owner.retire());
  assert.equal(calls, 1); assert.ok((await readdir(f.snapshot)).length > 0);
});

test("business denial prevents new consumer effects while cleanup after successful consumption stays host-owned", async t => {
  const denied = await fixture(t); await denied.ready(); denied.denyBusiness();
  await assert.rejects(denied.owner.consume(async () => assert.fail("Denied business effect")));
  const completed = await fixture(t); await completed.ready(); await completed.owner.consume(async () => undefined);
  completed.denyBusiness(); await completed.owner.retire(); assert.equal(completed.owner.phase, "settled");
});

test("withdrawal during metadata wait prevents later receiver creation", async t => {
  const f = await fixture(t); await f.owner.retireUnissued();
  let captured: ModelSourceRecipient | undefined, live = true, creates = 0;
  const real = fs.lstat, actualMkdir = fs.mkdir;
  const stats = t.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
    const result = await real(...args); live = false; return result;
  });
  const creation = t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {creates++; return actualMkdir(...args);});
  syncBuiltinESMExports();
  try {
    await assert.rejects(prepareModelSourceRecipient({...f.options, isCurrent: () => live, captureCustodian: owner => {captured = owner;}}));
    assert.equal(creates, 0); assert.equal(captured?.phase, "uncertain");
  } finally {stats.mock.restore(); creation.mock.restore(); syncBuiltinESMExports();}
});

test("unknown unlink acknowledgement retains remaining files and cannot retry", async t => {
  const f = await fixture(t); await f.ready(); await f.owner.consume(async () => undefined);
  const actual = fs.unlink; let calls = 0;
  const remove = t.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
    calls++; await actual(...args); throw new Error("synthetic lost unlink reply");
  }); syncBuiltinESMExports();
  try {
    await assert.rejects(f.owner.retire()); await assert.rejects(f.owner.retire());
    assert.equal(calls, 1); assert.equal(f.owner.phase, "uncertain"); assert.equal(f.owner.cleanupPending, true);
  } finally {remove.mock.restore(); syncBuiltinESMExports();}
  assert.equal((await readdir(f.snapshot)).length, 2);
});

test("unknown close acknowledgement retains custody without retrying the handle", async t => {
  const f = await fixture(t), receipt = await f.produce(); const actual = fs.open; let closes = 0;
  const opening = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actual(...args), close = handle.close.bind(handle);
    t.mock.method(handle, "close", async () => {closes++; await close(); throw new Error("synthetic lost close reply");});
    return handle;
  }); syncBuiltinESMExports();
  try {
    await assert.rejects(f.owner.observeReceipt(receipt)); await assert.rejects(f.owner.observeReceipt(receipt));
    assert.equal(closes, 1); assert.equal(f.owner.phase, "uncertain");
  } finally {opening.mock.restore(); syncBuiltinESMExports();}
  assert.equal((await readdir(f.snapshot)).length, 3);
});

test("strict manifest expectation rejects executable nested data without invoking it", async t => {
  const f = await fixture(t); await f.owner.retireUnissued(); let traps = 0, hooks = 0, captures = 0;
  const proxied = new Proxy({}, {getPrototypeOf() {traps++; return Object.prototype;}});
  const hooked = {...manifest(), toJSON() {hooks++; return manifest();}};
  for (const selected of [proxied, hooked]) await assert.rejects(prepareModelSourceRecipient({...f.options, manifest: selected as never,
    captureCustodian() {captures++;}}));
  assert.equal(traps, 0); assert.equal(hooks, 0); assert.equal(captures, 0);
});

test("bad MAC, replayed challenge and proof-file replacement cannot grant a prepared transfer", async t => {
  for (const failure of ["mac", "challenge", "marker"]) {
    const f = await fixture(t); await f.owner.retireUnissued();
    let captured: ModelSourceRecipient | undefined;
    const original = f.options.identityProbe;
    const probe: ModelSourceIdentityProbe = {...original, async inspect(input) {
      const envelope = {...structuredClone(await original.inspect(input))};
      if (failure === "mac") envelope.mac = "f".repeat(64);
      if (failure === "challenge") (envelope.proof as unknown as {challenge: string}).challenge = "a".repeat(64);
      if (failure === "marker") {
        const marker = path.join(f.cacheRoot, ".aisb-model-source-transfers", input.acquisitionId + ".proof");
        const replacement = path.join(f.base, "replacement-proof"); await writeFile(replacement, await readFile(marker));
        await fs.rename(replacement, marker);
      }
      return envelope;
    }};
    await assert.rejects(prepareModelSourceRecipient({...f.options, identityProbe: probe, captureCustodian: owner => {captured = owner;}}));
    assert.equal(captured?.phase, "uncertain"); assert.equal(captured?.cleanupPending, true);
    assert.throws(() => captured!.markIssued()); assert.throws(() => captured!.transfer);
  }
});

test("an outstanding read-only probe retains its proof and cannot race retirement or late worker withdrawal", async t => {
  const f = await fixture(t); await f.owner.retireUnissued();
  let captured: ModelSourceRecipient | undefined, entered!: () => void, release!: () => void, current = true;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const original = f.options.identityProbe;
  const probe: ModelSourceIdentityProbe = {...original, async inspect(input) {
    const envelope = await original.inspect(input); entered(); await held; return envelope;
  }};
  const preparing = prepareModelSourceRecipient({...f.options, identityProbe: probe, isCurrent: () => current,
    captureCustodian: owner => {captured = owner;}});
  await started;
  try {
    assert.equal(captured?.phase, "preparing"); await assert.rejects(captured!.retireUnissued());
    assert.throws(() => captured!.markIssued());
    assert.ok((await readdir(path.join(f.cacheRoot, ".aisb-model-source-transfers"))).some(name => name.endsWith(".proof")));
    current = false;
  } finally {release();}
  await assert.rejects(preparing); assert.equal(captured?.phase, "uncertain");
});
