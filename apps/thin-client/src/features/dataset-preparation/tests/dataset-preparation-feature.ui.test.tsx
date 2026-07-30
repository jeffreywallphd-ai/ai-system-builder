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
          preparationClient={{ start, read, cancel: vi.fn(), approve } as any}
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
    expect(container.textContent).toContain("Review and create");
    expect(container.textContent).toContain("Advanced settings");
    expect(container.textContent).toContain("examples.jsonl");
    expect(container.textContent).not.toContain("legacy.xls");

    await act(async () => {
      (
        container?.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click();
    });
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
    expect(container.textContent).toContain("Check results");
    expect(container.textContent).toContain("Exact duplicates: 1");
    expect(container.textContent).not.toContain("Dataset ready");

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
});
