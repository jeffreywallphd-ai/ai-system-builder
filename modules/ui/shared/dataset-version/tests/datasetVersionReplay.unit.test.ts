import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeDatasetId, normalizeDatasetVersionId, type DatasetVersionRecord } from "../../../../contracts/dataset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  DATASET_PREPARATION_TASK_TYPES,
  createDatasetPreparationAdvancedConfigForMethod,
  createDefaultDatasetPreparationTaskRecipe,
  type DatasetPreparationTaskType,
} from "../../../../contracts/runtime";
import { captureDatasetVersionReplayRequest, projectDatasetVersionReplaySources, validateDatasetVersionReplay, type DatasetVersionReplayContext } from "../datasetVersionReplay";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const copy = <T>(input: T): T => JSON.parse(JSON.stringify(input));
const object = (input: unknown) => input as Record<string, unknown>;
function fixture(taskType: DatasetPreparationTaskType = "llm-instruction", format: "csv" | "pdf" | "image" = "csv") {
  const mediaType = format === "csv" ? "text/csv" : format === "pdf" ? "application/pdf" : "image/png";
  const sourceKey = `sources/example.${format === "image" ? "png" : format}`;
  const version: DatasetVersionRecord = {
    schemaVersion: "1.0", versionId: normalizeDatasetVersionId("v1"), datasetId: normalizeDatasetId("training"),
    workspaceId: createWorkspaceId("workspace-a"), versionDigest: digest("a"),
    artifacts: [{ role: "dataset", artifactKey: "prepared/training.jsonl", digest: digest("b"), mediaType: "application/jsonl", sizeBytes: 40, rowCount: 8 }],
    lineage: {
      sources: [{ sourceArtifactId: "source-1", artifactKey: sourceKey, digest: digest("c"), mediaType }],
      recipe: { artifactKey: "recipes/training.json", digest: digest("d"), implementationId: "prepare-training-dataset", implementationVersion: "1" },
      quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("e"), reportFingerprint: digest("f") },
    },
    documentation: { name: "Synthetic training", summary: "Synthetic test only", intendedUses: ["Tests"], limitations: ["Not production data"] },
    totalRows: 8, createdAt: "2026-10-25T12:00:00.000Z", createdBy: "test-person",
  };
  const task = createDefaultDatasetPreparationTaskRecipe(taskType);
  task.textInputMode = format === "pdf" ? "generate" : "provided";
  const recipe: Record<string, unknown> = { task };
  if (format === "pdf") {
    recipe.normalization = { targetFormat: "markdown" };
    recipe.chunking = { strategy: "character", chunkSize: 800, chunkOverlap: 80 };
    recipe.generation = { mode: "qa", model: { provider: "transformers", modelId: "fixture/synthetic-model", inferenceMode: "chat", device: "cpu", torchDtype: "float32", memoryOverflowPolicy: "none" } };
  }
  const snapshot: Record<string, unknown> = { recipe, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "jsonl", naming: { baseName: "Training data" } } };
  const reproduction: Record<string, unknown> = { versionId: "v1", sourceArtifactIds: ["source-1"], recipeSnapshot: snapshot, lineage: copy(version.lineage) };
  const context: DatasetVersionReplayContext = {
    workspaceId: "workspace-a", selectedVersion: version, requestedVersionId: "v1", expectedDatasetId: "training", datasetArtifactKey: "prepared/training.jsonl",
    sources: { status: "ready", workspaceId: "workspace-a", items: [{ artifactId: "source-1", storageKey: sourceKey, label: `example.${format === "image" ? "png" : format}`, mediaType }] },
  };
  return { version, recipe, snapshot, reproduction, context };
}
type Fixture = ReturnType<typeof fixture>;
function pass(value: Fixture) {
  const result = validateDatasetVersionReplay(value.reproduction, value.context);
  if (!result.ok) assert.fail(result.message);
  return result.value;
}
function deny(value: Fixture, code = "unsupported-settings") {
  const result = validateDatasetVersionReplay(value.reproduction, value.context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected complete denial");
  assert.equal(result.code, code);
  assert.equal("value" in result, false);
  assert.equal(result.message.includes("fixture/synthetic-model"), false);
  return result;
}
for (const type of DATASET_PREPARATION_TASK_TYPES) {
  test(`replays the complete current structured ${type} producer snapshot`, () => {
    const value = fixture(type), before = copy(value);
    const result = pass(value);
    assert.equal(result.recipe.task.taskType, type);
    assert.equal(result.recipe.task.textInputMode, "provided");
    assert.equal(result.preparation.method, "validate-and-split");
    assert.equal(result.recipe.generation, undefined);
    assert.deepEqual(result.split, { trainRatio: 0.8, validationRatio: 0, testRatio: 0.2, shuffle: true });
    assert.deepEqual(result.quality, { preset: "recommended", requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: false });
    assert.deepEqual(value, before);
  });
}
for (const type of DATASET_PREPARATION_TASK_TYPES.filter((entry) => entry.startsWith("llm-"))) {
  test(`replays fixed PDF sections and task defaults for ${type}`, () => {
    const result = pass(fixture(type, "pdf"));
    assert.equal(result.preparation.method, "fixed-length");
    assert.equal(result.recipe.generation?.model.memoryMode, "standard");
    assert.equal(result.recipe.generation?.structuredOutput?.constrainedDecoding, false);
    assert.ok(result.recipe.generation?.promptTemplate);
    assert.equal(result.recipe.chunking?.preserveDocumentBoundaries, true);
  });
}
for (const method of ["topic-aware", "structure-aware"] as const) {
  test(`replays current ${method} settings without a persisted execution plan`, () => {
    const value = fixture("llm-instruction", "pdf");
    delete value.recipe.chunking;
    value.snapshot.advanced = createDatasetPreparationAdvancedConfigForMethod(method);
    const result = pass(value);
    assert.equal(result.preparation.method, method);
    assert.equal(result.advanced?.synthetic?.candidatesPerChunk, 2);
    assert.equal(result.recipe.generation?.maxExamplesPerChunk, undefined);
    assert.equal(result.recipe.chunking, undefined);
  });
}
test("replays OCR choice as configuration without claiming installed language readiness", () => {
  const value = fixture("llm-instruction", "pdf");
  delete value.recipe.chunking;
  const advanced = createDatasetPreparationAdvancedConfigForMethod("structure-aware")!;
  advanced.content = { ...advanced.content!, ocrEnabled: true, ocrLanguage: "en-US" };
  value.snapshot.advanced = advanced;
  const result = pass(value);
  assert.equal(result.advanced?.content?.ocrLanguage, "en-US");
  assert.equal("ready" in result, false);
});
test("requires the exact canonical explicit plan when supplied", () => {
  const value = fixture("llm-instruction", "pdf");
  value.snapshot.preparation = pass(value).preparation;
  pass(value);
  value.snapshot.preparation = { ...object(value.snapshot.preparation), generationMode: "none" };
  deny(value);
});
test("uses an explicitly supported legacy recipe with omitted task only", () => {
  const value = fixture("llm-instruction", "pdf");
  delete value.recipe.task;
  const result = pass(value);
  assert.equal(result.recipe.task.taskType, "llm-instruction");
});
for (const type of ["diffusion-lora", "vision-classification", "vision-detection", "vision-segmentation"] as const) {
  test(`replays existing image metadata or annotations for ${type}`, () => {
    const value = fixture(type, "image");
    assert.equal(pass(value).preparation.method, type === "vision-detection" || type === "vision-segmentation" ? "use-existing-annotations" : "use-source-metadata");
  });
}
test("returns a deeply frozen independent value and no provider or approval authority", () => {
  const value = fixture("llm-instruction", "pdf");
  value.snapshot.effectiveQualityPolicy = { preset: "strict", requireLicenseMetadata: true, requireConsentMetadata: true, includeSourceAttribution: true, policyId: "historical-not-authority", mandatoryChecks: { ignoredIdentity: true } };
  const result = pass(value);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.recipe.generation!.structuredOutput!.visualShape));
  assert.deepEqual(Object.keys(result.quality).sort(), ["includeSourceAttribution", "preset", "requireConsentMetadata", "requireLicenseMetadata"].sort());
  object(value.recipe.task).inputField = "later-edit";
  assert.equal(result.recipe.task.taskType === "llm-instruction" && result.recipe.task.inputField, "input");
  assert.equal("destinations" in result.output, false);
});
test("accepts a complete-dataset association even when another dataset artifact has a different key", () => {
  const value = fixture();
  value.context = { ...value.context, selectedVersion: { ...value.version, artifacts: [...value.version.artifacts, { ...value.version.artifacts[0], artifactKey: "prepared/other.jsonl" }] } };
  pass(value);
});

const denials: [string, (value: Fixture) => void, string?][] = [
  ["foreign workspace", (v) => { v.context = { ...v.context, workspaceId: "workspace-b" }; }],
  ["foreign expected dataset", (v) => { v.context = { ...v.context, expectedDatasetId: "other" }; }],
  ["foreign requested version", (v) => { v.context = { ...v.context, requestedVersionId: "v2" }; }],
  ["foreign reproduction version", (v) => { v.reproduction.versionId = "v2"; }],
  ["wrong dataset artifact", (v) => { v.context = { ...v.context, datasetArtifactKey: "prepared/missing.jsonl" }; }],
  ["substituted lineage", (v) => { object(object(v.reproduction.lineage).recipe).digest = digest("e"); }],
  ["missing lineage source id", (v) => { delete object((object(v.reproduction.lineage).sources as unknown[])[0]).sourceArtifactId; }],
  ["missing source list", (v) => { v.reproduction.sourceArtifactIds = []; }, "sources-unavailable"],
  ["duplicate source id", (v) => { v.reproduction.sourceArtifactIds = ["source-1", "source-1"]; }, "sources-unavailable"],
  ["substituted source id", (v) => { v.reproduction.sourceArtifactIds = ["other"]; }, "sources-unavailable"],
  ["loading source list", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, status: "loading" } }; }, "sources-unavailable"],
  ["failed source list", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, status: "failed" } }; }, "sources-unavailable"],
  ["foreign source scope", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, workspaceId: "workspace-b" } }; }, "sources-unavailable"],
  ["missing ready source", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, items: [] } }; }, "sources-unavailable"],
  ["duplicate source match", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, items: [v.context.sources.items[0], v.context.sources.items[0]] } }; }, "sources-unavailable"],
  ["same name different source key", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, items: [{ ...v.context.sources.items[0], storageKey: "sources/substitute.csv" }] } }; }, "sources-unavailable"],
  ["changed source capability", (v) => { v.context = { ...v.context, sources: { ...v.context.sources, items: [{ ...v.context.sources.items[0], label: "example.png", mediaType: "image/png" }] } }; }, "sources-unavailable"],
  ["operation-only snapshot", (v) => { v.reproduction.recipeSnapshot = { split: { seed: 42 }, output: { format: "jsonl" } }; }, "not-reusable"],
  ["unknown task", (v) => { object(v.recipe.task).taskType = "unknown"; }],
  ["unknown explicit text mode", (v) => { object(v.recipe.task).textInputMode = "sometimes"; }],
  ["incompatible task mode", (v) => { object(v.recipe.task).textInputMode = "provided"; }],
  ["unknown task field", (v) => { object(v.recipe.task).other = true; }],
  ["unsafe task field", (v) => { object(v.recipe.task).inputField = "__proto__"; }],
  ["unrepresentable custom field mapping", (v) => { object(v.recipe.task).inputField = "custom-input"; }],
  ["unrepresentable prompt style", (v) => { object(v.recipe.task).promptStyle = "chat-messages"; }],
  ["unrepresentable context policy", (v) => { object(v.recipe.task).sourceContextPolicy = "omit"; }],
  ["invalid task boolean", (v) => { v.recipe.task = { taskType: "llm-classification", multiLabel: "false" }; }],
  ["duplicate labels", (v) => { v.recipe.task = { taskType: "llm-classification", labelSet: ["one", "one"] }; }],
  ["unrepresentable comma in a label", (v) => { v.recipe.task = { taskType: "llm-classification", labelSet: ["one,two"] }; }],
  ["unknown preset", (v) => { v.snapshot.advanced = { preset: "future-provider" }; }],
  ["unknown output", (v) => { object(v.snapshot.output).format = "xml"; }],
  ["old publication destination", (v) => { object(v.snapshot.output).destinations = { huggingFace: { enabled: true } }; }],
  ["unsafe save name", (v) => { object(v.snapshot.output).naming = { baseName: "../unsafe" }; }],
  ["numeric string ratio", (v) => { object(v.snapshot.split).trainRatio = "0.8"; }],
  ["incorrect split sum", (v) => { object(v.snapshot.split).trainRatio = 0.9; }],
  ["zero training ratio", (v) => { v.snapshot.split = { trainRatio: 0, testRatio: 1 }; }],
  ["no held-out portion", (v) => { v.snapshot.split = { trainRatio: 1, testRatio: 0 }; }],
  ["invalid shuffle", (v) => { object(v.snapshot.split).shuffle = "yes"; }],
  ["fractional seed", (v) => { object(v.snapshot.split).seed = 2.5; }],
  ["missing normalization", (v) => { delete v.recipe.normalization; }],
  ["unknown normalization format", (v) => { object(v.recipe.normalization).targetFormat = "html"; }],
  ["invalid normalization enum", (v) => { object(v.recipe.normalization).normalizationMode = "lenient"; }],
  ["missing fixed chunking", (v) => { delete v.recipe.chunking; }],
  ["invalid chunk overlap", (v) => { object(v.recipe.chunking).chunkOverlap = 800; }],
  ["fractional chunk size", (v) => { object(v.recipe.chunking).chunkSize = 800.1; }],
  ["unknown chunk strategy", (v) => { object(v.recipe.chunking).strategy = "future"; }],
  ["invalid boundary boolean", (v) => { object(v.recipe.chunking).preserveDocumentBoundaries = "true"; }],
  ["missing required generation", (v) => { delete v.recipe.generation; }],
  ["unknown model provider", (v) => { object(object(v.recipe.generation).model).provider = "remote"; }],
  ["unknown memory mode", (v) => { object(object(v.recipe.generation).model).memoryMode = "unlimited"; }],
  ["invalid overflow", (v) => { object(object(v.recipe.generation).model).memoryOverflowPolicy = "unlimited"; }],
  ["unsupported image generation", (v) => { object(object(v.recipe.generation).model).inferenceMode = "text-to-image"; }],
  ["unrepresentable omitted inference mode", (v) => { delete object(object(v.recipe.generation).model).inferenceMode; }],
  ["invalid precision", (v) => { object(object(v.recipe.generation).model).torchDtype = "int8"; }],
  ["invalid device", (v) => { object(object(v.recipe.generation).model).device = "remote"; }],
  ["zero batch", (v) => { object(v.recipe.generation).batchSize = 0; }],
  ["invalid token count", (v) => { object(v.recipe.generation).generationParams = { maxNewTokens: 0 }; }],
  ["invalid topP", (v) => { object(v.recipe.generation).generationParams = { topP: 1.1 }; }],
  ["negative temperature", (v) => { object(v.recipe.generation).generationParams = { temperature: -1 }; }],
  ["invalid constrained flag", (v) => { object(v.recipe.generation).structuredOutput = { constrainedDecoding: "false" }; }],
  ["invalid visual shape", (v) => { object(v.recipe.generation).structuredOutput = { visualShape: { schemaVersion: "unknown" } }; }],
  ["oversized prompt", (v) => { object(v.recipe.generation).promptTemplate = "x".repeat(8001); }],
  ["oversized recipe", (v) => { v.snapshot.effectiveQualityPolicy = { unused: "x".repeat(512 * 1024) }; }],
  ["infinite number", (v) => { object(v.snapshot.split).seed = Infinity; }],
  ["NaN number", (v) => { object(v.snapshot.split).seed = NaN; }],
  ["prototype key", (v) => { object(v.recipe.task).nested = JSON.parse('{"__proto__":{"polluted":true}}'); }],
  ["non-JSON date", (v) => { v.snapshot.effectiveQualityPolicy = new Date(); }],
  ["circular data", (v) => { v.snapshot.circular = v.snapshot; }],
  ["invalid quality choice", (v) => { v.snapshot.effectiveQualityPolicy = { preset: "none" }; }],
  ["invalid quality boolean", (v) => { v.snapshot.effectiveQualityPolicy = { requireConsentMetadata: "false" }; }],
  ["null task enum", (v) => { object(v.recipe.task).promptStyle = null; }],
  ["null overflow enum", (v) => { object(object(v.recipe.generation).model).memoryOverflowPolicy = null; }],
  ["null validation ratio", (v) => { object(v.snapshot.split).validationRatio = null; }],
  ["null model device", (v) => { object(object(v.recipe.generation).model).device = null; }],
  ["null generation count", (v) => { object(v.recipe.generation).batchSize = null; }],
  ["null generation temperature", (v) => { object(v.recipe.generation).generationParams = { temperature: null }; }],
  ["null visual shape", (v) => { object(v.recipe.generation).structuredOutput = { visualShape: null }; }],
  ["null normalization enum", (v) => { object(v.recipe.normalization).normalizationMode = null; }],
  ["null quality enum", (v) => { v.snapshot.effectiveQualityPolicy = { preset: null }; }],
];
for (const [name, change, code] of denials) test(`denies ${name} with fixed copy and no partial value`, () => {
  const value = fixture("llm-instruction", "pdf");
  change(value);
  deny(value, code);
});
for (const [name, change] of [
  ["invalid OCR boolean", (v: Record<string, unknown>) => { object(v.content).ocrEnabled = "false"; }],
  ["missing OCR language", (v: Record<string, unknown>) => { delete object(v.content).ocrLanguage; }],
  ["invalid OCR language", (v: Record<string, unknown>) => { object(v.content).ocrLanguage = " en-US "; }],
  ["disabled layout", (v: Record<string, unknown>) => { object(v.content).layoutEnabled = false; }],
  ["wrong content strategy", (v: Record<string, unknown>) => { object(v.content).strategy = "semantic"; }],
  ["wrong preset", (v: Record<string, unknown>) => { v.preset = "topic-aware"; }],
  ["unsupported semantic policy", (v: Record<string, unknown>) => { object(v.semantic).hardNegativeMining = false; }],
  ["unsupported critic policy", (v: Record<string, unknown>) => { object(v.synthetic).requireReview = false; }],
] as const) test(`denies ${name} even with an explicit correct plan`, () => {
  const value = fixture("llm-instruction", "pdf");
  delete value.recipe.chunking;
  const advanced = createDatasetPreparationAdvancedConfigForMethod("structure-aware")!;
  advanced.content = { ...advanced.content!, ocrEnabled: true, ocrLanguage: "en-US" };
  value.snapshot.advanced = advanced;
  value.snapshot.preparation = pass(value).preparation;
  change(object(value.snapshot.advanced));
  deny(value);
});

test("projects a matching source after a large unrelated catalogue without mutating rows", () => {
  const value = fixture(), source = { ...value.context.sources.items[0] };
  const rows = Array.from({ length: 4096 }, (_, index) => ({ ...source, artifactId: `unrelated-${index}` }));
  const result = projectDatasetVersionReplaySources(value.version, [...rows, source]);
  assert.deepEqual(result, [source]);
  assert.notEqual(result?.[0], source);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result?.[0]), true);
  value.context = { ...value.context, sources: { ...value.context.sources, items: result! } };
  pass(value);
});

test("captures complete bounded saved meaning before an asynchronous source lookup", () => {
  const value = fixture(), selection = { workspaceId: value.context.workspaceId, selectedVersion: value.version, datasetArtifactKey: value.context.datasetArtifactKey };
  const captured = captureDatasetVersionReplayRequest(value.reproduction, selection)!;
  assert.ok(captured); assert.deepEqual(captured.sources, [{ artifactId: "source-1", storageKey: "sources/example.csv" }]);
  object(value.snapshot.output).format = "csv"; value.reproduction.sourceArtifactIds = ["changed"]; selection.datasetArtifactKey = "other/file.jsonl";
  assert.equal(captured.selection.datasetArtifactKey, "prepared/training.jsonl");
  assert.deepEqual(captured.reproduction.sourceArtifactIds, ["source-1"]);
  const result = validateDatasetVersionReplay(captured.reproduction, { ...value.context, selectedVersion: captured.selection.selectedVersion });
  assert.equal(result.ok, true); assert.equal(Object.isFrozen(captured.reproduction.recipeSnapshot), true); assert.equal(Object.isFrozen(captured.sources[0]), true);
});
for (const mode of ["accessor", "large", "wrong-workspace", "wrong-version", "wrong-file", "changed-lineage", "duplicate-id"] as const) test(`capture denies ${mode} before metadata I/O`, () => {
  const value = fixture(), selection = { workspaceId: value.context.workspaceId, selectedVersion: value.version, datasetArtifactKey: value.context.datasetArtifactKey }; let called = 0;
  if (mode === "accessor") Object.defineProperty(selection, "selectedVersion", { enumerable: true, get() { ++called; throw new Error("Must not execute"); } });
  if (mode === "large") value.reproduction.recipeSnapshot = { value: "x".repeat(1024 * 1024) };
  if (mode === "wrong-workspace") selection.workspaceId = "workspace-b";
  if (mode === "wrong-version") value.reproduction.versionId = "other";
  if (mode === "wrong-file") selection.datasetArtifactKey = "other/file.jsonl";
  if (mode === "changed-lineage") object(value.reproduction.lineage).sources = [];
  if (mode === "duplicate-id") value.reproduction.sourceArtifactIds = ["source-1", "source-1"];
  assert.equal(captureDatasetVersionReplayRequest(value.reproduction, selection), undefined); assert.equal(called, 0);
});

test("preserves every matching duplicate and order including a late wrong-key or incompatible row", () => {
  const value = fixture(), source = value.context.sources.items[0];
  const duplicate = { ...source, storageKey: "other/file.bin", label: "file.bin", mediaType: "application/octet-stream" };
  const rows = [source, ...Array.from({ length: 300 }, (_, index) => ({ ...source, artifactId: `other-${index}` })), duplicate];
  const result = projectDatasetVersionReplaySources(value.version, rows);
  assert.deepEqual(result, [source, duplicate]);
  value.context = { ...value.context, sources: { ...value.context.sources, items: result! } };
  deny(value, "sources-unavailable");
});

test("retains the exact256 match bound and refuses an oversized result as a whole", () => {
  const value = fixture(), source = value.context.sources.items[0];
  assert.equal(projectDatasetVersionReplaySources(value.version, Array(256).fill(source))?.length, 256);
  assert.equal(projectDatasetVersionReplaySources(value.version, Array(257).fill(source)), undefined);
  assert.deepEqual(projectDatasetVersionReplaySources(value.version, [{ ...source, artifactId: "other" }]), []);
});

for (const kind of ["selected-version", "array-entry", "artifact-id", "storage-key", "label", "media-type"] as const) test(`projection rejects ${kind} accessors without calling them`, () => {
  const value = fixture(), source = { ...value.context.sources.items[0] }; let called = 0;
  const getter = () => { called += 1; throw new Error("Must not execute"); };
  const rows = [source];
  if (kind === "selected-version") Object.defineProperty(value.version, "lineage", { get: getter, enumerable: true });
  else if (kind === "array-entry") Object.defineProperty(rows, "0", { get: getter, enumerable: true });
  else Object.defineProperty(source, ({ "artifact-id": "artifactId", "storage-key": "storageKey", label: "label", "media-type": "mediaType" })[kind], { get: getter, enumerable: true });
  assert.equal(projectDatasetVersionReplaySources(value.version, rows), undefined);
  assert.equal(called, 0);
});

test("projection rejects sparse rows and malformed records without inferring missing sources", () => {
  const value = fixture();
  assert.equal(projectDatasetVersionReplaySources(value.version, Array(2)), undefined);
  assert.equal(projectDatasetVersionReplaySources({ versionId: "v1" }, value.context.sources.items), undefined);
});
test("never invokes an accessor in saved JSON", () => {
  const value = fixture();
  let reads = 0;
  Object.defineProperty(value.recipe, "generation", { enumerable: true, get: () => { ++reads; throw new Error("private path and prompt"); } });
  deny(value);
  assert.equal(reads, 0);
});
test("preserves canonical normalization of lineage hashes without changing source identity", () => {
  const value = fixture();
  object(object(value.reproduction.lineage).recipe).digest = digest("D");
  pass(value);
});
test("restores explicit bounded offload configuration without granting runtime admission", () => {
  const value = fixture("llm-instruction", "pdf");
  object(object(value.recipe.generation).model).memoryMode = "offload-v1";
  assert.equal(pass(value).recipe.generation?.model.memoryMode, "offload-v1");
  object(object(value.recipe.generation).model).device = "auto";
  deny(value);
});
test("supports the actual thin-client structured-output duplicate form values", () => {
  const value = fixture("llm-instruction", "pdf");
  delete object(value.recipe.generation).model;
  object(value.recipe.generation).model = { provider: "transformers", modelId: "fixture/synthetic-model", inferenceMode: "chat", device: "cpu", torchDtype: "float32" };
  object(value.recipe.generation).failurePolicy = "skip";
  object(value.recipe.generation).structuredOutput = {
    constrainedDecoding: false, promptTemplate: "", memoryMode: "standard",
    localModel: { modelId: "fixture/synthetic-model", device: "cpu", torchDtype: "float32" },
  };
  const result = pass(value);
  assert.equal(result.recipe.generation?.model.memoryOverflowPolicy, "none");
  assert.equal(result.recipe.generation?.batchSize, 1);
  assert.deepEqual(result.recipe.generation?.generationParams, { maxNewTokens: 256 });
  assert.deepEqual(Object.keys(result.recipe.generation!.structuredOutput!).sort(), ["constrainedDecoding", "visualShape"]);
  object(object(value.recipe.generation).structuredOutput).memoryMode = "offload-v1";
  deny(value);
});
test("uses actual strict worker omission defaults and preserves absent sampling", () => {
  const value = fixture("llm-instruction", "pdf");
  const result = pass(value);
  assert.equal(result.recipe.normalization?.normalizationMode, "strict");
  assert.equal(result.recipe.generation?.failurePolicy, "fail");
  assert.equal(result.recipe.generation?.batchSize, 1);
  assert.deepEqual(result.recipe.generation?.generationParams, { maxNewTokens: 256 });
  object(value.recipe.normalization).normalizationMode = "best-effort";
  assert.equal(pass(value).recipe.generation?.failurePolicy, "skip");
  delete object(value.snapshot.split).shuffle;
  assert.equal(pass(value).split.shuffle, false);
});
test("preserves explicit generation values instead of host defaults", () => {
  const value = fixture("llm-instruction", "pdf");
  Object.assign(object(value.recipe.generation), { batchSize: 3, maxExamplesPerChunk: 2, failurePolicy: "skip", generationParams: { maxNewTokens: 400, temperature: 0.25, topP: 0.7 } });
  const result = pass(value).recipe.generation!;
  assert.equal(result.batchSize, 3);
  assert.equal(result.failurePolicy, "skip");
  assert.equal(result.maxExamplesPerChunk, 2);
  assert.deepEqual(result.generationParams, { maxNewTokens: 400, temperature: 0.25, topP: 0.7 });
});
test("combines multiple exact ordered source identities and denies reordering", () => {
  const value = fixture();
  const sources = [...value.version.lineage.sources, { ...value.version.lineage.sources[0], sourceArtifactId: "source-2", artifactKey: "sources/second.csv", digest: digest("e") }];
  value.context = { ...value.context, selectedVersion: { ...value.version, lineage: { ...value.version.lineage, sources } }, sources: { ...value.context.sources, items: [...value.context.sources.items, { ...value.context.sources.items[0], artifactId: "source-2", storageKey: "sources/second.csv" }] } };
  value.reproduction.lineage = copy(value.context.selectedVersion.lineage);
  value.reproduction.sourceArtifactIds = ["source-1", "source-2"];
  assert.equal(pass(value).preparation.method, "combine-and-split");
  value.reproduction.sourceArtifactIds = ["source-2", "source-1"];
  deny(value, "sources-unavailable");
});
test("rejects advanced numeric null instead of selecting a default", () => {
  const value = fixture("llm-instruction", "pdf");
  value.snapshot.advanced = createDatasetPreparationAdvancedConfigForMethod("topic-aware");
  object(object(value.snapshot.advanced).content).maxTokensPerChunk = null;
  deny(value);
});
test("rejects an oversized source projection before trying source resolution", () => {
  const value = fixture();
  value.context = { ...value.context, sources: { ...value.context.sources, items: Array(257).fill(value.context.sources.items[0]) } };
  deny(value, "sources-unavailable");
});
test("does not change the meaning of unrepresentable historical advanced recipes", () => {
  const value = fixture("llm-instruction", "pdf");
  value.snapshot.advanced = { preset: "better-document-understanding", content: { strategy: "section", maxTokensPerChunk: 320, maxSourceSpans: 10000, semanticBoundaryThreshold: 0.22, layoutEnabled: true, ocrEnabled: false }, semantic: { enabled: true, embeddingAlgorithm: "hashed-token-v1", similarityThreshold: 0.9, maxComparisonsPerRow: 128, hardNegativeMining: true } };
  deny(value);
});
for (const type of ["diffusion-lora", "vision-classification"] as const) test(`replays model-assisted image metadata for ${type}`, () => {
  const value = fixture(type, "image");
  object(value.recipe.task).textInputMode = "generate";
  value.recipe.generation = fixture("llm-instruction", "pdf").recipe.generation;
  assert.equal(pass(value).preparation.method, "model-assisted-metadata");
});
for (const [name, change] of [
  ["conflicting duplicate prompt", (s: Record<string, unknown>) => { s.promptTemplate = "different"; }],
  ["invalid duplicate memory mode", (s: Record<string, unknown>) => { s.memoryMode = null; }],
  ["conflicting duplicate model", (s: Record<string, unknown>) => { s.localModel = { modelId: "other/model" }; }],
  ["conflicting duplicate device", (s: Record<string, unknown>) => { s.localModel = { device: "cuda" }; }],
  ["conflicting duplicate dtype", (s: Record<string, unknown>) => { s.localModel = { torchDtype: "float16" }; }],
  ["unknown duplicate model authority", (s: Record<string, unknown>) => { s.localModel = { adapterRevision: "external" }; }],
] as const) test(`denies ${name}`, () => {
  const value = fixture("llm-instruction", "pdf");
  const structured: Record<string, unknown> = {};
  object(value.recipe.generation).structuredOutput = structured;
  change(structured);
  deny(value);
});
