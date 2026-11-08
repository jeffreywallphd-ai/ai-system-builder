import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProvidedRuntimePreparationObserver, createProvidedRuntimePreparationPreparer,
} from "../visual-composer/provided-runtime-preparation-observer";
import type { PythonRuntimePreparationDiagnostic } from "../../../../modules/adapters/runtime/python";

const revision = "source." + "a".repeat(64);
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provided-preparation-"));
  const identity = fs.lstatSync(root, { bigint: true });
  const runtimeRoot = path.join(root, "artifacts/qualification/visual-composer/d", "a".repeat(16), "thin-runtime");
  const worker = path.join(root, "out/ai-system-builder-win32-x64/resources/worker");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  t.after(() => {
    t.mock.restoreAll();
    const current = fs.lstatSync(root, { bigint: true });
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("provided-preparation-"));
    assert.ok(!current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { repoRoot: root, runtimeRoot, sequence: 1 as const, sourceRevision: revision };
  const python = path.join(root, "python.exe");
  return { root, runtimeRoot, worker, python, options };
}
function event(operation: "context" | "worker" = "context", sequence = 1, phase: "entered" | "returned" | "threw" = "entered"): Readonly<PythonRuntimePreparationDiagnostic> {
  return Object.freeze({ timestamp: "2026-11-07T00:00:00.000Z", level: "debug", verbosity: "verbose",
    event: "runtime.python.dependencies.stage", component: "python-runtime-dependencies", operation,
    stage: operation === "context" ? "probe-context-dependencies" : "probe-torch",
    message: "Dependency command stage observed.", data: Object.freeze({ sequence, phase }),
  });
}
function fixedContext(f: ReturnType<typeof fixture>, cache: string) {
  return { command: f.python, args: ["-I", "-B", "../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py"], cwd: f.worker,
    env: { HF_HUB_CACHE: cache, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "dataset-profile", VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION: revision,
      PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43173", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1", PRIVATE_TOKEN: "synthetic-never-journal-this" },
  };
}

test("records finite controlled stages with explicit scope and no readiness or private payload", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  journal.observe(event()); journal.observe(event("context", 1, "returned"));
  journal.observe(event("worker")); journal.observe(event("worker", 1, "returned"));
  const files = fs.readdirSync(journal.cache);
  assert.equal(files.length, 4);
  for (const name of files) {
    assert.match(name, /^qualification-preparation-(context|worker)-01-(entered|returned)\.json$/);
    const raw = fs.readFileSync(path.join(journal.cache, name));
    assert.ok(raw.length <= 1024);
    const value = JSON.parse(raw.toString());
    assert.equal(value.sourceRevision, revision);
    assert.equal(value.nativeAuthority, false);
    assert.equal(value.composition, "controlled-real-adapter-preparation");
    assert.equal(value.observation.outcome, undefined);
    assert.equal(value.observation.error, undefined);
    assert.ok(!raw.includes(Buffer.from(f.root)));
  }
  assert.equal(journal.status().available, true);
  assert.equal(journal.status().records, 4);
});

test("never adopts an existing cache or changes its bytes", t => {
  const f = fixture(t);
  const cache = path.join(f.runtimeRoot, "provided-server-cache-1");
  fs.mkdirSync(cache);
  const marker = path.join(cache, "owned-test-marker");
  fs.writeFileSync(marker, "unchanged-synthetic-bytes");
  assert.throws(() => createProvidedRuntimePreparationObserver(f.options), /^Error: Qualification dependency observation is unavailable\.$/);
  assert.equal(fs.readFileSync(marker, "utf8"), "unchanged-synthetic-bytes");
  assert.deepEqual(fs.readdirSync(cache), ["owned-test-marker"]);
});

test("rejects invalid source, root, sequence and production mode before cache creation", t => {
  const f = fixture(t);
  for (const options of [{ ...f.options, sourceRevision: "private-token" }, { ...f.options, sequence: 3 }, { ...f.options, runtimeRoot: f.root }, { ...f.options, repoRoot: "relative" }]) {
    assert.throws(() => createProvidedRuntimePreparationObserver(options as any));
  }
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => createProvidedRuntimePreparationObserver(f.options));
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  assert.ok(!fs.existsSync(path.join(f.runtimeRoot, "provided-server-cache-1")));
});

test("denies a replaced directory and a junction ancestor", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  fs.renameSync(journal.cache, journal.cache + "-owned-fixture-moved");
  fs.mkdirSync(journal.cache);
  assert.throws(() => journal.observe(event()));
  assert.equal(journal.status().available, false);
  assert.deepEqual(fs.readdirSync(journal.cache), []);
  const secondRoot = path.join(f.root, "artifacts/qualification/visual-composer/d", "b".repeat(16), "thin-runtime");
  const target = path.join(f.root, "owned-junction-target");
  fs.mkdirSync(path.dirname(secondRoot)); fs.mkdirSync(target);
  fs.symlinkSync(target, secondRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createProvidedRuntimePreparationObserver({ ...f.options, runtimeRoot: secondRoot }));
  assert.deepEqual(fs.readdirSync(target), []);
});

test("does not overwrite a hard-linked destination and fences later writes", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  const original = path.join(f.root, "owned-hardlink-target");
  fs.writeFileSync(original, "synthetic-unchanged");
  fs.linkSync(original, path.join(journal.cache, "qualification-preparation-context-01-entered.json"));
  assert.throws(() => journal.observe(event()));
  assert.throws(() => journal.observe(event("context", 2)));
  assert.equal(fs.readFileSync(original, "utf8"), "synthetic-unchanged");
  assert.equal(journal.status().records, 0);
  assert.equal(fs.readdirSync(journal.cache).length, 1);
});

test("rejects unknown data, late return, duplicate entry and oversized input without a new record", t => {
  for (const invalid of [{ ...event(), token: "private" }, { ...event(), message: "x".repeat(5000) }, event("context", 1, "returned"), event("worker")]) {
    const f = fixture(t);
    const journal = createProvidedRuntimePreparationObserver(f.options);
    assert.throws(() => journal.observe(invalid as any));
    assert.equal(journal.status().available, false);
    assert.deepEqual(fs.readdirSync(journal.cache), []);
  }
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  journal.observe(event());
  assert.throws(() => journal.observe(event()));
  assert.equal(journal.status().records, 1);
});

test("retains a partial write, closes the owned descriptor once, and never retries the record", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  const write = fs.writeSync;
  let calls = 0;
  t.mock.method(fs, "writeSync", ((descriptor: number, body: Buffer) => {
    calls++;
    write(descriptor, body, 0, 5, null);
    throw new Error("synthetic-private-write-failure");
  }) as any);
  assert.throws(() => journal.observe(event()), /^Error: Qualification dependency observation is unavailable\.$/);
  t.mock.restoreAll();
  assert.throws(() => journal.observe(event()));
  assert.equal(calls, 1);
  assert.equal(journal.status().records, 0);
  assert.equal(journal.status().closeAcknowledgementMissing, false);
  const names = fs.readdirSync(journal.cache);
  assert.equal(names.length, 1);
  assert.equal(fs.statSync(path.join(journal.cache, names[0]!)).size, 5);
});

test("refuses a return that changes the entered command stage or backend", t => {
  for (const backendMismatch of [false, true]) {
    const f = fixture(t);
    const journal = createProvidedRuntimePreparationObserver(f.options);
    if (backendMismatch) {
      journal.observe(event()); journal.observe(event("context", 1, "returned"));
      journal.observe({ ...event("worker"), stage: "verify-torch", data: { sequence: 1, phase: "entered", backend: "cpu" } });
      assert.throws(() => journal.observe({ ...event("worker"), stage: "verify-torch", data: { sequence: 1, phase: "returned", backend: "cuda" } }));
    } else {
      journal.observe(event());
      assert.throws(() => journal.observe({ ...event("context", 1, "returned"), stage: "verify-context-dependencies" }));
    }
    assert.equal(journal.status().available, false);
    assert.equal(journal.status().records, backendMismatch ? 3 : 1);
    assert.equal(fs.readdirSync(journal.cache).length, backendMismatch ? 3 : 1);
  }
});

test("retains a lost close acknowledgement without reusing or reclosing its descriptor", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  const close = fs.closeSync;
  let calls = 0;
  t.mock.method(fs, "closeSync", descriptor => { calls++; close(descriptor); throw new Error("synthetic-lost-close-ack"); });
  assert.throws(() => journal.observe(event()));
  assert.equal(journal.status().closeAcknowledgementMissing, true);
  assert.equal(journal.status().records, 0);
  assert.throws(() => journal.observe(event()));
  assert.equal(calls, 1);
  t.mock.restoreAll();
  assert.equal(fs.readdirSync(journal.cache).length, 1);
});

test("uses the exact real-helper interface and rejects mismatched or forged composition before dispatch", async t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  let calls = 0;
  const prepare = createProvidedRuntimePreparationPreparer({ repoRoot: f.root, sourceRevision: revision, pythonExecutable: f.python, journal }, async setup => {
    calls++;
    assert.equal(setup.command, f.python);
    assert.equal(setup.cwd, f.worker);
    assert.equal(setup.env?.PRIVATE_TOKEN, "synthetic-never-journal-this");
    setup.onDiagnosticStage?.(event());
    setup.onDiagnosticStage?.(event("context", 1, "returned"));
  });
  const context = fixedContext(f, journal.cache);
  for (const invalid of [{ ...context, command: "python" }, { ...context, args: ["main.py"] }, { ...context, cwd: f.root }, { ...context, env: { ...context.env, HF_HUB_CACHE: f.root } }, { ...context, env: { ...context.env, HF_HUB_OFFLINE: "0" } }, { ...context, env: { ...context.env, PYTHON_RUNTIME_HOST: "0.0.0.0" } }, { ...context, env: { ...context.env, PYTHON_RUNTIME_PORT: "1023" } }]) {
    await assert.rejects(prepare(invalid));
  }
  assert.equal(calls, 0);
  assert.throws(() => createProvidedRuntimePreparationPreparer({ repoRoot: f.root, sourceRevision: revision, pythonExecutable: f.python, journal: { ...journal } }));
  await prepare(context);
  assert.equal(calls, 1);
  for (const name of fs.readdirSync(journal.cache)) assert.ok(!fs.readFileSync(path.join(journal.cache, name), "utf8").includes("synthetic-never-journal-this"));
});

test("captures each controlled context value once for both admission and dispatch", async t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  let reads = 0, correct = false;
  const context = fixedContext(f, journal.cache);
  Object.defineProperty(context, "command", { get() { return ++reads === 1 ? f.python : "changed-after-validation"; } });
  const prepare = createProvidedRuntimePreparationPreparer({ repoRoot: f.root, sourceRevision: revision, pythonExecutable: f.python, journal }, async setup => { correct = setup.command === f.python; });
  await prepare(context);
  assert.equal(correct, true);
  assert.equal(reads, 1);
});

test("bounds complete journals and refuses an extra command before another write", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  for (const operation of ["context", "worker"] as const) {
    for (let sequence = 1; sequence <= 64; sequence++) {
      journal.observe(event(operation, sequence));
      journal.observe(event(operation, sequence, "returned"));
    }
  }
  assert.equal(journal.status().records, 256);
  assert.ok(journal.status().bytes <= 256 * 1024);
  assert.throws(() => journal.observe(event("worker", 65)));
  assert.equal(fs.readdirSync(journal.cache).length, 256);
});

test("fences reentrant input inspection before either call can write", t => {
  const f = fixture(t);
  const journal = createProvidedRuntimePreparationObserver(f.options);
  const value = new Proxy({ ...event() }, { ownKeys(target) {
    try { journal.observe(event()); } catch { /* Original call must also fail. */ }
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => journal.observe(value));
  assert.equal(journal.status().available, false);
  assert.equal(journal.status().records, 0);
  assert.deepEqual(fs.readdirSync(journal.cache), []);
});
