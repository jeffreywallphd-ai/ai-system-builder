import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";
import { createContractError } from "../../../contracts/shared";

const qualityCommand = {
  sourceArtifactIds: ["source-a"],
  recipe: {
    normalization: { targetFormat: "markdown" as const },
    chunking: {
      strategy: "character" as const,
      chunkSize: 1,
      chunkOverlap: 0,
    },
    generation: {
      mode: "qa" as const,
      model: { provider: "transformers" as const, modelId: "model-a" },
    },
  },
  split: { trainRatio: 0.8, testRatio: 0.2 },
  output: { format: "jsonl" as const },
  quality: {
    policy: {
      preset: "recommended" as const,
      allowedLanguages: ["en"],
    },
    reviewRequired: true,
  },
};

function createDependencies(overrides: Record<string, unknown> = {}): any {
  return {
    runtimeTaskRegistry: {
      startTask: testDouble.fn(),
      getTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      listTasks: testDouble.fn(async () => ({ tasks: [] })),
    },
    storageBindings: {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: { bindings: [] },
      })),
      upsertArtifactStorageBinding: testDouble.fn(),
      deleteArtifactStorageBindings: testDouble.fn(),
    },
    storage: {
      retrieveArtifact: testDouble.fn(async () => ({
        ok: true,
        value: {
          descriptor: {
            key: "source-a",
            mediaType: "text/markdown",
            metadata: {},
          },
          content: new TextEncoder().encode("synthetic source"),
        },
      })),
      storeArtifact: testDouble.fn(),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    },
    taskPowerLifecycle: {
      startTask: testDouble.fn(async () => undefined),
      completeTask: testDouble.fn(async () => undefined),
    },
    ...overrides,
  };
}

const managedQualityPolicyProvider = {
  resolveDatasetQualityPolicy: testDouble.fn(async () => ({
    policyId: "managed-quality",
    revision: "2",
    scope: "workspace" as const,
    preset: "recommended" as const,
    allowedLanguages: ["en"],
    requireLicenseMetadata: false,
    requireConsentMetadata: false,
    excludedBenchmarkIds: [],
    maxRowsPerSource: 500,
    minimumTextCharacters: 8,
    maximumTextCharacters: 100_000,
    fuzzyDuplicateSimilarity: 0.92,
    maxFuzzyCandidatesPerRow: 64,
    maxReportSamplesPerReason: 10,
    mandatoryChecks: {
      sourceAssociation: true as const,
      schema: true as const,
      exactDuplicates: true as const,
      fuzzyDuplicates: true as const,
      sensitivePersonalData: true as const,
      secretLikeContent: true as const,
      splitLeakage: true as const,
    },
  })),
};

function createTopicAwareCommand() {
  return {
    ...qualityCommand,
    preparation: {
      schemaVersion: "1" as const,
      inputIntent: "create-from-source-material" as const,
      method: "topic-aware" as const,
      sourceKinds: ["document" as const],
      generationMode: "task-examples" as const,
    },
    recipe: {
      normalization: { targetFormat: "markdown" as const },
      generation: qualityCommand.recipe.generation,
      task: {
        taskType: "llm-instruction" as const,
        textInputMode: "generate" as const,
      },
    },
    advanced: {
      preset: "topic-aware" as const,
      content: {
        strategy: "semantic" as const,
        maxTokensPerChunk: 512,
        maxSourceSpans: 8_000,
        semanticBoundaryThreshold: 0.3,
        ocrEnabled: false,
      },
      semantic: {
        enabled: true,
        embeddingAlgorithm: "hashed-token-v1" as const,
        similarityThreshold: 0.86,
        maxComparisonsPerRow: 96,
        hardNegativeMining: true,
      },
      synthetic: {
        enabled: true,
        candidatesPerChunk: 3,
        minimumGroundingScore: 0.5,
        minimumCriticScore: 0.65,
        minimumDiversityScore: 0.25,
        requireReview: true,
      },
    },
  };
}

describe("PrepareTrainingDatasetFromArtifactsUseCase quality policy", () => {
  it("preserves compatible topic-aware refinements and omits fixed chunk settings", async () => {
    let runtimePayload: any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        runtimeTaskRegistry: {
          startTask: testDouble.fn(async (request: any) => {
            runtimePayload = request.payload;
            return {
              requestId: "topic-aware-task",
              taskType: "dataset-preparation",
              accepted: true,
              status: "queued",
            };
          }),
          getTaskStatus: testDouble.fn(),
          cancelTask: testDouble.fn(),
          listTasks: testDouble.fn(async () => ({ tasks: [] })),
        },
        datasetQualityPolicyProvider: managedQualityPolicyProvider,
      }),
    );
    const adaptiveCommand = createTopicAwareCommand();

    const result = await useCase.startPrepareTrainingDataset(adaptiveCommand, {
      workspaceId: "workspace-a",
    });

    expect(result.ok).toBe(true);
    expect(runtimePayload.preparation).toEqual(adaptiveCommand.preparation);
    expect(runtimePayload.recipe.chunking).toBeUndefined();
    expect(runtimePayload.advanced.content.maxTokensPerChunk).toBe(512);
    expect(runtimePayload.advanced.semantic.similarityThreshold).toBe(0.86);
  });

  it("uses catalog media type when filesystem retrieval omits PDF metadata", async () => {
    let runtimePayload: any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        runtimeTaskRegistry: {
          startTask: testDouble.fn(async (request: any) => {
            runtimePayload = request.payload;
            return {
              requestId: "pdf-topic-aware-task",
              taskType: "dataset-preparation",
              accepted: true,
              status: "queued",
            };
          }),
          getTaskStatus: testDouble.fn(),
          cancelTask: testDouble.fn(),
          listTasks: testDouble.fn(async () => ({ tasks: [] })),
        },
        storage: {
          retrieveArtifact: testDouble.fn(async () => ({
            ok: true,
            value: {
              descriptor: { key: "source-a", sizeBytes: 8 },
              content: new TextEncoder().encode("%PDF-1.4"),
            },
          })),
          storeArtifact: testDouble.fn(),
          hasArtifact: testDouble.fn(),
          deleteArtifact: testDouble.fn(),
        },
        artifactCatalog: {
          readArtifactCatalogRecord: testDouble.fn(async () => ({
            ok: true,
            value: {
              record: {
                storageKey: "source-a",
                originalName: "source.pdf",
                mediaType: "application/pdf",
              },
            },
          })),
        },
        datasetQualityPolicyProvider: managedQualityPolicyProvider,
      }),
    );

    const result = await useCase.startPrepareTrainingDataset(
      createTopicAwareCommand(),
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(true);
    expect(runtimePayload.preparation).toMatchObject({
      method: "topic-aware",
      sourceKinds: ["document"],
    });
    expect(runtimePayload.sourceInputs[0]).toMatchObject({
      originalName: "source.pdf",
      mediaType: "application/pdf",
    });
    expect(runtimePayload.sourceInputs[0].localPath).toMatch(/\.pdf$/);
  });

  it("rejects fixed size or overlap settings for topic-aware preparation", async () => {
    const startTask = testDouble.fn();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        runtimeTaskRegistry: {
          startTask,
          getTaskStatus: testDouble.fn(),
          cancelTask: testDouble.fn(),
          listTasks: testDouble.fn(async () => ({ tasks: [] })),
        },
        datasetQualityPolicyProvider: managedQualityPolicyProvider,
      }),
    );

    const result = await useCase.startPrepareTrainingDataset(
      {
        ...qualityCommand,
        preparation: {
          schemaVersion: "1",
          inputIntent: "create-from-source-material",
          method: "topic-aware",
          sourceKinds: ["document"],
          generationMode: "task-examples",
        },
        recipe: {
          ...qualityCommand.recipe,
          task: {
            taskType: "llm-instruction",
            textInputMode: "generate",
          },
        },
        advanced: {
          preset: "topic-aware",
          content: {
            strategy: "semantic",
            maxTokensPerChunk: 320,
            maxSourceSpans: 10_000,
            semanticBoundaryThreshold: 0.22,
          },
          semantic: {
            enabled: true,
            embeddingAlgorithm: "hashed-token-v1",
            similarityThreshold: 0.9,
            maxComparisonsPerRow: 128,
            hardNegativeMining: true,
          },
          synthetic: {
            enabled: true,
            candidatesPerChunk: 2,
            requireReview: true,
          },
        },
      },
      { workspaceId: "workspace-a" },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation",
        message:
          "Section size and overlap are not used by the selected preparation method.",
      },
    });
    expect(startTask).not.toHaveBeenCalled();
  });

  it("fails closed before staging when quality policy authority is missing", async () => {
    const retrieveArtifact = testDouble.fn();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        storage: {
          retrieveArtifact,
          storeArtifact: testDouble.fn(),
          hasArtifact: testDouble.fn(),
          deleteArtifact: testDouble.fn(),
        },
      }),
    );

    const result = await useCase.startPrepareTrainingDataset(qualityCommand, {
      workspaceId: "workspace-a",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unavailable");
      expect(result.error.message).toContain("policy is unavailable");
    }
    expect(retrieveArtifact).not.toHaveBeenCalled();
  });

  it("forwards only the resolved effective policy to the runtime", async () => {
    let runtimePayload: any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        runtimeTaskRegistry: {
          startTask: testDouble.fn(async (request: any) => {
            runtimePayload = request.payload;
            return {
              requestId: "quality-task",
              taskType: "dataset-preparation",
              accepted: true,
              status: "queued",
            };
          }),
          getTaskStatus: testDouble.fn(),
          cancelTask: testDouble.fn(),
          listTasks: testDouble.fn(async () => ({ tasks: [] })),
        },
        datasetQualityPolicyProvider: {
          resolveDatasetQualityPolicy: testDouble.fn(async () => ({
            policyId: "managed-quality",
            revision: "2",
            scope: "workspace",
            preset: "recommended",
            allowedLanguages: ["en"],
            requireLicenseMetadata: false,
            requireConsentMetadata: false,
            excludedBenchmarkIds: [],
            maxRowsPerSource: 500,
            minimumTextCharacters: 8,
            maximumTextCharacters: 100_000,
            fuzzyDuplicateSimilarity: 0.92,
            maxFuzzyCandidatesPerRow: 64,
            maxReportSamplesPerReason: 10,
            mandatoryChecks: {
              sourceAssociation: true,
              schema: true,
              exactDuplicates: true,
              fuzzyDuplicates: true,
              sensitivePersonalData: true,
              secretLikeContent: true,
              splitLeakage: true,
            },
          })),
        },
      }),
    );

    const result = await useCase.startPrepareTrainingDataset(qualityCommand, {
      workspaceId: "workspace-a",
    });

    expect(result.ok).toBe(true);
    expect(runtimePayload.quality).toMatchObject({
      requestedPolicy: qualityCommand.quality.policy,
      reviewRequired: true,
      effectivePolicy: {
        policyId: "managed-quality",
        revision: "2",
        maxRowsPerSource: 500,
      },
    });
  });

  it("withholds final outputs until scope- and fingerprint-bound approval", async () => {
    const fingerprint = "a".repeat(64);
    const effectivePolicy = {
      policyId: "managed-quality",
      revision: "2",
      scope: "workspace" as const,
      preset: "recommended" as const,
      allowedLanguages: ["en"],
      requireLicenseMetadata: false,
      requireConsentMetadata: false,
      excludedBenchmarkIds: [],
      maxRowsPerSource: 500,
      minimumTextCharacters: 8,
      maximumTextCharacters: 100_000,
      fuzzyDuplicateSimilarity: 0.92,
      maxFuzzyCandidatesPerRow: 64,
      maxReportSamplesPerReason: 10,
      mandatoryChecks: {
        sourceAssociation: true as const,
        schema: true as const,
        exactDuplicates: true as const,
        fuzzyDuplicates: true as const,
        sensitivePersonalData: true as const,
        secretLikeContent: true as const,
        splitLeakage: true as const,
      },
    };
    const qualityReport = {
      schemaVersion: "1" as const,
      status: "needs-attention" as const,
      reportFingerprint: fingerprint,
      policy: effectivePolicy,
      mapping: {
        taskType: "llm-instruction",
        status: "complete" as const,
        mappedFields: ["instruction", "output"],
        missingRequiredFields: [],
      },
      fields: [],
      distributions: {
        sources: [{ label: "source-a", count: 2 }],
      },
      counts: { inputRows: 2, acceptedRows: 1, quarantinedRows: 1 },
      reasonCounts: { "schema-invalid": 1 },
      samples: [
        {
          sourceArtifactId: "source-a",
          sourceRowIndex: 1,
          reasonCodes: ["schema-invalid" as const],
          fieldNames: ["instruction"],
          summary: "Moved to quarantine because a required value was missing.",
        },
      ],
      reviewRequired: true,
      approvalAllowed: true,
    };
    let runtimeWorkingDirectory = "";
    const storedRoles: string[] = [];
    const storedArtifacts = new Map<
      string,
      { content: Uint8Array; descriptor: Record<string, any> }
    >();
    let reviewStorageKey = "";
    let failTrainMaterializationOnce = true;
    const runtimeResult = {
      outputs: [
        {
          name: "training-dataset",
          role: "dataset",
          outputHandle: "dataset.jsonl",
          mediaType: "application/x-ndjson",
        },
        {
          name: "training-dataset-train",
          role: "train",
          outputHandle: "train.jsonl",
          mediaType: "application/x-ndjson",
          metadata: { rowCount: 1 },
        },
        {
          name: "training-dataset-report",
          role: "report",
          outputHandle: "report.json",
          mediaType: "application/json",
        },
        {
          name: "training-dataset-review",
          role: "review",
          outputHandle: "review.jsonl",
          mediaType: "application/x-ndjson",
          metadata: { rowCount: 1, reportFingerprint: fingerprint },
        },
        {
          name: "training-dataset-quarantine",
          role: "quarantine",
          outputHandle: "quarantine.jsonl",
          mediaType: "application/x-ndjson",
        },
      ],
      summary: {
        sourceDocumentCount: 1,
        normalizedDocumentCount: 1,
        skippedDocumentCount: 0,
        chunkCount: 2,
        generatedExampleCount: 2,
        datasetRowCount: 1,
        trainRowCount: 1,
        validationRowCount: 0,
        testRowCount: 0,
        acceptedRowCount: 1,
        quarantinedRowCount: 1,
      },
      qualityReport,
    };
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase(
      createDependencies({
        runtimeTaskRegistry: {
          startTask: testDouble.fn(async (request: any) => {
            runtimeWorkingDirectory =
              request.payload.runtime.runtimeWorkingDirectory;
            await writeFile(
              join(runtimeWorkingDirectory, "dataset.jsonl"),
              '{"instruction":"synthetic","output":"accepted"}\n',
            );
            await writeFile(
              join(runtimeWorkingDirectory, "train.jsonl"),
              '{"instruction":"synthetic","output":"accepted"}\n',
            );
            await writeFile(
              join(runtimeWorkingDirectory, "report.json"),
              JSON.stringify(qualityReport),
            );
            await writeFile(
              join(runtimeWorkingDirectory, "review.jsonl"),
              '{"instruction":"synthetic","output":"accepted","sourceArtifactId":"source-a"}\n',
            );
            await writeFile(
              join(runtimeWorkingDirectory, "quarantine.jsonl"),
              JSON.stringify({
                sourceArtifactId: "source-a",
                sourceRowIndex: 1,
                reasonCodes: ["schema-invalid"],
                row: { instruction: "synthetic rejected row" },
              }),
            );
            return {
              requestId: "quality-review-task",
              taskType: "dataset-preparation",
              accepted: true,
              status: "queued",
            };
          }),
          getTaskStatus: testDouble.fn(async () => ({
            requestId: "quality-review-task",
            taskType: "dataset-preparation",
            status: "succeeded",
            concurrencyClass: "unknown",
            workspaceId: "workspace-a",
            metadata: { workspaceId: "workspace-a" },
            data: runtimeResult,
          })),
          cancelTask: testDouble.fn(),
          listTasks: testDouble.fn(async () => ({ tasks: [] })),
        },
        datasetQualityPolicyProvider: {
          resolveDatasetQualityPolicy: testDouble.fn(
            async () => effectivePolicy,
          ),
        },
        storage: {
          retrieveArtifact: testDouble.fn(async (request: any) => {
            const stored = storedArtifacts.get(String(request.key));
            if (stored) {
              return { ok: true, value: stored };
            }
            return {
              ok: true,
              value: {
                descriptor: {
                  key: "source-a",
                  mediaType: "text/markdown",
                  metadata: {},
                },
                content: new TextEncoder().encode("synthetic source"),
              },
            };
          }),
          storeArtifact: testDouble.fn(async (request: any) => {
            const role = String(request.descriptor.metadata.runtimeRole);
            if (role === "train" && failTrainMaterializationOnce) {
              failTrainMaterializationOnce = false;
              return {
                ok: false,
                error: createContractError(
                  "unavailable",
                  "Temporary storage failure.",
                ),
              };
            }
            storedRoles.push(role);
            const key = String(request.descriptor.key);
            storedArtifacts.set(key, {
              descriptor: request.descriptor,
              content: new Uint8Array(request.content),
            });
            if (role === "review") reviewStorageKey = key;
            return { ok: true, value: request.descriptor };
          }),
          hasArtifact: testDouble.fn(),
          deleteArtifact: testDouble.fn(async (request: any) => {
            storedArtifacts.delete(String(request.key));
            return { ok: true, value: { deleted: true } };
          }),
        },
      }),
    );

    const started = await useCase.startPrepareTrainingDataset(qualityCommand, {
      workspaceId: "workspace-a",
    });
    expect(started.ok).toBe(true);

    const wrongScope = await useCase.readPrepareTrainingDataset(
      "quality-review-task",
      { workspaceId: "workspace-b" },
    );
    expect(wrongScope.ok).toBe(false);

    const review = await useCase.readPrepareTrainingDataset(
      "quality-review-task",
      { workspaceId: "workspace-a" },
    );
    expect(review.ok).toBe(true);
    if (review.ok && "result" in review.value) {
      expect(review.value.status).toBe("review-required");
      expect(review.value.result.outputs.local?.dataset).toBeUndefined();
      expect(review.value.result.outputs.local?.report).toBeDefined();
      expect(review.value.result.outputs.local?.quarantine).toBeDefined();
    }
    expect(storedRoles).toEqual(["report", "quarantine", "review"]);
    expect(reviewStorageKey).not.toBe("");
    await expect(
      access(join(runtimeWorkingDirectory, "review.jsonl")),
    ).rejects.toThrow();

    const readyPage = await useCase.readPreparedDatasetQualityReviewPage(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        lineId: "ready",
        page: 0,
      },
      { workspaceId: "workspace-a" },
    );
    expect(readyPage.ok).toBe(true);
    if (readyPage.ok) {
      expect(readyPage.value.totalRows).toBe(1);
      expect(readyPage.value.rows[0]?.values.instruction).toBe("synthetic");
    }
    const originalReview = storedArtifacts.get(reviewStorageKey)!;
    storedArtifacts.set(reviewStorageKey, {
      ...originalReview,
      content: new TextEncoder().encode('{"instruction":"tampered"}\n'),
    });
    const tamperedPage = await useCase.readPreparedDatasetQualityReviewPage(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        lineId: "ready",
        page: 0,
      },
      { workspaceId: "workspace-a" },
    );
    expect(tamperedPage.ok).toBe(false);
    storedArtifacts.set(reviewStorageKey, originalReview);
    const findingPage = await useCase.readPreparedDatasetQualityReviewPage(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        lineId: "reason:schema-invalid",
        page: 0,
      },
      { workspaceId: "workspace-a" },
    );
    expect(findingPage.ok).toBe(true);
    if (findingPage.ok) {
      expect(findingPage.value.totalRows).toBe(1);
      expect(findingPage.value.rows[0]?.values.reasonCodes).toEqual([
        "schema-invalid",
      ]);
    }
    const quarantineEntry = [...storedArtifacts.entries()].find(
      ([, value]) => value.descriptor.metadata.runtimeRole === "quarantine",
    );
    expect(quarantineEntry).toBeDefined();
    const [quarantineKey, originalQuarantine] = quarantineEntry!;
    storedArtifacts.set(quarantineKey, {
      ...originalQuarantine,
      content: new TextEncoder().encode('{"reasonCodes":[]}\n'),
    });
    const tamperedFindingPage =
      await useCase.readPreparedDatasetQualityReviewPage(
        {
          requestId: "quality-review-task",
          reportFingerprint: fingerprint,
          lineId: "reason:schema-invalid",
          page: 0,
        },
        { workspaceId: "workspace-a" },
      );
    expect(tamperedFindingPage.ok).toBe(false);
    storedArtifacts.set(quarantineKey, originalQuarantine);
    const deniedPage = await useCase.readPreparedDatasetQualityReviewPage(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        lineId: "ready",
        page: 0,
      },
      { workspaceId: "workspace-b" },
    );
    expect(deniedPage.ok).toBe(false);

    const staleApproval = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: "b".repeat(64),
      },
      { workspaceId: "workspace-a" },
    );
    expect(staleApproval.ok).toBe(false);
    if (!staleApproval.ok) {
      expect(staleApproval.error.code).toBe("conflict");
    }
    expect(storedRoles).toEqual(["report", "quarantine", "review"]);

    const invalidSaveName = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        outputBaseName: "../unsafe",
      },
      { workspaceId: "workspace-a" },
    );
    expect(invalidSaveName.ok).toBe(false);
    if (!invalidSaveName.ok) {
      expect(invalidSaveName.error.code).toBe("validation");
    }
    expect(storedRoles).toEqual(["report", "quarantine", "review"]);
    await expect(access(runtimeWorkingDirectory)).resolves.toBeUndefined();

    const transientFailure = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
      },
      { workspaceId: "workspace-a" },
    );
    expect(transientFailure.ok).toBe(false);
    await expect(access(runtimeWorkingDirectory)).resolves.toBeUndefined();

    const approved = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
        outputBaseName: "support-tickets-2026",
      },
      { workspaceId: "workspace-a" },
    );
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.result.outputs.local?.dataset).toBeDefined();
      expect(approved.value.result.outputs.local?.report).toBeDefined();
      expect(approved.value.result.review?.state).toBe("approved");
    }
    const savedDataset = [...storedArtifacts.values()].find(
      (artifact) => artifact.descriptor.metadata.runtimeRole === "dataset",
    );
    const savedTrainSplit = [...storedArtifacts.values()].find(
      (artifact) => artifact.descriptor.metadata.runtimeRole === "train",
    );
    expect(savedDataset?.descriptor.metadata.originalFileName).toBe(
      "support-tickets-2026.jsonl",
    );
    expect(savedDataset?.descriptor.key).toContain(
      "support-tickets-2026.jsonl",
    );
    expect(savedTrainSplit?.descriptor.metadata.originalFileName).toBe(
      "support-tickets-2026-train.jsonl",
    );
    expect(storedRoles).toEqual([
      "report",
      "quarantine",
      "review",
      "dataset",
      "dataset",
      "train",
    ]);
    expect(storedArtifacts.has(reviewStorageKey)).toBe(false);
    await expect(access(runtimeWorkingDirectory)).rejects.toThrow();

    const replay = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
      },
      { workspaceId: "workspace-a" },
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.code).toBe("not-found");
    }
  });
});
