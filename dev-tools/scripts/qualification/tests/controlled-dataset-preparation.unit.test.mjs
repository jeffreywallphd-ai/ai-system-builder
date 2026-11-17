import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONTROLLED_DATASET_SOURCE, createControlledDatasetResult, validateControlledDatasetRequest } from "../visual-composer/controlled-dataset-preparation.mjs";
import { createControlledConversationRuntimeWorker } from "../visual-composer/controlled-conversation-runtime-worker.mjs";

function payload(root) {
  return { workspaceId: "workspace.fixture", recipe: { task: { taskType: "llm-instruction", textInputMode: "generate" }, generation: { model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct", inferenceMode: "chat", device: "cpu", torchDtype: "bfloat16", memoryMode: "offload-v1", memoryOverflowPolicy: "none" } } }, sourceInputs: [{ artifactId: "workspaces/workspace.fixture/artifacts/files/uploads/synthetic.txt", localPath: path.join(root, "source.txt") }], output: { format: "jsonl" }, quality: { effectivePolicy: { mandatoryChecks: { schema: true } } }, runtime: { runtimeWorkingDirectory: root, structuredOutput: { payloadKey: "example", example: { example: { instruction: "Answer the input using only the provided context." } }, purposePaths: { context: ["context"], input: ["input"], instruction: ["instruction"], output: ["output"] } } } };
}
test("fixed dataset fixture binds settings, existing host staging, policy, review and exclusive outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-system-builder-runtime-"));
  try {
    await writeFile(path.join(root, "source.txt"), CONTROLLED_DATASET_SOURCE, { flag: "wx" });
    const request = payload(root);
    for (const mutate of [p => p.recipe.generation.model.memoryMode = "standard", p => p.recipe.generation.model.device = "cuda", p => p.recipe.generation.model.torchDtype = "float32", p => p.recipe.generation.model.memoryOverflowPolicy = "allow", p => p.runtime.runtimeWorkingDirectory = path.dirname(root), p => p.output.format = "csv", p => p.sourceInputs[0].artifactId = "workspaces/workspace.other/artifacts/files/uploads/synthetic.txt"]) {
      const invalid = structuredClone(request); mutate(invalid);
      await assert.rejects(validateControlledDatasetRequest(invalid));
      assert.deepEqual(await readdir(root), ["source.txt"]);
    }
    await writeFile(path.join(root, "source.txt"), CONTROLLED_DATASET_SOURCE.replace("safe", "evil"));
    await assert.rejects(validateControlledDatasetRequest(request));
    assert.deepEqual(await readdir(root), ["source.txt"]);
    await writeFile(path.join(root, "source.txt"), CONTROLLED_DATASET_SOURCE);
    const result = await createControlledDatasetResult(request);
    assert.deepEqual(result.qualityReport.policy, request.quality.effectivePolicy);
    const review = JSON.parse(await readFile(path.join(root, "review.jsonl"), "utf8"));
    assert.equal(review.sourceArtifactId, request.sourceInputs[0].artifactId);
    assert.equal(result.summary.acceptedRowCount, 1); assert.equal(result.summary.quarantinedRowCount, 1);
    assert.equal(result.outputs.find(row => row.role === "review").metadata.reportFingerprint, result.qualityReport.reportFingerprint);
    await assert.rejects(createControlledDatasetResult(request));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dataset transport denies resources, refuses running cancellation, accepts queued cancellation and retries", { timeout: 20000 }, async () => {
  const token = "qualification-token-0123456789abcdef";
  const worker = createControlledConversationRuntimeWorker({ port: 0, token, scenario: "dataset-profile" });
  const { port } = await worker.start();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const origin = `http://127.0.0.1:${port}`;
  const roots = [];
  const call = async (url, method = "GET", body) => (await fetch(origin + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const start = async id => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-system-builder-runtime-")); roots.push(root);
    await writeFile(path.join(root, "source.txt"), CONTROLLED_DATASET_SOURCE, { flag: "wx" });
    return call("/tasks/start", "POST", { requestId: id, taskType: "prepare-training-dataset", payload: payload(root) });
  };
  try {
    assert.ok((await call("/capabilities")).capabilities.includes("dataset-preparation.offload-v1"));
    await start("dataset.denied");
    await new Promise(resolve => setTimeout(resolve, 350));
    const denied = await call("/tasks/dataset.denied");
    assert.equal(denied.status, "failed");
    assert.equal(denied.error.code, "generation_insufficient_resources");
    assert.deepEqual(denied.error.details, {
      stage: "generation", reasonCode: "generation_insufficient_resources",
      memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0 },
    });
    assert.deepEqual(await readdir(roots[0]), ["source.txt"], "denied task creates no output");
    await start("dataset.running");
    assert.equal((await call("/tasks/dataset.running/cancel", "POST")).cancelled, false);
    await new Promise(resolve => setTimeout(resolve, 6500));
    assert.equal((await call("/tasks/dataset.running")).status, "succeeded");
    await start("dataset.queued");
    assert.equal((await call("/tasks/dataset.queued/cancel", "POST")).cancelled, true);
    assert.equal((await call("/tasks/dataset.queued")).status, "cancelled");
    assert.deepEqual(await readdir(roots[2]), ["source.txt"]);
    await start("dataset.retry");
    await new Promise(resolve => setTimeout(resolve, 6500));
    assert.equal((await call("/tasks/dataset.retry")).status, "succeeded");
    assert.equal((await call("/models/status")).activeTaskCount, 0);
  } finally { await worker.stop(); for (const root of roots) await rm(root, { recursive: true, force: true }); }
});
