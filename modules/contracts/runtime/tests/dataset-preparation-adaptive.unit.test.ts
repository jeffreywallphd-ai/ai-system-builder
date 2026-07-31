import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDatasetPreparationExecutionPlan,
  isDatasetPreparationControlActive,
  normalizeLegacyDatasetPreparationMethod,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationMethodOption,
} from "../dataset-preparation-adaptive";
import { DATASET_PREPARATION_SOURCE_CAPABILITIES } from "../dataset-preparation-capabilities";

const source = (
  format: (typeof DATASET_PREPARATION_SOURCE_CAPABILITIES)[number]["format"],
) => {
  const capability = DATASET_PREPARATION_SOURCE_CAPABILITIES.find(
    (candidate) => candidate.format === format,
  );
  assert.ok(capability);
  return capability;
};

describe("adaptive dataset preparation plans", () => {
  it("treats one or many structured sources as inferred dataset intents without a style menu", () => {
    const single = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-classification",
      sources: [source("parquet")],
    });
    const combined = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-classification",
      sources: [source("csv"), source("jsonl")],
    });

    assert.equal(single.inputIntent, "use-existing-dataset");
    assert.deepEqual(single.methods.map((method) => method.id), [
      "validate-and-split",
    ]);
    assert.equal(combined.inputIntent, "combine-existing-datasets");
    assert.deepEqual(combined.methods.map((method) => method.id), [
      "combine-and-split",
    ]);
  });

  it("offers a two or three method progression for document sources with topic-aware as the default", () => {
    const plainText = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-instruction",
      sources: [source("text")],
    });
    const document = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-instruction",
      sources: [source("markdown"), source("pdf")],
    });

    assert.deepEqual(plainText.methods.map((method) => method.id), [
      "fixed-length",
      "topic-aware",
    ]);
    assert.deepEqual(document.methods.map((method) => method.id), [
      "fixed-length",
      "topic-aware",
      "structure-aware",
    ]);
    assert.equal(document.defaultMethodId, "topic-aware");
  });

  it("exposes only controls consumed by the selected method", () => {
    const resolution = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-reranker",
      sources: [source("markdown")],
    });
    const fixed = resolveDatasetPreparationMethodOption(
      resolution,
      "fixed-length",
    );
    const semantic = resolveDatasetPreparationMethodOption(
      resolution,
      "topic-aware",
    );

    assert.equal(
      isDatasetPreparationControlActive(fixed, "fixed-overlap"),
      true,
    );
    assert.equal(
      isDatasetPreparationControlActive(semantic, "fixed-overlap"),
      false,
    );
    assert.equal(
      isDatasetPreparationControlActive(
        semantic,
        "topic-boundary-sensitivity",
      ),
      true,
    );
  });

  it("keeps generation separate from the document division method", () => {
    const resolution = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-extraction",
      sources: [source("html")],
    });
    const plan = createDatasetPreparationExecutionPlan(
      resolution,
      "structure-aware",
    );

    assert.equal(plan.method, "structure-aware");
    assert.equal(plan.generationMode, "task-examples");
  });

  it("does not offer unsupported automatic boxes or masks", () => {
    for (const taskType of [
      "vision-detection",
      "vision-segmentation",
    ] as const) {
      const resolution = resolveDatasetPreparationAdaptivePlan({
        taskType,
        sources: [source("image")],
      });
      assert.deepEqual(resolution.methods.map((method) => method.id), [
        "use-existing-annotations",
      ]);
    }
  });

  it("fails closed on mixed roles and incompatible requested methods", () => {
    const mixed = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-instruction",
      sources: [source("jsonl"), source("markdown")],
    });
    assert.equal(mixed.status, "unsupported");
    assert.throws(() => createDatasetPreparationExecutionPlan(mixed));

    const document = resolveDatasetPreparationAdaptivePlan({
      taskType: "llm-instruction",
      sources: [source("text")],
    });
    assert.throws(() =>
      createDatasetPreparationExecutionPlan(document, "structure-aware"),
    );
  });

  it("normalizes only known safe legacy combinations", () => {
    assert.equal(
      normalizeLegacyDatasetPreparationMethod({
        taskType: "llm-instruction",
        sourceKinds: ["document"],
        sourceCount: 1,
        preset: "generate-examples",
        textInputMode: "generate",
      }),
      "topic-aware",
    );
    assert.throws(() =>
      normalizeLegacyDatasetPreparationMethod({
        taskType: "vision-detection",
        sourceKinds: ["image"],
        sourceCount: 1,
        textInputMode: "generate",
      }),
    );
    assert.throws(() =>
      normalizeLegacyDatasetPreparationMethod({
        taskType: "llm-instruction",
        sourceKinds: ["structured"],
        sourceCount: 1,
        preset: "better-document-understanding",
      }),
    );
  });
});
