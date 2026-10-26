import { normalizeDatasetId, normalizeDatasetVersionId, type DatasetVersionRecord } from "../../../../../../../modules/contracts/dataset";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { createDefaultDatasetPreparationTaskRecipe, createDatasetPreparationAdvancedConfigForMethod, type DatasetPreparationTaskType } from "../../../../../../../modules/contracts/runtime";
const digest = (letter: string) => `sha256:${letter.repeat(64)}` as const;
export function datasetVersionReplayFixture(taskType: DatasetPreparationTaskType = "llm-instruction", kind: "csv" | "pdf" | "ocr" = "csv") {
  const document = kind !== "csv";
  const source = { artifactId: "source-1", label: document ? "scanned.pdf" : "examples.csv", storageKey: document ? "uploads/scanned.pdf" : "uploads/examples.csv", mediaType: document ? "application/pdf" : "text/csv" };
  const version: DatasetVersionRecord = {
    schemaVersion: "1.0", workspaceId: createWorkspaceId("workspace-a"), versionId: normalizeDatasetVersionId("v1"), datasetId: normalizeDatasetId("training"), versionDigest: digest("a"),
    artifacts: [{ role: "dataset", artifactKey: "prepared/training.jsonl", digest: digest("b"), mediaType: "application/jsonl", sizeBytes: 40, rowCount: 8 }],
    lineage: { sources: [{ sourceArtifactId: source.artifactId, artifactKey: source.storageKey, digest: digest("c"), mediaType: source.mediaType }],
      recipe: { artifactKey: "recipes/training.json", digest: digest("d"), implementationId: "prepare-training-dataset", implementationVersion: "1" },
      quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("e"), reportFingerprint: digest("f") } },
    documentation: { name: "Synthetic test", summary: "Synthetic test only", intendedUses: ["Tests"], limitations: ["Not production data"] }, totalRows: 8, createdAt: "2026-10-25T12:00:00.000Z", createdBy: "fixture",
  };
  const task = createDefaultDatasetPreparationTaskRecipe(taskType); task.textInputMode = document ? "generate" : "provided";
  const recipe: Record<string, any> = { task };
  if (document) {
    recipe.normalization = { targetFormat: "markdown", normalizationMode: "best-effort", unsupportedDocumentPolicy: "fail" };
    recipe.generation = { mode: "qa", model: { provider: "transformers", modelId: "fixture/synthetic-model", inferenceMode: "chat", device: "cpu", torchDtype: "float32", memoryOverflowPolicy: "none" } };
    if (kind === "pdf") recipe.chunking = { strategy: "character", chunkSize: 800, chunkOverlap: 80, preserveDocumentBoundaries: false, maxChunkCount: 100 };
  }
  const snapshot: Record<string, any> = { recipe, split: { trainRatio: 0.7, validationRatio: 0.2, testRatio: 0.1, seed: 17, shuffle: false }, output: { format: "jsonl", naming: { baseName: "Saved setup" } }, effectiveQualityPolicy: { preset: "strict", requireLicenseMetadata: true, requireConsentMetadata: true, includeSourceAttribution: true } };
  if (kind === "ocr") { const advanced = createDatasetPreparationAdvancedConfigForMethod("structure-aware")!; advanced.content = { ...advanced.content!, ocrEnabled: true, ocrLanguage: "en-US" }; snapshot.advanced = advanced; }
  const reproduction = { versionId: version.versionId, sourceArtifactIds: [source.artifactId], recipeSnapshot: snapshot, lineage: JSON.parse(JSON.stringify(version.lineage)) };
  const selection = { workspaceId: "workspace-a", selectedVersion: version, datasetArtifactKey: "prepared/training.jsonl" };
  return { source, version, recipe, snapshot, reproduction, selection };
}
