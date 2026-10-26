// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import type { ApiDatasetPreparationClient } from "../api/apiDatasetPreparationClient";
import type { ArtifactBrowserApiClient } from "../../artifact-browser/api/apiArtifactBrowserClient";
import type { DatasetQualityReport } from "../../../../../../modules/contracts/runtime";

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
    localStorage.clear();
  });

  function control(label: string) {
    const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label);
    expect(found).toBeTruthy(); return found!;
  }
  function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  }
  function field(label: string, selector: string) {
    const element = [...container!.querySelectorAll("label")].find(value => value.textContent?.includes(label))?.querySelector(selector);
    expect(element).toBeTruthy(); return element as HTMLInputElement & HTMLSelectElement;
  }
  function datasetClients(overrides: Partial<ApiDatasetPreparationClient> = {}, name = "support-instructions.jsonl", mediaType = "application/x-ndjson") {
    const preparation: ApiDatasetPreparationClient = {
      start: vi.fn<ApiDatasetPreparationClient["start"]>(async () => ({ requestId: "owned-task", taskType: "prepare-training-dataset", accepted: true, status: "queued" })),
      read: vi.fn<ApiDatasetPreparationClient["read"]>(async ({ requestId }) => ({ requestId, taskType: "prepare-training-dataset", status: "cancelled" })),
      cancel: vi.fn<ApiDatasetPreparationClient["cancel"]>(async ({ requestId }) => ({ requestId, cancelled: true, status: "cancelled" })),
      approve: vi.fn(async () => { throw new Error("Synthetic unexpected approval"); }),
      readPreparedReviewPage: vi.fn<ApiDatasetPreparationClient["readPreparedReviewPage"]>(async input => ({ lineId: input.lineId, page: input.page, pageSize: 10, totalRows: 0, rows: [] })),
      ...overrides,
    };
    const artifact = { browseArtifacts: vi.fn(async () => [{ artifactId: "source-1", storageKey: `uploads/${name}`, originalName: name, artifactFamily: "dataset", mediaType }]) } as unknown as ArtifactBrowserApiClient;
    return { preparation, artifact };
  }
  async function mountDataset(clients: ReturnType<typeof datasetClients>, onPrepared?: (key: string) => void) {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(<DatasetPreparationFeature workspaceId="workspace-a" artifactClient={clients.artifact} preparationClient={clients.preparation} onPrepared={onPrepared} />));
  }
  async function selectStructuredSource() {
    await act(async () => container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  }

  function createApprovedResult(): Awaited<ReturnType<ApiDatasetPreparationClient["approve"]>>["result"] {
    return {
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
  }

  function createQualityReport(): DatasetQualityReport {
    return {
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
      approvalAllowed: false,
    };
  }

  it.each([
    ["llm-instruction", "support-instructions.jsonl", "application/x-ndjson", {}],
    ["llm-classification", "ticket-labels.csv", "text/csv", { labelSet: ["billing", "technical"], multiLabel: true }],
    ["llm-extraction", "invoice-fields.json", "application/json", { strictSchema: false }],
    ["llm-embedding", "semantic-pairs.parquet", "application/vnd.apache.parquet", {}],
    ["llm-reranker", "search-triplets.jsonl", "application/x-ndjson", {}],
    ["diffusion-lora", "product-captions.jsonl", "application/x-ndjson", { conceptKind: "style", triggerToken: "mug-token", regularizationClass: "ceramic mug" }],
    ["vision-classification", "defect-labels.csv", "text/csv", { labelSet: ["normal", "damaged"] }],
    ["vision-detection", "street-boxes.jsonl", "application/x-ndjson", { labelSet: ["normal", "damaged"], boxFormat: "xyxy" }],
    ["vision-segmentation", "surface-masks.jsonl", "application/x-ndjson", { labelSet: ["normal", "damaged"], maskFormat: "coco-rle" }],
  ] as const)("builds a provided-data %s preparation from its visible task controls", async (goal, filename, mediaType, task) => {
    const clients = datasetClients({}, filename, mediaType);
    await mountDataset(clients);
    await act(async () => change(field("Training goal", "select"), goal));
    await selectStructuredSource();
    await act(async () => {
      if ("labelSet" in task) change(field("Allowed labels", "input"), task.labelSet.join(", "));
      if (goal === "llm-classification") field("Allow more than one label", "input").click();
      if (goal === "llm-extraction") field("Require every extracted result", "input").click();
      if (goal === "diffusion-lora") {
        change(field("What the images teach", "select"), "style");
        change(field("Optional trigger word", "input"), " mug-token ");
        change(field("Optional general class", "input"), " ceramic mug ");
      }
      if (goal === "vision-detection") change(field("Box format", "select"), "xyxy");
      if (goal === "vision-segmentation") change(field("Mask format", "select"), "coco-rle");
    });
    expect(control("Run checks and prepare").disabled).toBe(false);
    await act(async () => control("Run checks and prepare").click());
    expect(clients.preparation.start).toHaveBeenCalledTimes(1);
    expect(clients.preparation.start).toHaveBeenCalledWith({ workspaceId: "workspace-a", command: expect.objectContaining({
      sourceArtifactIds: ["source-1"],
      preparation: { schemaVersion: "1", inputIntent: "use-existing-dataset", method: "validate-and-split", sourceKinds: ["structured"], generationMode: "none" },
      recipe: expect.objectContaining({ task: expect.objectContaining({ taskType: goal, textInputMode: "provided", ...task }) }),
      split: { trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, shuffle: true },
      quality: { policy: expect.objectContaining({ preset: "recommended" }), reviewRequired: true },
    }) });
    expect(container!.textContent).toContain("Dataset preparation stopped.");
  });

  it("admits one preparation before React commits the busy state", async () => {
    let resolve!: (value: Awaited<ReturnType<ApiDatasetPreparationClient["start"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<ApiDatasetPreparationClient["start"]>>>(done => { resolve = done; });
    const clients = datasetClients({ start: vi.fn(async () => pending) });
    await mountDataset(clients); await selectStructuredSource();
    try {
      await act(async () => { const start = control("Run checks and prepare"); start.click(); start.click(); });
      expect(clients.preparation.start).toHaveBeenCalledTimes(1);
    } finally { await act(async () => resolve({ requestId: "owned-task", taskType: "prepare-training-dataset", accepted: true, status: "queued" })); }
  });

  it("does not observe a delayed start through a replaced preparation client", async () => {
    let resolve!: (value: Awaited<ReturnType<ApiDatasetPreparationClient["start"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<ApiDatasetPreparationClient["start"]>>>(done => { resolve = done; });
    const clients = datasetClients({ start: vi.fn(async () => pending) }), next = datasetClients();
    await mountDataset(clients); await selectStructuredSource();
    await act(async () => control("Run checks and prepare").click());
    await act(async () => root!.render(<DatasetPreparationFeature workspaceId="workspace-a" artifactClient={clients.artifact} preparationClient={next.preparation} />));
    await act(async () => resolve({ requestId: "owned-task", taskType: "prepare-training-dataset", accepted: true, status: "queued" }));
    expect(clients.preparation.read).toHaveBeenCalledTimes(0);
    expect(next.preparation.read).toHaveBeenCalledTimes(0);
    expect(container!.textContent).not.toContain("Dataset preparation stopped.");
  });

  it.each(["foreign", "error", "unknown"] as const)("retains accepted task ownership when status is %s", async mode => {
    vi.useFakeTimers();
    let terminal = false;
    const read = vi.fn<ApiDatasetPreparationClient["read"]>(async ({ requestId }) => {
      if (terminal) return { requestId, taskType: "prepare-training-dataset", status: "cancelled" };
      if (mode === "error") throw new Error("private polling payload");
      return { requestId: mode === "foreign" ? "foreign-task" : requestId, taskType: "prepare-training-dataset", status: mode === "unknown" ? "unknown" : "cancelled" };
    });
    const clients = datasetClients({ read });
    try {
      await mountDataset(clients); await selectStructuredSource();
      await act(async () => control("Run checks and prepare").click());
      expect(container!.textContent).not.toContain("Dataset preparation stopped.");
      expect(container!.textContent).not.toContain("private polling payload");
      expect(control("Stop preparation")).toBeTruthy();
      const before = read.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(800));
      expect(read.mock.calls.length).toBeGreaterThan(before);
      terminal = true;
      await act(async () => vi.advanceTimersByTimeAsync(800));
      expect(container!.textContent).toContain("Dataset preparation stopped.");
      expect(control("Run checks and prepare").disabled).toBe(false);
    } finally {
      await act(async () => root?.unmount()); root = undefined;
      await vi.advanceTimersByTimeAsync(800);
      vi.useRealTimers();
    }
  });

  function reviewClients(overrides: Partial<ApiDatasetPreparationClient> = {}) {
    const qualityReport = createQualityReport();
    return datasetClients({
      read: vi.fn<ApiDatasetPreparationClient["read"]>(async ({ requestId }) => ({ requestId, taskType: "prepare-training-dataset", status: "review-required", result: {
        ...createApprovedResult(), qualityReport, review: { state: "review-required", reportFingerprint: qualityReport.reportFingerprint, approvalAllowed: false },
      } })),
      ...overrides,
    });
  }
  function deferredDatasetValue<Value>() {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>(done => { resolve = done; });
    return { promise, resolve };
  }

  it.each([
    ["missing report", "review"], ["missing review", "review"],
    ["wrong fingerprint", "review"], ["wrong state", "review"],
    ["missing report", "cancelled"], ["missing review", "cancelled"],
    ["wrong fingerprint", "cancelled"], ["wrong state", "cancelled"],
  ] as const)("keeps ownership for %s until matching %s evidence", async (invalid, resolution) => {
    vi.useFakeTimers();
    let confirmed = false;
    const qualityReport = createQualityReport(), onPrepared = vi.fn();
    const clients = datasetClients({ read: vi.fn<ApiDatasetPreparationClient["read"]>(async ({ requestId }) => {
      if (confirmed && resolution === "cancelled") return { requestId, taskType: "prepare-training-dataset", status: "cancelled" };
      return { requestId, taskType: "prepare-training-dataset", status: "review-required", result: {
        ...createApprovedResult(),
        qualityReport: !confirmed && invalid === "missing report" ? undefined : qualityReport,
        review: !confirmed && invalid === "missing review" ? undefined : {
          state: !confirmed && invalid === "wrong state" ? "approved" : "review-required",
          reportFingerprint: !confirmed && invalid === "wrong fingerprint" ? "b".repeat(64) : qualityReport.reportFingerprint,
          approvalAllowed: false,
        },
      } };
    }) });
    try {
      await mountDataset(clients, onPrepared); await selectStructuredSource();
      await act(async () => control("Run checks and prepare").click());
      expect(control("Stop preparation")).toBeTruthy();
      expect(control("Preparing...").disabled).toBe(true);
      expect(container!.querySelector(".dataset-preparation__approval-controls")).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(800));
      expect(clients.preparation.read).toHaveBeenCalledTimes(2);
      expect(clients.preparation.start).toHaveBeenCalledTimes(1);
      expect(clients.preparation.approve).not.toHaveBeenCalled();
      expect(clients.preparation.readPreparedReviewPage).not.toHaveBeenCalled();
      expect(onPrepared).not.toHaveBeenCalled();
      confirmed = true;
      await act(async () => vi.advanceTimersByTimeAsync(800));
      if (resolution === "review") {
        expect(control("Approve and save dataset")).toBeTruthy();
        expect(control("Run checks and prepare").disabled).toBe(true);
      } else {
        expect(container!.textContent).toContain("Dataset preparation stopped.");
        expect(control("Run checks and prepare").disabled).toBe(false);
      }
      expect(onPrepared).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount()); root = undefined;
      await vi.advanceTimersByTimeAsync(800); vi.useRealTimers();
    }
  });
  async function openPreparedReview(clients: ReturnType<typeof datasetClients>, onPrepared?: (key: string) => void) {
    await mountDataset(clients, onPrepared); await selectStructuredSource();
    await act(async () => control("Run checks and prepare").click());
    expect(control("Approve and save dataset")).toBeTruthy();
  }

  it.each(["approve", "discard"] as const)("admits one %s action before its busy render", async action => {
    const approved = deferredDatasetValue<Awaited<ReturnType<ApiDatasetPreparationClient["approve"]>>>();
    const discarded = deferredDatasetValue<Awaited<ReturnType<ApiDatasetPreparationClient["cancel"]>>>();
    const clients = reviewClients({ approve: vi.fn(async () => approved.promise), cancel: vi.fn(async () => discarded.promise) });
    const onPrepared = vi.fn();
    await openPreparedReview(clients, onPrepared);
    try {
      await act(async () => { const target = control(action === "approve" ? "Approve and save dataset" : "Discard dataset"); target.click(); target.click(); });
      expect(action === "approve" ? clients.preparation.approve : clients.preparation.cancel).toHaveBeenCalledTimes(1);
      expect(onPrepared).toHaveBeenCalledTimes(0);
    } finally {
      await act(async () => {
        approved.resolve({ requestId: "owned-task", taskType: "prepare-training-dataset", status: "succeeded", result: createApprovedResult() });
        discarded.resolve({ requestId: "owned-task", cancelled: true, status: "cancelled" });
      });
    }
    expect(onPrepared).toHaveBeenCalledTimes(action === "approve" ? 1 : 0);
  });

  it("does not publish an old approval after preparation client replacement", async () => {
    const pending = deferredDatasetValue<Awaited<ReturnType<ApiDatasetPreparationClient["approve"]>>>();
    const clients = reviewClients({ approve: vi.fn(async () => pending.promise) }), next = datasetClients(), onPrepared = vi.fn();
    await openPreparedReview(clients, onPrepared);
    await act(async () => control("Approve and save dataset").click());
    await act(async () => root!.render(<DatasetPreparationFeature workspaceId="workspace-a" artifactClient={clients.artifact} preparationClient={next.preparation} onPrepared={onPrepared} />));
    await act(async () => pending.resolve({ requestId: "owned-task", taskType: "prepare-training-dataset", status: "succeeded", result: createApprovedResult() }));
    expect(onPrepared).toHaveBeenCalledTimes(0);
    expect(container!.textContent).not.toContain("Training dataset is ready.");
  });

  it("retains review after a foreign approval or private exception", async () => {
    let fail = false;
    const onPrepared = vi.fn(), clients = reviewClients({ approve: vi.fn<ApiDatasetPreparationClient["approve"]>(async () => {
      if (fail) throw new Error("private approval payload");
      return { requestId: "foreign-task", taskType: "prepare-training-dataset", status: "succeeded", result: createApprovedResult() };
    }) });
    await openPreparedReview(clients, onPrepared);
    await act(async () => control("Approve and save dataset").click());
    expect(onPrepared).toHaveBeenCalledTimes(0);
    expect(control("Discard dataset")).toBeTruthy();
    fail = true;
    await act(async () => control("Approve and save dataset").click());
    expect(container!.textContent).not.toContain("private approval payload");
    expect(control("Discard dataset")).toBeTruthy();
  });

  it("rejects a review page for a different page number", async () => {
    const clients = reviewClients({ readPreparedReviewPage: vi.fn<ApiDatasetPreparationClient["readPreparedReviewPage"]>(async input => ({ lineId: input.lineId, page: input.page + 1, pageSize: 10, totalRows: 1, rows: [{ rowIndex: 0, rowFingerprint: `sha256:${"f".repeat(64)}`, values: { prompt: "foreign private page content" } }] })) });
    await openPreparedReview(clients);
    const exact = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes("Exact duplicates"))!;
    await act(async () => exact.click());
    expect(document.body.textContent).not.toContain("foreign private page content");
    expect(document.body.textContent).toContain("did not match the requested page");
    expect(clients.preparation.approve).toHaveBeenCalledTimes(0);
  });

  it("retains the quality review when discard is not confirmed", async () => {
    const clients = reviewClients({ cancel: vi.fn<ApiDatasetPreparationClient["cancel"]>(async ({ requestId }) => ({ requestId, cancelled: false, status: "running" })) });
    await openPreparedReview(clients);
    await act(async () => control("Discard dataset").click());
    expect(container!.textContent).toContain("Discard could not be confirmed");
    expect(control("Approve and save dataset")).toBeTruthy();
    expect(control("Run checks and prepare").disabled).toBe(true);
  });

  it("ignores an old review page after discard and a fresh preparation", async () => {
    const pending = deferredDatasetValue<Awaited<ReturnType<ApiDatasetPreparationClient["readPreparedReviewPage"]>>>();
    const clients = reviewClients({ readPreparedReviewPage: vi.fn(async () => pending.promise) });
    await openPreparedReview(clients);
    await act(async () => [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes("Exact duplicates"))!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("button[aria-label='Close dialog']")!.click());
    await act(async () => control("Discard dataset").click());
    await act(async () => control("Run checks and prepare").click());
    await act(async () => pending.resolve({ lineId: "reason:exact-duplicate", page: 0, pageSize: 10, totalRows: 1, rows: [{ rowIndex: 0, rowFingerprint: `sha256:${"e".repeat(64)}`, values: { prompt: "old private review page" } }] }));
    expect(document.body.textContent).not.toContain("old private review page");
    expect(control("Approve and save dataset")).toBeTruthy();
    expect(clients.preparation.start).toHaveBeenCalledTimes(2);
  });

  it.each(["running", "unknown", "error", "delayed"])("keeps observing when cancellation is %s", async (mode) => {
    vi.useFakeTimers();
    try {
      let terminal = false;
      let starts = 0;
      let finishCancel: ((value: unknown) => void) | undefined;
      const read = vi.fn(async ({ requestId }: { requestId: string }) => ({ requestId, status: terminal ? "cancelled" : "running" }));
      const cancel = vi.fn(async () => {
        if (mode === "error") throw new Error("private runtime failure");
        if (mode === "delayed") return new Promise((resolve) => { finishCancel = resolve; });
        return { requestId: "cancel-task", cancelled: false, status: mode };
      });
      container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
      await act(async () => {
        root?.render(<DatasetPreparationFeature workspaceId="workspace-a" artifactClient={{ browseArtifacts: async () => [{
          artifactId: "a", storageKey: "uploads/a.jsonl", originalName: "a.jsonl", artifactFamily: "dataset", mediaType: "application/x-ndjson",
        }] } as any} preparationClient={{ start: async () => ({ requestId: ++starts === 1 ? "cancel-task" : "cancel-task-2" }), read, cancel } as any} />);
        await Promise.resolve(); await Promise.resolve();
      });
      await act(async () => { (container!.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
      await act(async () => {
        (Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Run checks and prepare") as HTMLButtonElement).click();
        await Promise.resolve(); await Promise.resolve();
      });
      const stop = () => Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.includes("Stop")) as HTMLButtonElement;
      expect(stop()).toBeTruthy();
      await act(async () => { stop().click(); await Promise.resolve(); await Promise.resolve(); });
      expect(cancel).toHaveBeenCalledWith({ requestId: "cancel-task", workspaceId: "workspace-a" });
      expect(container!.textContent).not.toContain("Dataset preparation stopped.");
      expect(container!.textContent).not.toContain("private runtime failure");
      const before = read.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
      expect(read.mock.calls.length).toBeGreaterThan(before);
      expect(stop()).toBeTruthy();
      terminal = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
      expect(container!.textContent).toContain("Dataset preparation stopped.");
      if (mode === "delayed") {
        const oldCancel = finishCancel;
        terminal = false;
        await act(async () => {
          (Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "Run checks and prepare") as HTMLButtonElement).click();
          await Promise.resolve(); await Promise.resolve();
        });
        expect(stop().disabled).toBe(false);
        await act(async () => { stop().click(); await Promise.resolve(); await Promise.resolve(); });
        expect(cancel).toHaveBeenLastCalledWith({ requestId: "cancel-task-2", workspaceId: "workspace-a" });
        await act(async () => { oldCancel?.({ requestId: "cancel-task", cancelled: false, status: "running" }); await Promise.resolve(); });
        expect(stop().disabled).toBe(true);
        terminal = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
      }
      await act(async () => { finishCancel?.({ requestId: "cancel-task-2", cancelled: false, status: "running" }); await Promise.resolve(); });
      expect(container!.textContent).toContain("Dataset preparation stopped.");
    } finally { vi.useRealTimers(); }
  });

  it("uses four ordered steps and creates a three-way dataset without advanced changes", async () => {
    const onPrepared = vi.fn();
    const start = vi.fn<ApiDatasetPreparationClient["start"]>(async () => ({
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      accepted: true as const,
      status: "queued" as const,
    }));
    const approvedResult = createApprovedResult();
    const qualityReport = createQualityReport();
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
          approvalAllowed: false,
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
          onPrepared={onPrepared}
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
    expect(container.textContent).not.toContain("Saved versions");

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
          output: expect.objectContaining({
            naming: { baseName: undefined },
          }),
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

    const approvalControls = container.querySelector(
      ".dataset-preparation__approval-controls",
    ) as HTMLDivElement;
    expect(approvalControls.textContent).toContain(
      "Dataset save name (optional)",
    );
    expect(approvalControls.textContent).toContain(
      "complete set of ready examples",
    );
    expect(approvalControls.textContent).toContain("Discard dataset");
    expect(container.textContent).not.toContain("Discard review");
    expect(container.textContent).not.toContain("This dataset cannot be saved");

    const saveNameInput = approvalControls.querySelector(
      'input[placeholder="customer-support-training"]',
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(saveNameInput, "support-tickets-2026");
      saveNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve and save dataset",
    ) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
    await act(async () => {
      approveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(approve).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      requestId: "task-1",
      reportFingerprint: qualityReport.reportFingerprint,
      outputBaseName: "support-tickets-2026",
    });
    expect(container.textContent).toContain("Dataset ready");
    expect(container.textContent).toContain("datasets/prepared.parquet");
    expect(onPrepared).toHaveBeenCalledWith("datasets/prepared.parquet");
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
    const start = vi.fn<ApiDatasetPreparationClient["start"]>(async () => ({
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
