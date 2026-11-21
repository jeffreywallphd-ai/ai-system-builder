import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {MODEL_TRAINING_METHODS, normalizeModelTrainingRequest} from "../../model";
import {DATASET_PREPARATION_TASK_TYPES} from "../../runtime";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  readHeadlessModelTrainingPlanRequest, readHeadlessModelTrainingSettings} from "..";

function fixture() {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const training = {trainingTask: "llm-instruction", method: "lora", commonParameters: {numEpochs: 1, maxSteps: 8, batchSize: 1,
    learningRate: 0.0002, weightDecay: 0, maxSequenceLength: 128, seed: 0}, advancedParameters: {gradientAccumulationSteps: 2,
    warmupSteps: 0, warmupRatio: 0, schedulerType: "linear", evalIntervalSteps: 2, checkpointIntervalSteps: 4, saveTotalLimit: 1,
    mixedPrecision: "no", gradientCheckpointing: false, lora: {rank: 4, alpha: 8, dropout: 0, targetModules: ["q_proj", "v_proj"]},
    quantization: {loadIn4Bit: false, loadIn8Bit: false, bnb4BitQuantType: "nf4", bnb4BitComputeDtype: "float32"}},
    validation: {enabled: false, expectedLoRA: true, expectedRecurrentAdditions: false, taskTags: ["chat"]}};
  const request = {version, operation: "models.train", input: {hostIncarnationId: host, workspaceId: createWorkspaceId("workspace.training-plan"),
    idempotencyKey: randomUUID(), name: "Small training trial", model: {modelRecordId: "model.synthetic", updatedAt: "2026-11-21T00:00:00.000Z"},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)}, training}};
  return {host, request, training};
}

test("exact training intent preserves every supported setting and existing normalizer meaning", () => {
  const f = fixture(), result = readHeadlessModelTrainingPlanRequest(f.request, f.host); assert.ok(result.ok);
  assert.deepEqual(result.request, f.request); assert.notEqual(result.request.input.training.advancedParameters?.lora, f.training.advancedParameters.lora);
  const ordinary = normalizeModelTrainingRequest({...result.request.input.training, workspaceId: result.request.input.workspaceId,
    baseModel: {modelRecordId: result.request.input.model.modelRecordId}, datasets: [{artifactId: "artifact.synthetic", splitRole: "train"}],
    output: {outputModelName: result.request.input.name, destination: {local: {enabled: true}}}});
  assert.deepEqual(JSON.parse(JSON.stringify({commonParameters: ordinary.commonParameters, advancedParameters: ordinary.advancedParameters,
    validation: ordinary.validation})), {commonParameters: result.request.input.training.commonParameters,
    advancedParameters: result.request.input.training.advancedParameters, validation: result.request.input.training.validation});
  f.training.advancedParameters.lora.targetModules[0] = "changed"; f.training.commonParameters.seed = 42;
  assert.equal(result.request.input.training.commonParameters.seed, 0); assert.equal(result.request.input.training.advancedParameters?.lora?.targetModules?.[0], "q_proj");
});

test("existing task and method labels are selectable syntax without claiming runtime compatibility", () => {
  const f = fixture();
  for (const trainingTask of DATASET_PREPARATION_TASK_TYPES) for (const method of MODEL_TRAINING_METHODS)
    assert.ok(readHeadlessModelTrainingSettings({trainingTask, method, commonParameters: {maxSteps: 1}}));
  assert.equal(parseHeadlessReadRequest(f.request, f.host).ok, false, "A private proposal never joins public read capability discovery.");
});

test("canonical output ignores object key order while retaining all explicit zero and false values", () => {
  const f = fixture(), settings = readHeadlessModelTrainingSettings(f.training); assert.ok(settings);
  const reordered = readHeadlessModelTrainingSettings({validation: f.training.validation, advancedParameters: Object.fromEntries(Object.entries(f.training.advancedParameters).reverse()),
    commonParameters: Object.fromEntries(Object.entries(f.training.commonParameters).reverse()), method: f.training.method, trainingTask: f.training.trainingTask});
  assert.equal(JSON.stringify(settings), JSON.stringify(reordered));
  assert.equal(settings.validation?.enabled, false); assert.equal(settings.advancedParameters?.gradientCheckpointing, false);
  assert.equal(settings.advancedParameters?.quantization?.loadIn4Bit, false); assert.equal(settings.commonParameters.seed, 0);
});

test("invalid numeric settings and unknown powers cannot silently normalize to defaults", () => {
  const f = fixture();
  const variants = [{commonParameters: {}}, {commonParameters: {numEpochs: undefined}}, {commonParameters: {numEpochs: 1.5}},
    {commonParameters: {maxSteps: -1}}, {commonParameters: {maxSteps: 0}}, {commonParameters: {maxSteps: Number.MAX_SAFE_INTEGER + 1}},
    {commonParameters: {numEpochs: 1, batchSize: 0}}, {commonParameters: {numEpochs: 1, seed: -1}},
    {commonParameters: {numEpochs: 1, learningRate: 0}}, {commonParameters: {numEpochs: 1, learningRate: Infinity}},
    {commonParameters: {numEpochs: 1, weightDecay: NaN}}, {commonParameters: {numEpochs: 1, localPath: "private"}},
    {advancedParameters: {lora: {dropout: 1}}}, {advancedParameters: {warmupRatio: 2}}, {advancedParameters: {saveTotalLimit: -1}},
    {advancedParameters: {gradientCheckpointing: 1}}, {advancedParameters: {mixedPrecision: "arbitrary"}},
    {advancedParameters: {lora: {targetModules: ["q_proj", "q_proj"]}}}, {advancedParameters: {lora: {targetModules: ["../private"]}}},
    {advancedParameters: {quantization: {loadIn4Bit: true, loadIn8Bit: true}}}, {advancedParameters: {quantization: {bnb4BitComputeDtype: "__dict__"}}},
    {advancedParameters: {runtimeMetadata: {approved: true}}}, {validation: {enabled: "false"}}, {validation: {taskTags: ["unknown"]}},
    {validation: {reportPath: "private"}}, {trainingTask: "shell"}, {method: " LoRA "}, {output: {destination: "remote"}}];
  for (const patch of variants) assert.equal(readHeadlessModelTrainingSettings({...f.training, ...patch}), undefined, JSON.stringify(patch));
});

test("private proposal excludes host paths, provider/runtime controls and malformed exact selectors", () => {
  const f = fixture();
  for (const patch of [{name: "../bad"}, {name: "C:\\private"}, {name: "."}, {name: ""}, {name: "Bad\nname"},
    {name: "hf_" + "a".repeat(30)}, {localPath: "private"}, {runtimeMetadata: {approved: true}}, {approved: true},
    {output: {destination: {huggingFace: {enabled: true}}}}, {idempotencyKey: "arbitrary"},
    {model: {...f.request.input.model, updatedAt: "2026-02-30T00:00:00.000Z"}},
    {dataset: {...f.request.input.dataset, versionDigest: "sha256:invalid"}}, {training: {...f.training, commonParameters: {numEpochs: 1, command: "run"}}}])
    assert.equal(readHeadlessModelTrainingPlanRequest({...f.request, input: {...f.request.input, ...patch}}, f.host).ok, false, JSON.stringify(patch));
  const other = randomUUID(); assert.ok(isHeadlessHostIncarnationId(other));
  assert.deepEqual(readHeadlessModelTrainingPlanRequest(f.request, other), {ok: false, code: "headless.host-changed"});
});

test("active, hidden, cyclic, oversized and sparse settings deny without running getters", () => {
  const f = fixture(); let hooks = 0;
  const active = {...f.training}; Object.defineProperty(active, "commonParameters", {enumerable: true, get() {hooks++; return f.training.commonParameters;}});
  assert.equal(readHeadlessModelTrainingSettings(active), undefined); assert.equal(hooks, 0);
  const hidden = {...f.training}; Object.defineProperty(hidden, "approved", {value: true}); assert.equal(readHeadlessModelTrainingSettings(hidden), undefined);
  const cyclic: Record<string, unknown> = {...f.training}; cyclic.self = cyclic; assert.equal(readHeadlessModelTrainingSettings(cyclic), undefined);
  for (const targetModules of [Array(2), Array(33).fill("q_proj"), ["q".repeat(2050)]])
    assert.equal(readHeadlessModelTrainingSettings({...f.training, advancedParameters: {lora: {targetModules}}}), undefined);
});
