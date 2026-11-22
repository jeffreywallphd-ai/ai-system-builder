/** Source-only compatibility probe. No worker, model or public entry is started. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrainModelUseCase } from "../../../../modules/application/use-cases/model/train-model.use-case";
import { createPythonRuntimeTaskRegistryAdapter } from "../../../../modules/adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter";

async function main(): Promise<void> {
const input = readFileSync(0, "utf8");
assert(Buffer.byteLength(input) <= 1024);
const configuration = JSON.parse(input);
assert.deepEqual(Object.keys(configuration), ["temporaryRoot"]);
const root = await realpath(tmpdir());
assert.equal(configuration.temporaryRoot, root);
const workspaceId = "workspace.training";
const fixture = { schemaVersion: "training-host-fixture-v2", inputProfile: "generated-tiny-qwen2-v1",
  workspaceId, baseModelRecordId: "model.input", datasetArtifactIds: ["data.train", "data.validation"] };
const model = join(root, "synthetic-model-not-loaded");
const bytes = new TextEncoder().encode('{"instruction":"What does the help panel show?","output":"The help panel shows guidance for the current feature."}\n{"instruction":"Where are task updates?","output":"Task updates are in the notification center."}\n');
let captured: unknown;
const runtimeTaskRegistry = createPythonRuntimeTaskRegistryAdapter({ async startTask(request: { requestId: string; taskType: string }) {
  assert.equal(captured, undefined); captured = request;
  return { requestId: request.requestId, taskType: request.taskType, accepted: true, status: "queued" };
} } as never);
const useCase = new TrainModelUseCase({
  runtimeTaskRegistry,
  modelRegistry: { async getModelRecord(workspace: string, id: string) {
    assert.equal(workspace, workspaceId); assert.equal(id, fixture.baseModelRecordId);
    return { modelRecordId: id, provider: "unknown", modelId: "aisb-testing/tiny-qwen2-v1",
      localPath: model, inferenceMode: "causal" };
  } } as never,
  storageBindings: { async readArtifactStorageBindings(input: { workspaceId: string; artifactId: string }) {
    assert.equal(input.workspaceId, workspaceId); assert(fixture.datasetArtifactIds.includes(input.artifactId));
    return { ok: true, value: { bindings: [{ ...input, role: "primary",
      backing: { kind: "artifact-object", provider: "local-filesystem", locator: `datasets/${input.artifactId}.jsonl` } }] } };
  } } as never,
  storage: { async retrieveArtifact() {
    return { ok: true, value: { descriptor: { key: "synthetic", mediaType: "application/x-ndjson" }, content: bytes } };
  } } as never,
  taskPowerLifecycle: { async startTask() {}, async completeTask() {} },
});
const started = await useCase.execute({ workspaceId: workspaceId as never, trainingTask: "llm-instruction",
  baseModel: { modelRecordId: fixture.baseModelRecordId }, method: "lora",
  datasets: fixture.datasetArtifactIds.map((artifactId, index) => ({ artifactId, splitRole: index === 0 ? "train" as const : "validation" as const, format: "jsonl" })),
  commonParameters: { numEpochs: 1, maxSteps: 1, batchSize: 1, learningRate: .0002, maxSequenceLength: 64, seed: 7 },
  advancedParameters: { gradientAccumulationSteps: 1, checkpointIntervalSteps: 100, evalIntervalSteps: 100, gradientCheckpointing: false, lora: { rank: 1, alpha: 2, dropout: .05 } },
  output: { outputModelName: "training-host-support-adapter", maxShardSize: "2GB", destination: { local: { enabled: true } }, registration: { displayName: "Training host support adapter", artifactForm: "adapter" } },
  validation: { enabled: false, expectedLoRA: true, expectedRecurrentAdditions: false },
});
assert.equal(started.status, "queued"); assert.equal(typeof started.runId, "string");
assert(captured);
// The Python parent owns the disposable root and removes its synthetic files.
process.stdout.write(JSON.stringify({ fixture, model, request: captured }));
}
void main();
