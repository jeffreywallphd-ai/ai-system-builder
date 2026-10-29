import assert from "node:assert/strict";
import test from "node:test";
import type { Page, TestInfo } from "@playwright/test";
import { qualifyDesktopTrainingJourney, readTrainingHostInventory } from "../visual-composer/e2e/model-training-journey";
import { captureTrainingHostFixture, trainingHostReport, trainingPublicId, trainingWorkspaceId, trainingDatasetIds, TRAINING_HOST_PHASES, TRAINING_OUTPUT_NAME, TRAINING_DISPLAY_NAME } from "../visual-composer/model-training-oracles";
import { trainingReadOnlyArguments } from "../visual-composer/training-host-fixture";

test("the no-install delegate admits only exact declared read-only probes and pip version", () => {
  const probes = new Set(["fixed-readonly-probe"]);
  assert.equal(trainingReadOnlyArguments(["-c", "fixed-readonly-probe"], probes), true);
  assert.equal(trainingReadOnlyArguments(["-m", "pip", "--version"], probes), true);
  for (const args of [["-m", "pip", "install", "torch"], ["-m", "pip", "--version", "extra"], ["-c", "fixed-readonly-probe; dangerous()"], ["-c", "fixed-readonly-probe", "path"], ["--inspect"], []]) assert.equal(trainingReadOnlyArguments(args, probes), false);
});

const run = "2026-10-29-training-fixture-0123456789", source = `source.${"a".repeat(64)}`;
const fixture = () => ({ schemaVersion: "training-host-fixture-v1", runId: run, sourceRevision: source,
  workspaceId: trainingWorkspaceId(run), baseModelRecordId: "model.base-fixture",
  datasetArtifactIds: [...trainingDatasetIds(run)], outputName: TRAINING_OUTPUT_NAME, displayName: TRAINING_DISPLAY_NAME });
const encode = (value: unknown) => JSON.stringify(value);
test("captures only the fixed current training declaration and detaches its dataset identities", () => {
  assert.equal(captureTrainingHostFixture(undefined, undefined, undefined), undefined);
  const v = fixture(), result = captureTrainingHostFixture(encode(v), run, source)!;
  assert.deepEqual(result, v); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.datasetArtifactIds));
  v.datasetArtifactIds[0] = "changed"; assert.equal(result.datasetArtifactIds[0], trainingDatasetIds(run)[0]);
});
test("rejects stale or foreign source, workspace, base and dataset declarations", () => {
  for (const change of [
    { schemaVersion: "other" }, { runId: "other-run" }, { sourceRevision: `source.${"b".repeat(64)}` },
    { workspaceId: "workspace.foreign" }, { workspaceId: "workspace.training-host.0123456789abcdef" }, { baseModelRecordId: "C:\\private\\model" },
    { datasetArtifactIds: [] }, { datasetArtifactIds: ["artifact.a", "artifact.a"] },
    { datasetArtifactIds: ["artifact.a", "../foreign"] }, { datasetArtifactIds: ["artifact.a", "artifact.b", "artifact.c"] },
    { outputName: "../private-output" }, { displayName: "private-provider-payload" }, { extra: "private" },
  ]) assert.throws(() => captureTrainingHostFixture(encode({ ...fixture(), ...change }), run, source), /unavailable or invalid/);
  for (const value of ["{", " ".repeat(4097), encode(null), encode([]), encode({})]) assert.throws(() => captureTrainingHostFixture(value, run, source));
  assert.throws(() => captureTrainingHostFixture(encode(fixture()), "invalid", source));
  assert.throws(() => captureTrainingHostFixture(encode(fixture()), run, "invalid"));
});
test("closed public identities cannot contain paths, queries or coercion hooks", () => {
  assert.equal(trainingPublicId("train-20261029120000"), "train-20261029120000");
  let calls = 0;
  for (const value of [undefined, null, 0, "", "abc", "../model", "model/token=private", "model?private", { toString() { calls++; return "model.valid"; } }]) assert.throws(() => trainingPublicId(value));
  assert.equal(calls, 0);
});
test("only a dense ordered complete phase list can pass; failure never grants parent qualification", () => {
  for (let count = 0; count < TRAINING_HOST_PHASES.length; count++) assert.equal(trainingHostReport(TRAINING_HOST_PHASES.slice(0, count), false).status, "failed");
  const full = trainingHostReport(TRAINING_HOST_PHASES, false); assert.equal(full.status, "passed"); assert.equal(full.parentQualificationGranted, false);
  assert.equal(trainingHostReport(TRAINING_HOST_PHASES, true).status, "failed");
  let reads = 0;
  const sparse = new Array(TRAINING_HOST_PHASES.length), accessor = [...TRAINING_HOST_PHASES], iterator = [...TRAINING_HOST_PHASES];
  Object.defineProperty(accessor, "0", { get() { reads++; return TRAINING_HOST_PHASES[0]; } });
  Object.defineProperty(iterator, Symbol.iterator, { value: function* () { reads++; yield "private"; } });
  const proxy = new Proxy([...TRAINING_HOST_PHASES], { get() { reads++; throw new Error("private"); } });
  for (const value of [sparse, accessor, iterator, proxy, ["private"], [...TRAINING_HOST_PHASES].reverse()]) assert.throws(() => trainingHostReport(value, false), /unavailable or invalid/);
  assert.equal(reads, 0);
});

test("unknown prerequisites cannot enter Page ports or disclose the declaration", async () => {
  let reads = 0;
  const page = { getByLabel() { reads++; throw new Error("private-page"); } } as unknown as Page;
  const info = { project: { name: "packaged-desktop" } } as TestInfo;
  for (const value of [undefined, "{", encode({ ...fixture(), extra: "private" })]) await assert.rejects(qualifyDesktopTrainingJourney(page, info, value), /prerequisites are invalid|input is unavailable or invalid/);
  assert.equal(reads, 0);
});
test("initial Page and attachment failures retain a fixed training phase without raw private errors", async () => {
  const keys = ["VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env[keys[0]] = run; process.env[keys[1]] = source;
    const page = { getByLabel() { throw new Error("private-page-token"); } } as unknown as Page;
    const reports: ReturnType<typeof trainingHostReport>[] = [];
    const info = { project: { name: "packaged-desktop" }, attach: async (_: string, input: { body: string }) => { reports.push(JSON.parse(input.body)); } } as unknown as TestInfo;
    await assert.rejects(qualifyDesktopTrainingJourney(page, info, encode(fixture())), /^Error: Training host phase did not complete: workspace-and-inputs-visible\.$/);
    assert.equal(reports.length, 1); assert.equal(reports[0]!.status, "failed"); assert.deepEqual(reports[0]!.phases, []); assert(!encode(reports).includes("private-page"));
    info.attach = async () => { throw null; };
    await assert.rejects(qualifyDesktopTrainingJourney(page, info, encode(fixture())), /^Error: Training host report unavailable; last phase: workspace-and-inputs-visible\.$/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

const readInput = () => ({ workspaceId: trainingWorkspaceId(run), baseModelRecordId: "model.base-fixture", baseName: "Qualified Qwen 0.5B input", displayName: TRAINING_DISPLAY_NAME, requestId: "train-fixture-current" });
const baseRow = () => ({ workspaceId: trainingWorkspaceId(run), modelRecordId: "model.base-fixture", displayName: "Qualified Qwen 0.5B input", source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", serializationFormat: "safetensors", localPath: "C:\\private\\original-verified-model" });
const generatedRow = () => ({ ...baseRow(), modelRecordId: "model.generated-fixture", displayName: TRAINING_DISPLAY_NAME, source: "generated", lifecycleStatus: "generated", artifactForm: "adapter", generatedFromRunId: "train-fixture-current", localPath: "C:\\private\\owned-output" });
async function withInventoryPort(port: (input: unknown) => Promise<unknown>, action: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktopApi: { listModels: port } } });
  try { await action(); } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}
test("real read-only inventory projection returns only IDs and exact base/task-owned output facts", async () => {
  const input = readInput(), calls: unknown[] = [];
  for (const models of [[baseRow()], [generatedRow(), baseRow()]]) await withInventoryPort(async args => { calls.push(args); return { ok: true, value: { models } }; }, async () => {
    const result = await readTrainingHostInventory(input);
    assert.deepEqual(result, { baseModelRecordId: input.baseModelRecordId, generatedRecordIds: models.length === 2 ? ["model.generated-fixture"] : [] });
    assert(!encode(result).includes("private")); assert(!encode(result).includes("localPath"));
  });
  assert.deepEqual(calls, [{ workspaceId: input.workspaceId }, { workspaceId: input.workspaceId }]);
});
test("inventory proof waits for the fresh call and a refused read cannot reuse previous visible rows", async () => {
  let release!: (value: unknown) => void, settled = false;
  const waiting = new Promise(resolve => { release = resolve; });
  await withInventoryPort(async () => waiting, async () => {
    const result = readTrainingHostInventory(readInput()).then(value => { settled = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release({ ok: true, value: { models: [baseRow()] } }); await result; assert.equal(settled, true);
  });
  for (const reason of [new Error("private-fresh-read-error"), null, undefined]) await withInventoryPort(async () => { throw reason; }, async () => {
    await assert.rejects(readTrainingHostInventory(readInput()), /^Error: The training registry read could not be confirmed\.$/);
  });
});
test("inventory proof denies malformed, failed, stale, foreign and duplicate rows without reading accessors", async () => {
  const values: unknown[] = [null, {}, { ok: false, error: { message: "private" } }, { ok: true, value: {} },
    ...[[], [baseRow(), generatedRow(), generatedRow()], [baseRow(), baseRow()], [generatedRow()],
      [{ ...baseRow(), workspaceId: "workspace.foreign" }], [{ ...baseRow(), modelRecordId: "../private" }],
      [baseRow(), { ...generatedRow(), generatedFromRunId: "train-foreign" }], [baseRow(), { ...generatedRow(), serializationFormat: "pickle" }],
      [baseRow(), { ...generatedRow(), localPath: "" }]].map(models => ({ ok: true, value: { models } }))];
  let getters = 0; const accessor = baseRow(); Object.defineProperty(accessor, "localPath", { get() { getters++; return "private"; } });
  values.push({ ok: true, value: { models: [accessor] } });
  for (const value of values) await withInventoryPort(async () => value, async () => { await assert.rejects(readTrainingHostInventory(readInput()), /^Error: The training registry read could not be confirmed\.$/); });
  assert.equal(getters, 0);
});
