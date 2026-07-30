import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";

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

describe("PrepareTrainingDatasetFromArtifactsUseCase quality policy", () => {
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
          storeArtifact: testDouble.fn(async (request: any) => {
            storedRoles.push(String(request.descriptor.metadata.runtimeRole));
            return { ok: true, value: request.descriptor };
          }),
          hasArtifact: testDouble.fn(),
          deleteArtifact: testDouble.fn(async () => ({
            ok: true,
            value: { deleted: true },
          })),
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
    expect(storedRoles).toEqual(["report", "quarantine"]);

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
    expect(storedRoles).toEqual(["report", "quarantine"]);

    const approved = await useCase.approvePreparedTrainingDataset(
      {
        requestId: "quality-review-task",
        reportFingerprint: fingerprint,
      },
      { workspaceId: "workspace-a" },
    );
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.value.result.outputs.local?.dataset).toBeDefined();
      expect(approved.value.result.outputs.local?.report).toBeDefined();
      expect(approved.value.result.review?.state).toBe("approved");
    }
    expect(storedRoles).toEqual([
      "report",
      "quarantine",
      "dataset",
      "train",
    ]);
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
