/** Explicit offline feature qualification. Intentionally outside *.test discovery. */
import assert from "node:assert/strict";
import test from "node:test";
import {createHash, randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import path from "node:path";
import {fixture} from "../../../../modules/hosts/shared/composition/tests/headless-model-training-fixture";
import {createPythonRuntimeAdapterFoundation} from "../../../../modules/adapters/runtime/python/createPythonRuntimePort";
import {createBoundedLocalTrainingStartupProfile} from "../../../../modules/adapters/runtime/python/supervisor/createPythonRuntimeSupervisor";
import {ORIGINAL_TRAINING_CAPABILITY} from "../../../../modules/adapters/runtime/python/client/approvedTrainingTaskSession";
import {createFilesystemLocalTrainingModelCopyStorage} from "../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemLocalTrainingModelCopyStorage";
import {createFilesystemLocalTrainingResultPublication} from "../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemTrainingResultFileByteStorageAdapter";
import type {TrainingResultFileIoRetirement} from "../../../../modules/application/ports/model";
import {createOrganizationId} from "../../../../modules/contracts/organization";

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

test("Core approved bounded Tiny fine-tuning keeps original progress, history and private candidate", {timeout: 800000}, async t => {
  assert.equal(process.platform, "win32"); assert.equal(process.arch, "x64");
  const python = await plainPath(process.env.ASB_HEADLESS_TRAINING_TEST_PYTHON, false);
  assert.equal(await digestFile(python, MiB), pythonSha);
  const model = await plainPath(process.env.ASB_HEADLESS_TRAINING_TEST_INPUT, true);
  assert.deepEqual((await readdir(model)).sort(), [...Object.keys(inputFiles), "input.json"].sort());
  for (const [name, [size, digest]] of Object.entries(inputFiles)) assert.equal(await digestFile(path.join(model, name), MiB, size), digest);
  const evidenceParent = await plainPath(path.resolve(".local-codex"), true), evidenceDirectory = path.join(evidenceParent, "headless-training-feature");
  await mkdir(evidenceDirectory, {recursive: true}); await plainPath(evidenceDirectory, true);
  // At most 64 small append-only diagnostic records; never replace old evidence.
  assert.ok((await readdir(evidenceDirectory)).length < 64, "Archive bounded test diagnostics before another run.");
  const evidenceFile = path.join(evidenceDirectory, randomBytes(16).toString("hex") + ".json");
  const parent = await plainPath(path.resolve(".local-codex/t"), true), root = await realpath(await mkdtemp(path.join(parent, "bt-")));
  const identity = await lstat(root, {bigint: true}), copyRoot = path.join(root, "copy"), outputRoot = path.join(root, "output"), selected = path.join(root, "selected");
  let hostCurrent = true, retired = false, sourceFactories = 0, outputFactories = 0, phase = "configured", startup = "not-started";
  const copies: ReturnType<typeof createFilesystemLocalTrainingModelCopyStorage>[] = [];
  const publications: ReturnType<typeof createFilesystemLocalTrainingResultPublication>[] = [];
  const ioOwners: TrainingResultFileIoRetirement[] = [];
  let runtime: ReturnType<typeof createPythonRuntimeAdapterFoundation> | undefined;
  let applicationCleanup: (() => Promise<void>) | undefined;
  function closed() {return retired && copies.every(owner => {const value = owner.inspect(); return value.pendingOperations === 0 &&
    value.sourceHandlesOpen === 0 && value.destinationIoClosed && value.phase !== "unconfirmed";}) &&
    ioOwners.every(owner => {const value = owner.inspect(); return value.phase === "closed" && value.pendingOperations === 0 && !value.publicationUnconfirmed;}) &&
    publications.every(owner => {const value = owner.originalOwner.inspectVerification(); return value.phase === "idle" && value.pendingOperations === 0 && value.openFiles === 0;});}
  t.after(async () => {
    if (!retired) {await runtime?.supervisor.stop(); retired = true;}
    hostCurrent = false;
    if (!closed()) throw Error("Owned training IO remains unconfirmed; fresh fixture retained.");
    // The application owns its nested child and restores process TEMP first.
    // The outer owner must never remove that child ahead of its identity check.
    await applicationCleanup?.();
    const current = await lstat(root, {bigint: true}); assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino); assert.equal(await realpath(root), root); assert.equal(path.dirname(root), parent);
    await rm(root, {recursive: true});
  });
  await mkdir(copyRoot); await mkdir(outputRoot); await mkdir(selected);
  // The acquisition record is not a model file. Prepare only the six exact
  // safe-format files in fresh test storage; never alter the original cache.
  for (const [name, [size, digest]] of Object.entries(inputFiles)) {
    await copyFile(path.join(model, name), path.join(selected, name), constants.COPYFILE_EXCL);
    assert.equal(await digestFile(path.join(selected, name), MiB, size), digest);
  }
  const port = await unusedPort(), worker = path.resolve("modules/adapters/runtime/python/worker");
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA"])
    if (process.env[key]) environment[key] = process.env[key];
  Object.assign(environment, {TEMP: root, TMP: root, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1",
    PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: String(port), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1", HF_HOME: path.join(root, "hf"), PIP_NO_INDEX: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1",
    CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1"});
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:" + port},
    supervisor: {command: python, args: ["main.py"], cwd: worker, env: environment, startupTimeoutMs: 60000,
      requiredCapabilities: [ORIGINAL_TRAINING_CAPABILITY],
      onEvent(event) {if (["spawned", "owned-ready", "health-ready", "startup-timeout", "process-exit", "process-error", "stop-complete"].includes(event.type)) startup = event.type;},
      // Exact executable/input hashes are checked above; installed-only never
      // calls a dependency installer. Startup itself probes actual capabilities.
      verifyRuntimeEnvironment: async context => context.command === python && await digestFile(python, MiB) === pythonSha,
      nativeWorkerResourceProfile: {schema: "windows-original-worker-job-v1", profileId: "headless-tiny-feature-v1",
        processMemoryBytes: 2 * GiB, jobMemoryBytes: 4 * GiB, maximumActiveProcesses: 32, maximumDurationMs: 690000, observationMs: 5000}}});
  runtime = foundation;
  foundation.bindHostAdmission(() => {assert.equal(hostCurrent, true);});
  const startupProfile = createBoundedLocalTrainingStartupProfile({profileId: "bounded-local-headless-tiny-feature-v1", stagingRoot: root,
    maximumDurationSeconds: 600, maximumModelBytes: MiB, maximumOutputBytes: 4 * MiB, minimumFreeBytes: 128 * MiB});
  const originalPort = foundation.createBoundedLocalTrainingPort!({startupProfile,
    observation: {allowedRootDirectories: [selected], maximumTotalBytes: MiB, maximumDurationMs: 10000, bufferBytes: 65536},
    createModelCopy(input) {
      sourceFactories++;
      const owner = createFilesystemLocalTrainingModelCopyStorage({rootDirectory: copyRoot, allowedSourceRoots: [selected], source: input.source,
        context: input.context, control: input.control, limits: {maximumFiles: 9, maximumFileBytes: MiB, maximumTotalBytes: MiB,
          maximumDurationMs: 10000, minimumFreeBytes: 128 * MiB, bufferBytes: 65536}});
      copies.push(owner); return owner;
    }, createOutputStorage(original) {
      outputFactories++; const publicationId = randomBytes(16).toString("hex"), context = Object.freeze({requestId: original.definition.requestId,
        workspaceId: original.definition.workspaceId, organizationId: createOrganizationId(original.definition.owner.organizationId), principalId: original.definition.owner.principalId});
      const limits = {maximumFiles: 32, maximumFileBytes: 4 * MiB, maximumTotalBytes: 4 * MiB, minimumFreeBytes: 128 * MiB, maximumDurationMs: 600000};
      const owner = createFilesystemLocalTrainingResultPublication({rootDirectory: outputRoot, publicationId, context, limits,
        control: {assertCurrent: () => original.assertCurrent(), assertAllowed: () => original.assertAllowed()}}); publications.push(owner);
      const storage = Object.freeze({...owner.storage, captureIoRetirement(...args: Parameters<NonNullable<typeof owner.storage.captureIoRetirement>>) {
        const captured = owner.storage.captureIoRetirement!(...args); ioOwners.push(captured); return captured;
      }});
      return {storage, context, publicationId, maximumFiles: limits.maximumFiles, maximumFileBytes: limits.maximumFileBytes,
        maximumTotalBytes: limits.maximumTotalBytes, maximumDurationMs: limits.maximumDurationMs,
        retainedFiles: {verifyFinalizedFiles: (...args) => owner.originalOwner.verifyFinalizedFiles(...args),
          inspectVerification: () => owner.originalOwner.inspectVerification()}};
    }});
  const f = await fixture(t, "Core", {deferred: true, runtime: {modelDirectory: selected, port: originalPort, temporaryRoot: root,
    registerCleanup(cleanup) {assert.equal(applicationCleanup, undefined); applicationCleanup = cleanup;}, beforeCleanup: async () => closed()}});
  try {
    phase = "approved-start";
    const started = await f.run(); assert.equal(started.result.ok, true, "Original approved training did not start."); assert.ok(f.retained);
    const control = {isCurrent: () => true, stillAllowed: async () => true};
    let result = await f.retained.task.read(control), observations = 0, progressObservations = 0;
    const observe = () => {observations++; if (result.progress && (typeof result.progress.stage === "string" && result.progress.stage.length > 0 ||
      typeof result.progress.batch === "number" || typeof result.progress.epoch === "number")) progressObservations++;};
    observe(); phase = "training";
    const deadline = Date.now() + 600000;
    while (["queued", "running"].includes(result.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200)); result = await f.retained.task.read(control); observe();
    }
    assert.equal(result.status, "succeeded", "Bounded Tiny training did not succeed.");
    assert.ok(progressObservations > 0, "No actual training progress was observed."); assert.equal(sourceFactories, 1); assert.equal(outputFactories, 1);
    assert.ok(result.checkpoints && result.checkpoints.length > 0, "The requested one-step checkpoint was not recorded.");
    phase = "current-candidate";
    const completion = await f.retained.task.reviewCompletion!(control); assert.equal(completion.kind, "ready");
    const candidate = await f.retained.task.reviewCandidate!(control); assert.equal(candidate.kind, "ready");
    if (candidate.kind === "ready") {
      assert.equal(candidate.history.requestId, f.retained.task.requestId); assert.ok(candidate.execution);
      assert.equal(candidate.execution.runId, result.generatedModelCandidate?.generatedFromRunId); assert.ok(candidate.execution.durationMs >= 0);
      assert.ok(candidate.execution.hardware.devices.includes("cpu")); assert.ok(candidate.retainedFiles.files.length > 0);
      assert.ok(candidate.retainedFiles.files.some(row => row.role === "checkpoint"));
      assert.ok(candidate.retainedFiles.files.some(row => row.role === "candidate"));
      assert.equal(candidate.history.provenance.datasetId, f.version.datasetId); assert.equal(candidate.history.provenance.versionDigest, f.version.versionDigest);
      assert.equal(candidate.history.registration, "requires-separate-approval"); assert.equal(candidate.history.comparison.state, "not-recorded");
      assert.equal(candidate.history.verification.outputQuality, "not-evaluated");
      t.diagnostic(JSON.stringify({schema: "bounded-training-feature-observation-v1", observations, progressObservations,
        checkpoints: result.checkpoints.length, outputFiles: candidate.retainedFiles.files.length, durationMs: candidate.execution.durationMs,
        device: "cpu", quality: "not-tested", registration: "requires-separate-approval"}));
    }
    // The fixture Model registry rejects any automatic generated-Model write.
    await f.run(); assert.equal(sourceFactories, 1); assert.equal(outputFactories, 1);
    for (const [name, [size, digest]] of Object.entries(inputFiles)) assert.equal(await digestFile(path.join(model, name), MiB, size), digest);
    phase = "complete";
  } catch (error) {
    t.diagnostic(JSON.stringify({schema: "bounded-training-feature-failure-v1", phase, startup, sourceFactories, outputFactories})); throw error;
  } finally {
    try {await foundation.supervisor.stop(); retired = true;} finally {
      let ownerClosureConfirmed = false; try {ownerClosureConfirmed = closed();} catch { /* Preserve unknown closure. */ }
      const evidence = {schema: "bounded-training-feature-diagnostic-v1", phase, startup, sourceFactories, outputFactories,
        workerRetirementConfirmed: retired, ownerClosureConfirmed, modelQualityTested: false,
        interpretation: "diagnostic-only-not-qualification"};
      const bytes = JSON.stringify(evidence) + "\n"; assert.ok(Buffer.byteLength(bytes) <= 2048);
      await writeFile(evidenceFile, bytes, {flag: "wx"});
    }
  }
  assert.equal(closed(), true, "Original worker and IO did not retire.");
});
