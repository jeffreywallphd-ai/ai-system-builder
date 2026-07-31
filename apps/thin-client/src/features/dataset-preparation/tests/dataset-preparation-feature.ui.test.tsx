// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("thin DatasetPreparationFeature", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("uses four ordered steps and creates a three-way dataset without advanced changes", async () => {
    const start = vi.fn(async () => ({
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      accepted: true as const,
      status: "queued" as const,
    }));
    const approvedResult = {
      outputs: {
        local: {
          dataset: {
            sourceKind: "runtime",
            storage: { key: "datasets/prepared.parquet" },
          },
        },
      },
      provenance: {},
      summary: {
        sourceDocumentCount: 1,
        normalizedDocumentCount: 1,
        skippedDocumentCount: 0,
        chunkCount: 4,
        generatedExampleCount: 10,
        datasetRowCount: 10,
        trainRowCount: 8,
        validationRowCount: 1,
        testRowCount: 1,
      },
      warnings: [],
    };
    const qualityReport = {
      schemaVersion: "1" as const,
      status: "needs-attention" as const,
      reportFingerprint: "a".repeat(64),
      policy: {
        policyId: "workspace-default",
        revision: "1",
        scope: "workspace" as const,
        preset: "recommended" as const,
        allowedLanguages: ["en"],
        requireLicenseMetadata: false,
        requireConsentMetadata: false,
        excludedBenchmarkIds: [],
        maxRowsPerSource: 100_000,
        minimumTextCharacters: 1,
        maximumTextCharacters: 100_000,
        fuzzyDuplicateSimilarity: 0.9,
        maxFuzzyCandidatesPerRow: 100,
        maxReportSamplesPerReason: 3,
        mandatoryChecks: {
          sourceAssociation: true as const,
          schema: true as const,
          exactDuplicates: true as const,
          fuzzyDuplicates: true as const,
          sensitivePersonalData: true as const,
          secretLikeContent: true as const,
          splitLeakage: true as const,
        },
      },
      mapping: {
        taskType: "llm-instruction",
        status: "complete" as const,
        mappedFields: ["prompt", "response"],
        missingRequiredFields: [],
      },
      fields: [],
      distributions: { sources: [] },
      counts: { inputRows: 11, acceptedRows: 10, quarantinedRows: 1 },
      reasonCounts: { "exact-duplicate": 1 },
      samples: [],
      reviewRequired: true,
      approvalAllowed: true,
    };
    const read = vi.fn(async () => ({
      requestId: "task-1",
      status: "review-required" as const,
      result: {
        outputs: {
          local: {
            report: {
              sourceKind: "runtime",
              storage: { key: "datasets/report.json" },
            },
          },
        },
        provenance: {},
        summary: approvedResult.summary,
        qualityReport,
        advancedReport: {
          schemaVersion: "1" as const,
          preset: "better-document-understanding" as const,
          capabilities: [],
          content: {
            strategy: "section" as const,
            algorithmVersion: "section-v1",
            sourceSpanCount: 7,
            lowConfidenceSourceCount: 0,
            meanExtractionQuality: 0.96,
          },
          semantic: {
            embeddingAlgorithm: "hashed-token-v1" as const,
            algorithmVersion: "semantic-curation-v1",
            similarityThreshold: 0.92,
            comparedPairCount: 8,
            duplicateRowCount: 1,
            coverageScore: 0.88,
            sourceCapRejectedRowCount: 0,
            balancingRecommendationCount: 0,
            hardNegativeRecommendationCount: 2,
            reviewExamples: [],
          },
        },
        review: {
          state: "review-required" as const,
          reportFingerprint: qualityReport.reportFingerprint,
          approvalAllowed: true,
        },
        warnings: [],
      },
    }));
    const approve = vi.fn(async () => ({
      requestId: "task-1",
      taskType: "prepare-training-dataset" as const,
      status: "succeeded" as const,
      result: approvedResult,
    }));
    const readPreparedReviewPage = vi.fn(async () => ({
      lineId: "reason:exact-duplicate" as const,
      page: 0,
      pageSize: 10 as const,
      totalRows: 1,
      rows: [
        {
          rowIndex: 3,
          rowFingerprint: `sha256:${"b".repeat(64)}` as const,
          values: {
            instruction: "Summarize the policy.",
            output: "The duplicate prepared response.",
            reasonCodes: ["exact-duplicate"],
          },
        },
      ],
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          workspaceId="workspace-a"
          artifactClient={
            {
              browseArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  storageKey: "uploads/examples.jsonl",
                  originalName: "examples.jsonl",
                  artifactFamily: "dataset",
                  mediaType: "application/x-ndjson",
                },
                {
                  artifactId: "artifact-2",
                  storageKey: "uploads/legacy.xls",
                  originalName: "legacy.xls",
                  artifactFamily: "dataset",
                  mediaType: "application/vnd.ms-excel",
                },
              ],
            } as any
          }
          preparationClient={
            {
              start,
              read,
              cancel: vi.fn(),
              approve,
              readPreparedReviewPage,
            } as any
          }
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[role="list"]')?.getAttribute("aria-label"),
    ).toBe("Dataset preparation workflow");
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    expect(container.textContent).toContain("Add data");
    expect(container.textContent).toContain("Check data");
    expect(container.textContent).toContain("Prepare dataset");
    expect(container.textContent).toContain("Training goal");
    expect(container.textContent).toContain("Review and create");
    expect(container.textContent).toContain("Advanced settings");
    expect(container.textContent).toContain("examples.jsonl");
    expect(container.textContent).not.toContain("legacy.xls");
    expect(container.textContent).not.toContain(
      "Scanned-image text recognition is not included",
    );

    await act(async () => {
      (
        container?.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click();
    });
    expect(container.textContent).toContain("Use one existing dataset");
    expect(container.textContent).toContain("Check and divide this dataset");
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Run checks and prepare",
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-a",
        command: expect.objectContaining({
          sourceArtifactIds: ["artifact-1"],
          preparation: {
            schemaVersion: "1",
            inputIntent: "use-existing-dataset",
            method: "validate-and-split",
            sourceKinds: ["structured"],
            generationMode: "none",
          },
          split: {
            trainRatio: 0.8,
            validationRatio: 0.1,
            testRatio: 0.1,
            shuffle: true,
          },
          quality: {
            policy: expect.objectContaining({ preset: "recommended" }),
            reviewRequired: true,
          },
        }),
      }),
    );
    expect(start.mock.calls[0][0].command.advanced).toBeUndefined();
    expect(start.mock.calls[0][0].command.recipe.normalization).toBeUndefined();
    expect(start.mock.calls[0][0].command.recipe.chunking).toBeUndefined();
    expect(start.mock.calls[0][0].command.recipe.generation).toBeUndefined();
    expect(container.textContent).toContain("Check results");
    expect(container.textContent).toContain("Exact duplicates");
    expect(container.textContent).toContain("Preparation checks");
    expect(container.textContent).toContain("Source sections kept");
    expect(container.textContent).toContain("Source coverage");
    expect(container.textContent).not.toContain("Dataset ready");

    const reviewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Exact duplicates"),
    ) as HTMLButtonElement;
    await act(async () => {
      reviewButton.click();
      await Promise.resolve();
    });
    expect(readPreparedReviewPage).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      requestId: "task-1",
      reportFingerprint: qualityReport.reportFingerprint,
      lineId: "reason:exact-duplicate",
      page: 0,
    });
    expect(document.body.textContent).toContain(
      "The duplicate prepared response.",
    );

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve and save dataset",
    ) as HTMLButtonElement;
    await act(async () => {
      approveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(approve).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      requestId: "task-1",
      reportFingerprint: qualityReport.reportFingerprint,
    });
    expect(container.textContent).toContain("Dataset ready");
    expect(container.textContent).toContain("datasets/prepared.parquet");
  });

  it("infers source material, uses the topic-aware default, and locks controls while starting", async () => {
    let resolveStart:
      | ((value: {
          requestId: string;
          taskType: string;
          accepted: true;
          status: "queued";
        }) => void)
      | undefined;
    const start = vi.fn(
      () =>
        new Promise<{
          requestId: string;
          taskType: string;
          accepted: true;
          status: "queued";
        }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const read = vi.fn(async () => ({
      requestId: "task-advanced",
      status: "cancelled" as const,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          workspaceId="workspace-a"
          artifactClient={
            {
              browseArtifacts: async () => [
                {
                  artifactId: "artifact-table",
                  storageKey: "uploads/examples.jsonl",
                  originalName: "examples.jsonl",
                  artifactFamily: "dataset",
                  mediaType: "application/x-ndjson",
                },
                {
                  artifactId: "artifact-document",
                  storageKey: "uploads/guide.md",
                  originalName: "guide.md",
                  artifactFamily: "document",
                  mediaType: "text/markdown",
                },
              ],
            } as any
          }
          preparationClient={
            {
              start,
              read,
              cancel: vi.fn(),
              approve: vi.fn(),
            } as any
          }
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("guide.md");
    const documentLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent?.includes("guide.md"),
    ) as HTMLLabelElement;
    await act(async () => {
      (documentLabel.querySelector("input") as HTMLInputElement).click();
    });
    expect(container.textContent).toContain(
      "Create a dataset from source material",
    );
    const methodSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.value === "topic-aware",
    ) as HTMLSelectElement;
    expect(methodSelect).toBeDefined();
    expect(container.textContent).toContain("Topic-aware sections");
    expect(container.textContent).toContain("Maximum section length");
    expect(container.textContent).not.toContain("Overlap between sections");
    expect(container.textContent).toContain("Generation prompt");
    expect(container.textContent).toContain("System prompt instructions");
    expect(container.textContent).toContain("Desired output format");
    expect(container.textContent).toContain("JSON output preview");
    expect(container.textContent).toContain("Advanced structure preview");
    expect(
      container.querySelector('pre[aria-label="Generated JSON schema preview"]')
        ?.textContent,
    ).toContain('"const": "llm-instruction"');
    expect(container.textContent).toContain(
      "Keep generated JSON well structured",
    );
    const constrainedControl = Array.from(
      container.querySelectorAll("label"),
    ).find((label) =>
      label.textContent?.includes("Keep generated JSON well structured"),
    ) as HTMLLabelElement;
    const constrainedCheckbox = constrainedControl.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    expect(constrainedCheckbox.checked).toBe(false);
    expect(constrainedCheckbox.disabled).toBe(true);
    const attributionLabel = Array.from(
      container.querySelectorAll("label"),
    ).find((label) =>
      label.textContent?.includes(
        "Include source attribution with each example",
      ),
    ) as HTMLLabelElement;
    await act(async () => {
      (attributionLabel.querySelector("input") as HTMLInputElement).click();
    });
    expect(container.textContent).toContain(
      "Source attribution added automatically",
    );
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Run checks and prepare",
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
    });

    expect(methodSelect.disabled).toBe(true);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          sourceArtifactIds: ["artifact-document"],
          preparation: {
            schemaVersion: "1",
            inputIntent: "create-from-source-material",
            method: "topic-aware",
            sourceKinds: ["document"],
            generationMode: "task-examples",
          },
          advanced: expect.objectContaining({
            preset: "topic-aware",
            synthetic: expect.objectContaining({
              enabled: true,
              requireReview: true,
            }),
          }),
          recipe: expect.objectContaining({
            task: expect.objectContaining({ textInputMode: "generate" }),
            generation: expect.objectContaining({
              promptTemplate: expect.stringContaining("instruction-tuning"),
              structuredOutput: expect.objectContaining({
                constrainedDecoding: false,
                visualShape: expect.objectContaining({
                  schemaVersion: "1",
                  taskType: "llm-instruction",
                }),
              }),
            }),
          }),
          quality: expect.objectContaining({
            policy: expect.objectContaining({
              includeSourceAttribution: true,
            }),
          }),
        }),
      }),
    );

    await act(async () => {
      resolveStart?.({
        requestId: "task-advanced",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "queued",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(read).toHaveBeenCalled();
    expect(methodSelect.disabled).toBe(false);
  });

  it("shows only reviewed-annotation preparation for object detection and reports the pixel-inspection limit", async () => {
    const start = vi.fn(async () => ({
      requestId: "task-detection",
      taskType: "prepare-training-dataset",
      accepted: true as const,
      status: "queued" as const,
    }));
    const read = vi.fn(async () => ({
      requestId: "task-detection",
      status: "cancelled" as const,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          workspaceId="workspace-a"
          artifactClient={
            {
              browseArtifacts: async () => [
                {
                  artifactId: "artifact-image",
                  storageKey: "uploads/street.png",
                  originalName: "street.png",
                  artifactFamily: "image",
                  mediaType: "image/png",
                },
                {
                  artifactId: "artifact-document",
                  storageKey: "uploads/guide.md",
                  originalName: "guide.md",
                  artifactFamily: "document",
                  mediaType: "text/markdown",
                },
              ],
            } as any
          }
          preparationClient={
            {
              start,
              read,
              cancel: vi.fn(),
              approve: vi.fn(),
            } as any
          }
        />,
      );
      await Promise.resolve();
    });

    const goalSelect = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      goalSelect.value = "vision-detection";
      goalSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("street.png");
    expect(container.textContent).not.toContain("guide.md");
    const imageLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent?.includes("street.png"),
    ) as HTMLLabelElement;
    await act(async () => {
      (imageLabel.querySelector("input") as HTMLInputElement).click();
    });

    expect(container.textContent).toContain("Use reviewed annotations");
    expect(container.textContent).not.toContain("Preparation method");
    expect(container.textContent).toContain(
      "Image pixels are not inspected for faces, personal details, credentials, unsafe content, or annotation accuracy.",
    );
    expect(container.textContent).toContain("Box format");

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Run checks and prepare",
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          sourceArtifactIds: ["artifact-image"],
          preparation: {
            schemaVersion: "1",
            inputIntent: "create-from-source-material",
            method: "use-existing-annotations",
            sourceKinds: ["image"],
            generationMode: "none",
          },
          recipe: expect.objectContaining({
            task: expect.objectContaining({
              taskType: "vision-detection",
              textInputMode: "provided",
              boxFormat: "coco",
            }),
          }),
        }),
      }),
    );
    const command = start.mock.calls[0][0].command;
    expect(command.advanced).toBeUndefined();
    expect(command.recipe.normalization).toBeUndefined();
    expect(command.recipe.chunking).toBeUndefined();
    expect(command.recipe.generation).toBeUndefined();
  });
});
