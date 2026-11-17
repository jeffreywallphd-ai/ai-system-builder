import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fileOperations from "node:fs/promises";
import { access, readFile, realpath } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { mock, test } from "node:test";
import {
  DATASET_PREPARATION_OCR_CAPABILITY,
  DATASET_PREPARATION_OCR_MAX_SOURCE_BYTES,
  createDatasetPreparationAdvancedConfigForMethod,
  createDatasetPreparationExecutionPlan,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationSourceCapability,
} from "../../../contracts/runtime";
import { createSha256DatasetVersionHasher } from "../../../adapters/storage/dataset-version";
import { composeDesktopDatasetPreparationFeature } from "../../../hosts/desktop/composition/composeDesktopDatasetPreparationFeature";
import { createDefaultDatasetQualityPolicyProvider } from "../../services/dataset-preparation";
import { OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";

const context = { workspaceId: "workspace-a" };
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

function command(ids = ["pdf-a"]): any {
  const pdf = resolveDatasetPreparationSourceCapability({ mediaType: "application/pdf" })!;
  const resolution = resolveDatasetPreparationAdaptivePlan({ taskType: "llm-instruction", sources: ids.map(() => pdf) });
  const advanced = createDatasetPreparationAdvancedConfigForMethod("structure-aware")!;
  return {
    sourceArtifactIds: ids,
    preparation: createDatasetPreparationExecutionPlan(resolution, "structure-aware"),
    recipe: { task: { taskType: "llm-instruction", textInputMode: "generate" },
      normalization: { targetFormat: "markdown" },
      generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic-no-model-execution" } } },
    advanced: { ...advanced, content: { ...advanced.content, ocrEnabled: true, ocrLanguage: "en-US" } },
    quality: { policy: { preset: "recommended" }, reviewRequired: true },
    split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" },
  };
}

function fixture(options: any = {}) {
  const original = options.bytes ?? Buffer.from("%PDF-1.7\nSynthetic source bytes; no parser or model is executed here.\n");
  const calls = { bindings: 0, storage: 0, provider: 0, dispatch: 0, power: 0 };
  const dispatched: any[] = [];
  const attempts: any[] = [];
  const observations = { status: 0, cancel: 0 };
  const storageBindings: any = {
    async readArtifactStorageBindings(request: any) {
      calls.bindings++;
      return { ok: true, value: { bindings: options.bindings ?? [{ workspaceId: request.workspaceId,
        artifactId: request.artifactId, role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: request.artifactId } }] } };
    }, async upsertArtifactStorageBinding() { throw new Error("Unexpected localization"); },
    async deleteArtifactStorageBindings() { throw new Error("Unexpected deletion"); },
  };
  const storage: any = {
    async retrieveArtifact() {
      calls.storage++;
      return { ok: true, value: { content: original, descriptor: { mediaType: options.mediaType ?? "application/pdf",
        metadata: { originalName: options.originalName ?? "scan.pdf", ocrSources: { sha256: "forged", fileName: "wrong.pdf" } } } } };
    },
  };
  const runtimeTaskRegistry: any = {
    async startTask(request: any) {
      calls.dispatch++;
      attempts.push(request);
      if (options.throwOnStart) {
        throw new Error(`${request.payload.runtime.runtimeWorkingDirectory} private-map-diagnostic ${JSON.stringify(request.payload.runtime.ocrSources)}`);
      }
      const requestId = request.requestId ?? `task-${calls.dispatch}`;
      dispatched.push({ ...request, requestId });
      return { requestId, status: "queued", ...(options.startAcknowledgement ?? {}) };
    },
    async getTaskStatus(requestId: string) { observations.status++; return { requestId, taskType: "dataset-preparation", workspaceId: context.workspaceId, status: "failed", concurrencyClass: "unknown" }; },
    async cancelTask() { observations.cancel++; throw new Error("Unexpected cancellation"); },
  };
  const taskPowerLifecycle = { async startTask() { calls.power++; }, async completeTask() {} };
  const dependencies: any = { storageBindings, storage, runtimeTaskRegistry, taskPowerLifecycle,
    sourceIntegrityHasher: createSha256DatasetVersionHasher(),
    readWorkerCapabilities: async () => ({ runtimeId: "synthetic-worker", capabilities: [DATASET_PREPARATION_OCR_CAPABILITY] }),
    datasetQualityPolicyProvider: createDefaultDatasetQualityPolicyProvider(),
    artifactRepoStorage: { async retrieveArtifactFromRepo() { calls.provider++; throw new Error("Unexpected provider I/O"); } },
    ...(options.dependencies ?? {}),
  };
  const useCase: PrepareTrainingDatasetFromArtifactsUseCase = options.desktop
    ? composeDesktopDatasetPreparationFeature({ artifacts: { storage, artifactBindings: storageBindings },
        runtime: { runtimeTaskRegistry, taskPowerLifecycle },
        readWorkerCapabilities: dependencies.readWorkerCapabilities,
        getArtifactRemoteFeatures: async () => { calls.provider++; throw new Error("Unexpected lazy provider initialization"); },
        // No document store: independent source hashing must still be composed.
      }).prepareTrainingDatasetUseCase
    : new PrepareTrainingDatasetFromArtifactsUseCase(dependencies);
  return { original, calls, dispatched, attempts, observations, useCase, async close() {
    const parent = await realpath(tmpdir());
    for (const request of dispatched) {
      const root = request.payload.runtime.runtimeWorkingDirectory;
      const resolved = await realpath(root);
      assert.equal(dirname(resolved), parent);
      assert.ok(basename(resolved).startsWith("ai-system-builder-runtime-"));
      const retired = await useCase.readPrepareTrainingDataset(request.requestId, context);
      assert.equal(retired.ok, true, JSON.stringify(retired));
      if (retired.ok) assert.equal(retired.value.status, "failed");
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } };
}

for (const desktop of [false, true]) {
  test(`exact authorized bytes and source map survive real ${desktop ? "desktop composition" : "application"} staging without version storage`, async () => {
    const f = fixture({ desktop, originalName: "../" + "long-private-title".repeat(100) + ".pdf" });
    const expected = Buffer.from(f.original);
    try {
      const result = await f.useCase.startPrepareTrainingDataset(command(["pdf-a", "pdf-\u{1f642}"]), context);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(f.dispatched.length, 1);
      const payload = f.dispatched[0].payload;
      assert.equal(payload.advanced.content.ocrLanguage, "en-US");
      assert.equal(payload.runtime.ocrSources.protocol, "staged-pdf-ocr-v1");
      assert.equal(payload.runtime.ocrSources.sources.length, 2);
      for (const [index, source] of payload.sourceInputs.entries()) {
        const binding = payload.runtime.ocrSources.sources[index];
        assert.deepEqual(binding, { artifactId: source.artifactId,
          fileName: `${String(index + 1).padStart(4, "0")}-source.pdf`, byteLength: expected.length, sha256: digest(expected) });
        assert.equal(source.localPath, join(payload.runtime.runtimeWorkingDirectory, binding.fileName));
        assert.deepEqual(await readFile(source.localPath), expected);
        assert.equal(source.originalName, "../" + "long-private-title".repeat(100) + ".pdf");
      }
      assert.equal(f.calls.provider, 0);
      assert.equal(f.calls.power, 1);
      assert.doesNotMatch(JSON.stringify(result), /long-private-title|[A-Z]:\\|runtimeWorkingDirectory|ocrSources/);
    } finally { await f.close(); }
  });
}

test("awaited catalog work cannot mutate the staged copy, source digest or version-lineage input", async () => {
  const bytes = Buffer.from("%PDF-1.7\nExact authorized synthetic document.\n");
  const expected = Buffer.from(bytes);
  const versionInputs: Buffer[] = [];
  const actual = createSha256DatasetVersionHasher();
  const f = fixture({ bytes, dependencies: {
    artifactCatalog: { async readArtifactCatalogRecord(request: any) {
      await Promise.resolve(); bytes.fill(0x78);
      return { ok: true, value: { record: { workspaceId: context.workspaceId, storageKey: request.storageKey } } };
    } },
    datasetVersioning: { finalizer: {}, hasher: { digest(value: Uint8Array) { versionInputs.push(Buffer.from(value)); return actual.digest(value); } } },
  } });
  try {
    assert.equal((await f.useCase.startPrepareTrainingDataset(command(), context)).ok, true);
    const payload = f.dispatched[0].payload;
    assert.notDeepEqual(bytes, expected);
    assert.deepEqual(await readFile(payload.sourceInputs[0].localPath), expected);
    assert.equal(payload.runtime.ocrSources.sources[0].sha256, digest(expected));
    assert.deepEqual(versionInputs, [expected]);
  } finally { await f.close(); }
});

for (const [name, dependencies] of [
  ["missing hasher", { sourceIntegrityHasher: undefined }],
  ["missing reader", { readWorkerCapabilities: undefined }],
  ["old worker", { readWorkerCapabilities: async () => ({ capabilities: ["prepare-training-dataset"] }) }],
  ["near-match protocol", { readWorkerCapabilities: async () => ({ capabilities: [DATASET_PREPARATION_OCR_CAPABILITY + " "] }) }],
  ["failed reader", { readWorkerCapabilities: async () => { throw new Error("private-runtime-path"); } }],
] as const) {
  test(`OCR denies ${name} before any source or task side effect`, async () => {
    const f = fixture({ dependencies });
    const result = await f.useCase.startPrepareTrainingDataset(command(), context);
    assert.equal(result.ok, false);
    assert.deepEqual(f.calls, { bindings: 0, storage: 0, provider: 0, dispatch: 0, power: 0 });
    assert.doesNotMatch(JSON.stringify(result), /private-runtime-path/);
  });
}

for (const [name, alter] of [
  ["caller runtime map", (c: any) => { c.runtime = { ocrSources: { protocol: "staged-pdf-ocr-v1", sources: [] } }; }],
  ["caller source map", (c: any) => { c.ocrSources = {}; }],
  ["coerced flag", (c: any) => { c.advanced.content.ocrEnabled = "true"; }],
  ["missing language", (c: any) => { delete c.advanced.content.ocrLanguage; }],
  ["implicit language", (c: any) => { c.advanced.content.ocrLanguage = "English"; }],
  ["inactive language", (c: any) => { c.advanced.content.ocrEnabled = false; }],
  ["no explicit method", (c: any) => { delete c.preparation; }],
  ["wrong method", (c: any) => { c.preparation.method = "topic-aware"; }],
  ["wrong plan version", (c: any) => { c.preparation.schemaVersion = "2"; }],
  ["wrong input intent", (c: any) => { c.preparation.inputIntent = "use-existing-dataset"; }],
  ["wrong generation mode", (c: any) => { c.preparation.generationMode = "none"; }],
  ["wrong source kind", (c: any) => { c.preparation.sourceKinds = ["structured"]; }],
  ["duplicate source kind", (c: any) => { c.preparation.sourceKinds = ["document", "document"]; }],
  ["wrong preset", (c: any) => { c.advanced.preset = "topic-aware"; }],
  ["wrong strategy", (c: any) => { c.advanced.content.strategy = "token"; }],
  ["disabled layout", (c: any) => { c.advanced.content.layoutEnabled = false; }],
  ["no normalization", (c: any) => { delete c.recipe.normalization; }],
  ["wrong normalization", (c: any) => { c.recipe.normalization.targetFormat = "html"; }],
  ["control character id", (c: any) => { c.sourceArtifactIds = ["private\nsource"]; }],
  ["unpaired surrogate id", (c: any) => { c.sourceArtifactIds = ["private\ud800source"]; }],
  ["duplicate id", (c: any) => { c.sourceArtifactIds = ["pdf-a", "pdf-a"]; }],
  ["invalid advanced object", (c: any) => { c.advanced = null; }],
] as const) {
  test(`invalid OCR ${name} is rejected before source access`, async () => {
    const f = fixture(); const c = command(); alter(c);
    const result = await f.useCase.startPrepareTrainingDataset(c, context);
    assert.equal(result.ok, false);
    assert.deepEqual(f.calls, { bindings: 0, storage: 0, provider: 0, dispatch: 0, power: 0 });
  });
}

for (const [name, binding] of [
  ["missing", []],
  ["foreign workspace", [{ workspaceId: "workspace-b", artifactId: "pdf-a", role: "primary", backing: { kind: "artifact-object", locator: "private-key" } }]],
  ["different artifact", [{ workspaceId: "workspace-a", artifactId: "other", role: "primary", backing: { kind: "artifact-object", locator: "private-key" } }]],
] as const) {
  test(`OCR ${name} source binding cannot authorize storage or provider access`, async () => {
    const f = fixture({ bindings: binding });
    assert.equal((await f.useCase.startPrepareTrainingDataset(command(), context)).ok, false);
    assert.deepEqual(f.calls, { bindings: 1, storage: 0, provider: 0, dispatch: 0, power: 0 });
  });
}

for (const output of ["wrong:" + "a".repeat(64), "sha256:" + "A".repeat(64), "sha256:short", "a".repeat(64), 1, undefined, new Error("private-hash-path")]) {
  test(`invalid source-integrity result ${output instanceof Error ? "exception" : typeof output + ":" + String(output).slice(0, 12)} cannot dispatch`, async () => {
    const f = fixture({ dependencies: { sourceIntegrityHasher: { digest() { if (output instanceof Error) throw output; return output; } } } });
    const result = await f.useCase.startPrepareTrainingDataset(command(), context);
    assert.equal(result.ok, false);
    assert.equal(f.calls.dispatch, 0); assert.equal(f.calls.power, 0);
    assert.doesNotMatch(JSON.stringify(result), /private-hash-path|[A-Z]:\\|runtimeWorkingDirectory/);
  });
}

for (const [name, options] of [
  ["empty", { bytes: Buffer.alloc(0) }],
  ["oversized", { bytes: Buffer.alloc(DATASET_PREPARATION_OCR_MAX_SOURCE_BYTES + 1) }],
  ["non-PDF", { mediaType: "text/markdown", originalName: "source.md" }],
  ["foreign catalog", { dependencies: { artifactCatalog: { async readArtifactCatalogRecord() { return { ok: true, value: { record: { workspaceId: "workspace-b", storageKey: "pdf-a" } } }; } } } }],
] as const) {
  test(`OCR ${name} input cannot dispatch or publish a source map`, async () => {
    const f = fixture(options);
    assert.equal((await f.useCase.startPrepareTrainingDataset(command(), context)).ok, false);
    assert.equal(f.calls.dispatch, 0); assert.equal(f.calls.power, 0);
  });
}

test("Standard preparation still stages without an OCR hasher or capability reader", async () => {
  const f = fixture({ mediaType: "text/markdown", originalName: "ordinary.md",
    dependencies: { sourceIntegrityHasher: undefined, readWorkerCapabilities: undefined } });
  const c = { sourceArtifactIds: ["pdf-a"], recipe: { normalization: { targetFormat: "markdown" },
    chunking: { strategy: "character", chunkSize: 128, chunkOverlap: 0 },
    generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic" } } },
    split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" } } as any;
  try {
    assert.equal((await f.useCase.startPrepareTrainingDataset(c, context)).ok, true);
    assert.equal(f.dispatched[0].payload.runtime.ocrSources, undefined);
    assert.equal(basename(f.dispatched[0].payload.sourceInputs[0].localPath), "0001-ordinary.md");
  } finally { await f.close(); }
});

for (const code of ["unavailable", undefined]) {
  test(`OCR capability guard ${code ?? "unexpected failure"} hides raw exception details`, async () => {
    const f = fixture({ dependencies: { runtimeCapabilityGuard: { async requireCapabilityReady() {
      throw Object.assign(new Error("C:\\private-runtime-path\\worker.py"), { code, details: { native: "private-guard-diagnostic" } });
    } } } });
    const result = await f.useCase.startPrepareTrainingDataset(command(), context);
    assert.equal(result.ok, false);
    assert.deepEqual(f.calls, { bindings: 0, storage: 0, provider: 0, dispatch: 0, power: 0 });
    assert.doesNotMatch(JSON.stringify(result), /private-runtime-path|private-guard-diagnostic|worker.py/);
  });
}

const stageFailureCases = ["stage-denial", "sync-removal", "stage-exception", "task-cleanup", "allocation", "allocation-sync", "start-ambiguous", "missing-identity", "wrong-identity"] as const;
const unknownStartCases = ["start-ambiguous", "missing-identity", "wrong-identity"];
const allocationFailureCases = ["allocation", "allocation-sync"];
const childStageCase = process.env.ASB_OCR_STAGE_FAULT_CASE;
if (childStageCase !== undefined) {
  assert.ok(stageFailureCases.includes(childStageCase as any));
  test("OCR stage failure child", async () => {
    const roots: string[] = [];
    let removalAttempts = 0;
    const actualAllocate = fileOperations.mkdtemp.bind(fileOperations);
    const reconciler = new OwnedTaskReconcilerService();
    reconciler.stopObservation();
    const allocation = mock.method(fileOperations, "mkdtemp", (prefix: any, ...args: any[]) => {
      assert.equal(prefix, join(tmpdir(), "ai-system-builder-runtime-"));
      if (childStageCase === "allocation-sync") throw new Error("private-allocation-diagnostic");
      if (childStageCase === "allocation") return Promise.reject(new Error("private-allocation-diagnostic"));
      return (actualAllocate as any)(prefix, ...args).then((root: string) => { roots.push(root); return root; });
    });
    const removal = mock.method(fileOperations, "rm", (path: any, ...args: any[]) => {
      if (roots.includes(String(path))) {
        removalAttempts++;
        if (childStageCase === "sync-removal") throw new Error("private-cleanup-diagnostic");
        return Promise.reject(new Error("private-cleanup-diagnostic"));
      }
      assert.fail("Removal requested for an unrecorded path");
    });
    syncBuiltinESMExports();
    try {
      const f = fixture({ throwOnStart: childStageCase === "start-ambiguous", dependencies: {
        taskReconciler: reconciler,
        ...(["stage-denial", "sync-removal"].includes(childStageCase) ? { sourceIntegrityHasher: { digest: () => "sha256:invalid" } } : {}),
        ...(childStageCase === "stage-exception" ? { artifactCatalog: { async readArtifactCatalogRecord() { throw new Error("private-stage-diagnostic"); } } } : {}),
      }, ...(childStageCase === "missing-identity" ? { startAcknowledgement: { requestId: "" } } : {}),
      ...(childStageCase === "wrong-identity" ? { startAcknowledgement: { requestId: "unrelated-task" } } : {}) });
      let result = await f.useCase.startPrepareTrainingDataset(command(), context);
      if (childStageCase === "task-cleanup") {
        assert.equal(result.ok, true, JSON.stringify(result));
        const acceptedId = f.dispatched[0].requestId;
        result = await f.useCase.readPrepareTrainingDataset(acceptedId, context) as any;
        const repeated = await f.useCase.readPrepareTrainingDataset(acceptedId, context);
        assert.equal(repeated.ok, false);
        assert.doesNotMatch(JSON.stringify(repeated), /private-cleanup-diagnostic|[A-Z]:\\/);
      }
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /private-(cleanup|allocation|stage|map)-diagnostic|runtimeWorkingDirectory|staged-pdf-ocr-v1|[A-Z]:\\/);
      assert.equal(removalAttempts, allocationFailureCases.includes(childStageCase) || unknownStartCases.includes(childStageCase) ? 0 : 1);
      assert.equal(roots.length, allocationFailureCases.includes(childStageCase) ? 0 : 1);
      for (const root of roots) await access(root); // Retained; never delete unknown effects for a pass.
      if (unknownStartCases.includes(childStageCase)) {
        assert.deepEqual(reconciler.status, { pending: 1, retrying: 0 });
        await reconciler.reconcileNow();
        assert.deepEqual(await reconciler.cancelAndReconcile(), { pending: 1, retrying: 0 });
        await reconciler.settleAfterRuntimeStop(["python"]);
        assert.deepEqual(reconciler.status, { pending: 1, retrying: 0 });
        assert.deepEqual(f.observations, { status: 0, cancel: 0 });
        assert.equal(f.calls.dispatch, 1);
      }
      const nextInstance = fixture();
      const denied = await nextInstance.useCase.startPrepareTrainingDataset(command(), context);
      assert.equal(denied.ok, false);
      assert.deepEqual(nextInstance.calls, { bindings: 0, storage: 0, provider: 0, dispatch: 0, power: 0 });
      assert.equal(removalAttempts, allocationFailureCases.includes(childStageCase) || unknownStartCases.includes(childStageCase) ? 0 : 1);
      console.log(JSON.stringify({ ocr_stage_failure_case: childStageCase, passed: true,
        removal_attempts: removalAttempts, successor_denied_before_io: true, ledger_reset: false }));
    } finally {
      reconciler.stopObservation();
      allocation.mock.restore(); removal.mock.restore(); syncBuiltinESMExports();
    }
  });
} else {
  test("OCR stage lifetime failures retain exact owners without retries across use-case instances", () => {
    const file = resolve("modules/application/use-cases/tests/prepare-training-dataset-ocr-source.integration.test.ts");
    for (const selected of stageFailureCases) {
      const env: Record<string, string> = { NODE_OPTIONS: "", ASB_OCR_STAGE_FAULT_CASE: selected,
        HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1" };
      for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE"]) {
        if (process.env[key] !== undefined) env[key] = process.env[key]!;
      }
      // Fixed synthetic test only; no inherited test-worker marker, arbitrary
      // command, supplier, model, credential, source selector or native helper.
      const child = spawnSync(process.execPath, ["--import", "tsx", "--test",
        "--test-name-pattern=^OCR stage failure child$", "--", file], {
        cwd: process.cwd(), env, windowsHide: true, timeout: 30_000, maxBuffer: 256 * 1024, encoding: "utf8",
      });
      assert.equal(child.error, undefined, selected);
      assert.equal(child.signal, null, selected);
      assert.equal(child.status, 0, `${selected}: ${child.stdout}\n${child.stderr}`);
      const records = child.stdout.split(/\r?\n/).map((line) => line.replace(/^# /, ""))
        .filter((line) => line.startsWith('{"ocr_stage_failure_case":')).map((line) => JSON.parse(line));
      assert.deepEqual(records, [{ ocr_stage_failure_case: selected, passed: true,
        removal_attempts: allocationFailureCases.includes(selected) || unknownStartCases.includes(selected) ? 0 : 1,
        successor_denied_before_io: true, ledger_reset: false }]);
    }
    console.log(JSON.stringify({ ocr_owned_stage_cases: stageFailureCases, passed: true,
      isolated_processes: stageFailureCases.length, models_used: false, old_files_touched: false, ledger_resets: 0 }));
  });
}
