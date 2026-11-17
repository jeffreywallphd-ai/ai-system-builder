// Synthetic transport evidence only. Actual model quality is qualified separately.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export const CONTROLLED_DATASET_SOURCE = "This synthetic source explains safe local dataset preparation and reviewing ready examples before saving a dataset.\n";

export async function validateControlledDatasetRequest(payload) {
  assert.equal(payload?.recipe?.task?.taskType, "llm-instruction");
  assert.equal(payload.recipe.task.textInputMode, "generate");
  assert.equal(payload.recipe.generation.model.provider, "transformers");
  assert.equal(payload.recipe.generation.model.inferenceMode, "chat");
  assert.equal(payload.recipe.generation.model.modelId, "Qwen/Qwen2.5-1.5B-Instruct");
  assert.equal(payload.recipe.generation.model.device, "cpu");
  assert.equal(payload.recipe.generation.model.torchDtype, "bfloat16");
  assert.equal(payload.recipe.generation.model.memoryMode, "offload-v1");
  assert.equal(payload.recipe.generation.model.memoryOverflowPolicy, "none");
  assert.equal(payload.sourceInputs.length, 1);
  assert.match(payload.workspaceId, /^workspace\.[A-Za-z0-9._-]{1,128}$/);
  assert.ok(payload.sourceInputs[0].artifactId.startsWith(`workspaces/${payload.workspaceId}/artifacts/files/uploads/`));
  assert.match(payload.sourceInputs[0].artifactId.slice(`workspaces/${payload.workspaceId}/artifacts/files/uploads/`.length), /^[A-Za-z0-9-]+\.txt$/);
  assert.equal(payload.output.format, "jsonl");
  assert.ok(payload.quality?.effectivePolicy?.mandatoryChecks?.schema === true);
  const root = payload.runtime.runtimeWorkingDirectory;
  assert.ok(path.isAbsolute(root));
  // Only an existing immediate child created by the real host's staging use case.
  assert.match(path.relative(os.tmpdir(), root), /^ai-system-builder-runtime-[A-Za-z0-9]+$/);
  let ancestor = path.parse(root).root;
  for (const segment of path.relative(ancestor, root).split(path.sep)) {
    ancestor = path.join(ancestor, segment);
    const stat = await lstat(ancestor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(path.resolve(await realpath(ancestor)).toLowerCase(), path.resolve(ancestor).toLowerCase());
  }
  const sourcePath = payload.sourceInputs[0].localPath;
  assert.ok(typeof sourcePath === "string" && path.isAbsolute(sourcePath));
  const relative = path.relative(root, sourcePath);
  assert.ok(relative && path.basename(relative) === relative && relative !== ".." && !path.isAbsolute(relative));
  const stat = await lstat(sourcePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size === Buffer.byteLength(CONTROLLED_DATASET_SOURCE));
  const file = await open(sourcePath, "r");
  try {
    const opened = await file.stat();
    assert.ok(opened.isFile() && opened.size === stat.size);
    const bytes = Buffer.alloc(stat.size + 1);
    const result = await file.read(bytes, 0, bytes.length, 0);
    assert.equal(result.bytesRead, stat.size);
    assert.equal(bytes.subarray(0, result.bytesRead).toString("utf8"), CONTROLLED_DATASET_SOURCE);
  } finally { await file.close(); }
  assert.deepEqual(payload.runtime.structuredOutput.purposePaths, { context: ["context"], input: ["input"], instruction: ["instruction"], output: ["output"] });
  const example = payload.runtime.structuredOutput.example[payload.runtime.structuredOutput.payloadKey];
  assert.ok(typeof example.instruction === "string" && example.instruction.length > 0 && example.instruction.length <= 2000);
  return root;
}

export async function createControlledDatasetResult(payload) {
  const root = await validateControlledDatasetRequest(payload);
  const source = payload.sourceInputs[0].artifactId;
  const structured = payload.runtime.structuredOutput;
  const accepted = { instruction: structured.example[structured.payloadKey].instruction, input: "What does the source explain?", context: CONTROLLED_DATASET_SOURCE.trim(), output: "Safe local dataset preparation." };
  const fingerprint = createHash("sha256").update(JSON.stringify({ source, accepted, policy: payload.quality.effectivePolicy })).digest("hex");
  const qualityReport = {
    schemaVersion: "1", status: "needs-attention", reportFingerprint: fingerprint,
    policy: payload.quality.effectivePolicy,
    mapping: { taskType: "llm-instruction", status: "complete", mappedFields: ["instruction", "input", "context", "output"], missingRequiredFields: [] },
    fields: [], distributions: { sources: [{ label: source, count: 2 }] },
    counts: { inputRows: 2, acceptedRows: 1, quarantinedRows: 1 }, reasonCounts: { "schema-invalid": 1 },
    samples: [{ sourceArtifactId: source, sourceRowIndex: 1, reasonCodes: ["schema-invalid"], fieldNames: ["output"], summary: "Synthetic rejected row has a missing required value." }],
    reviewRequired: true, approvalAllowed: true,
  };
  const files = {
    "dataset.jsonl": JSON.stringify(accepted) + "\n",
    "train.jsonl": JSON.stringify(accepted) + "\n",
    "report.json": JSON.stringify(qualityReport),
    "review.jsonl": JSON.stringify({ ...accepted, sourceArtifactId: source }) + "\n",
    "quarantine.jsonl": JSON.stringify({ sourceArtifactId: source, sourceRowIndex: 1, reasonCodes: ["schema-invalid"], row: { instruction: "Synthetic incomplete row" } }) + "\n",
  };
  for (const [name, content] of Object.entries(files)) {
    // Fixed names only; never replace staged input or an existing output.
    await writeFile(path.join(root, name), content, { flag: "wx", mode: 0o600 });
  }
  return {
    outputs: [
      { name: "training-dataset", role: "dataset", outputHandle: "dataset.jsonl", mediaType: "application/x-ndjson" },
      { name: "training-dataset-train", role: "train", outputHandle: "train.jsonl", mediaType: "application/x-ndjson", metadata: { rowCount: 1 } },
      { name: "training-dataset-report", role: "report", outputHandle: "report.json", mediaType: "application/json" },
      { name: "training-dataset-review", role: "review", outputHandle: "review.jsonl", mediaType: "application/x-ndjson", metadata: { rowCount: 1, reportFingerprint: fingerprint } },
      { name: "training-dataset-quarantine", role: "quarantine", outputHandle: "quarantine.jsonl", mediaType: "application/x-ndjson" },
    ],
    summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 2, generatedExampleCount: 2, datasetRowCount: 1, trainRowCount: 1, validationRowCount: 0, testRowCount: 0, acceptedRowCount: 1, quarantinedRowCount: 1 },
    qualityReport,
  };
}
