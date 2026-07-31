import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDatasetPreparationAdvancedConfig,
  createDatasetPreparationAdvancedConfigForMethod,
  evaluateDatasetPreparationAdvancedReadiness,
} from "../dataset-preparation-advanced";

describe("dataset preparation advanced profiles", () => {
  it("keeps Standard backward compatible by omitting advanced configuration", () => {
    assert.equal(createDatasetPreparationAdvancedConfig("standard"), undefined);
  });

  it("creates bounded plain-language opt-in profiles", () => {
    const documentProfile = createDatasetPreparationAdvancedConfig(
      "better-document-understanding",
    );
    const generationProfile =
      createDatasetPreparationAdvancedConfig("generate-examples");

    assert.equal(documentProfile?.preset, "better-document-understanding");
    assert.equal(documentProfile?.content?.strategy, "section");
    assert.equal(documentProfile?.content?.ocrEnabled, false);
    assert.equal(documentProfile?.semantic?.enabled, true);
    assert.equal(
      documentProfile?.semantic?.embeddingAlgorithm,
      "hashed-token-v1",
    );
    assert.equal(generationProfile?.preset, "generate-examples");
    assert.equal(generationProfile?.content?.strategy, "semantic");
    assert.equal(generationProfile?.content?.ocrEnabled, false);
    assert.equal(generationProfile?.synthetic?.enabled, true);
    assert.equal(generationProfile?.synthetic?.candidatesPerChunk, 2);
    assert.equal(generationProfile?.synthetic?.requireReview, true);
  });

  it("reports unavailable OCR and model readiness without silent fallback", () => {
    const readiness = evaluateDatasetPreparationAdvancedReadiness({
      preset: "generate-examples",
      generationModelReady: false,
    });

    assert.ok(
      readiness.some(
        (item) =>
          item.capabilityId === "ocr-text" && item.status === "unavailable",
      ),
    );
    assert.ok(
      readiness.some(
        (item) =>
          item.capabilityId === "local-generation-model" &&
          item.status === "model-required",
      ),
    );
  });

  it("creates only method-compatible advanced blocks", () => {
    const fixed = createDatasetPreparationAdvancedConfigForMethod("fixed-length");
    const semantic = createDatasetPreparationAdvancedConfigForMethod("topic-aware");
    const structure = createDatasetPreparationAdvancedConfigForMethod("structure-aware");
    const combined = createDatasetPreparationAdvancedConfigForMethod("combine-and-split");

    assert.equal(fixed, undefined);
    assert.equal(semantic?.content?.strategy, "semantic");
    assert.equal(semantic?.content?.layoutEnabled, undefined);
    assert.equal(structure?.content?.strategy, "layout");
    assert.equal(structure?.content?.semanticBoundaryThreshold, undefined);
    assert.equal(combined, undefined);
  });
});
