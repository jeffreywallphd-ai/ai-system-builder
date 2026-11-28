/** Explicit offline inference test, outside ordinary *.test discovery. */
import assert from "node:assert/strict";
import test from "node:test";
import {createHash, randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, statfs, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import path from "node:path";
import {createPythonRuntimeAdapterFoundation} from "../../../../modules/adapters/runtime/python/createPythonRuntimePort";
import {exerciseComposedTextWorkflow} from "../../../../modules/hosts/desktop/composition/tests/headless-text-workflow.fixture";
import {boundedTrainingTempParent, BOUNDED_TRAINING_CPU_ENVIRONMENT} from "./bounded-training-feature-profile";

const GiB = 1024 ** 3, MiB = 1024 ** 2;
// Existing generated, non-download Tiny input, not a quality benchmark.
const inputFiles: Readonly<Record<string, readonly [number, string]>> = {
  "config.json": [709, "765462b5e836b625df446296362da03c198aed7d48e78348c52f5ae774201759"],
  "generation_config.json": [139, "4990c5a029c760527166fd23b4a271b708f4103e65f8d72c7fd82c3e473478db"],
  "model.safetensors": [20296, "7456621de2dc70bc6d15842f06fb4979fdf6f69883d5c8b32b36ca417ca0a8f0"],
  "special_tokens_map.json": [105, "24a2eb7fafa590e021f00c12ba04ce24c08cf42708f302ed2d75651eabd1e1f9"],
  "tokenizer.json": [2322, "09d6a42fb7d65f00830f96a7b196eb3632de4254cf188df91689cd32307aaed1"],
  "tokenizer_config.json": [669, "c21328e6f6657edc1445c8fe0a8816cd98f8f6af9aa913df01b75f6e76ca5f04"],
};
const pythonSha = "1c4e9fbd9259294528031a567cef76b0a45254b66d612cf58de267928d1defbb";
async function digestFile(file: string, maximum: number, exactBytes?: number) {
  const before = await lstat(file, {bigint: true});
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.equal(before.nlink, 1n); assert.ok(before.size > 0n && before.size <= BigInt(maximum));
  if (exactBytes !== undefined) assert.equal(before.size, BigInt(exactBytes));
  const handle = await open(file, "r"), hash = createHash("sha256"), buffer = Buffer.alloc(65536);
  try {
    const opened = await handle.stat({bigint: true}); assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino);
    let total = 0;
    for (;;) {const {bytesRead} = await handle.read(buffer, 0, Math.min(buffer.length, maximum + 1 - total), null);
      if (!bytesRead) break; total += bytesRead; assert.ok(total <= maximum); hash.update(buffer.subarray(0, bytesRead));}
    const after = await handle.stat({bigint: true}), current = await lstat(file, {bigint: true});
    for (const value of [after, current]) for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"] as const)
      assert.equal(value[key], before[key]);
    assert.equal(BigInt(total), before.size); return hash.digest("hex");
  } finally {await handle.close();}
}
async function plainPath(raw: string | undefined, directory: boolean) {
  assert.ok(raw && path.isAbsolute(raw) && !/^[\\/]{2}/.test(raw));
  const resolved = path.resolve(raw); assert.equal(await realpath(resolved), resolved);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, part); const row = await lstat(current);
    assert.ok(!row.isSymbolicLink() && !((row as typeof row & {st_file_attributes?: number}).st_file_attributes! & 0x400));
    assert.ok(current === resolved && !directory ? row.isFile() : row.isDirectory());
  }
  return resolved;
}
async function unusedPort() {
  const server = createServer(); await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return address.port;
}

test("Core approved installed Tiny text inference preserves the exact saved response", {timeout: 240000}, async t => {
  let phase = "preflight", startup = "not-started", retired = false, fixtureClosed = false, ioClosed = true;
  let root: string | undefined, rootIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
  let foundation: ReturnType<typeof createPythonRuntimeAdapterFoundation> | undefined;
  let facts: Awaited<ReturnType<typeof exerciseComposedTextWorkflow>> | undefined;
  let measuredBytes = 0, measuredFiles = 0;
  let hostCurrent = true;
  let closeFixture: (() => Promise<void>) | undefined;
  const evidenceDirectory = path.resolve(".local-codex/headless-text-feature");
  await mkdir(evidenceDirectory, {recursive: true}); await plainPath(evidenceDirectory, true);
  assert.ok((await readdir(evidenceDirectory)).length < 64, "Archive completed bounded diagnostics before another test.");
  const evidenceFile = path.join(evidenceDirectory, randomBytes(16).toString("hex") + ".json");
  const parent = await plainPath(boundedTrainingTempParent(process.env.LOCALAPPDATA), true);
  t.after(async () => {
    let removed = false;
    try {
      await foundation?.supervisor.stop(); retired = true; hostCurrent = false;
      await closeFixture?.();
      if (root && fixtureClosed && ioClosed) {
        const current = await lstat(root);
        assert.ok(current.isDirectory() && !current.isSymbolicLink());
        assert.equal(current.dev, rootIdentity!.dev); assert.equal(current.ino, rootIdentity!.ino);
        assert.equal(await realpath(root), root); assert.equal(path.dirname(root), parent);
        const pending = [root];
        while (pending.length) {
          const directory = pending.pop()!;
          for (const name of await readdir(directory)) {
            const file = path.join(directory, name), value = await lstat(file);
            assert.ok(!value.isSymbolicLink()); assert.equal(await realpath(file), file);
            measuredFiles++; assert.ok(measuredFiles <= 256);
            if (value.isDirectory()) pending.push(file);
            else {assert.ok(value.isFile() && value.nlink === 1); measuredBytes += value.size; assert.ok(measuredBytes <= 4 * MiB);}
          }
        }
        await rm(root, {recursive: true}); removed = true;
      }
    } finally {
      const record = {schema: "bounded-text-feature-diagnostic-v1", phase, startup,
        workerRetirementConfirmed: retired, applicationFixtureClosed: fixtureClosed,
        originalIoClosed: ioClosed, rootRemoved: removed, modelQualityTested: false,
        externalDownloads: 0, imageModels: 0, measuredBytes, measuredFiles, facts: facts ?? null};
      const encoded = JSON.stringify(record) + "\n";
      assert.ok(Buffer.byteLength(encoded) <= 4096);
      await writeFile(evidenceFile, encoded, {flag: "wx"});
    }
  });
  assert.equal(process.platform, "win32"); assert.equal(process.arch, "x64");
  const python = await plainPath(process.env.ASB_HEADLESS_TRAINING_TEST_PYTHON, false);
  assert.equal(await digestFile(python, MiB), pythonSha);
  const model = await plainPath(process.env.ASB_HEADLESS_TRAINING_TEST_INPUT, true);
  assert.deepEqual((await readdir(model)).sort(), [...Object.keys(inputFiles), "input.json"].sort());
  for (const [name, [size, digest]] of Object.entries(inputFiles)) assert.equal(await digestFile(path.join(model, name), MiB, size), digest);
  phase = "input-verified";
  const capacity = await statfs(parent, {bigint: true});
  assert.ok(capacity.bavail * capacity.bsize >= BigInt(128 * MiB + 2 * MiB));
  assert.ok(Object.values(inputFiles).reduce((sum, entry) => sum + entry[0], 0) <= MiB);
  root = await realpath(await mkdtemp(path.join(parent, "tx-"))); rootIdentity = await lstat(root);
  const home = path.join(root, "hf"), hub = path.join(home, "hub");
  const repository = path.join(hub, "models--qualification--controlled-text");
  // An explicitly generated synthetic cache, never a claimed supplier revision.
  const revision = "a".repeat(40), snapshot = path.join(repository, "snapshots", revision);
  await mkdir(snapshot, {recursive: true}); await mkdir(path.join(repository, "refs"));
  try {
    for (const [name, [size, digest]] of Object.entries(inputFiles)) {
      await copyFile(path.join(model, name), path.join(snapshot, name), constants.COPYFILE_EXCL);
      assert.equal(await digestFile(path.join(snapshot, name), MiB, size), digest);
    }
    await writeFile(path.join(repository, "refs", "main"), revision, {flag: "wx"});
  } catch (error) {ioClosed = false; throw error;}
  phase = "cache-verified";
  const port = await unusedPort(), worker = path.resolve("modules/adapters/runtime/python/worker");
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA"])
    if (process.env[key]) environment[key] = process.env[key];
  Object.assign(environment, {TEMP: root, TMP: root, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1",
    PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: String(port), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1", HF_HOME: home, HUGGINGFACE_HUB_CACHE: hub, PIP_NO_INDEX: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1",
    ...BOUNDED_TRAINING_CPU_ENVIRONMENT});
  foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:" + port},
    supervisor: {command: python, args: ["main.py"], cwd: worker, env: environment, startupTimeoutMs: 60000,
      requiredCapabilities: ["conversation-text-generation"],
      onEvent(event) {if (["spawned", "owned-ready", "health-ready", "startup-timeout", "process-exit", "process-error", "stop-complete"].includes(event.type)) startup = event.type;},
      verifyRuntimeEnvironment: async context => context.command === python && await digestFile(python, MiB) === pythonSha,
      nativeWorkerResourceProfile: {schema: "windows-original-worker-job-v1", profileId: "headless-tiny-text-feature-v1",
        processMemoryBytes: 2 * GiB, jobMemoryBytes: 4 * GiB, maximumActiveProcesses: 32, maximumDurationMs: 690000, observationMs: 5000}}});
  foundation.bindHostAdmission(() => {assert.equal(hostCurrent, true);});
  assert.ok(foundation.supervisor.startWithoutInstalling);
  phase = "startup";
  await foundation.supervisor.startWithoutInstalling({assertCurrent() {assert.equal(hostCurrent, true);},
    async assertAllowed() {assert.equal(hostCurrent, true);}});
  phase = "approved-text-turn";
  facts = await exerciseComposedTextWorkflow(t, "Core", {runtime: foundation.runtimePort, modelDirectory: snapshot,
    temporaryRoot: root, onCleanup() {fixtureClosed = true;},
    registerCleanup(cleanup) {assert.equal(closeFixture, undefined); closeFixture = cleanup;}});
  assert.equal(facts.starts, 1); assert.ok(facts.responseCharacters > 0 && facts.responseCharacters <= 8000);
  assert.equal(facts.associationChecks, 4);
  phase = "response-verified";
});
