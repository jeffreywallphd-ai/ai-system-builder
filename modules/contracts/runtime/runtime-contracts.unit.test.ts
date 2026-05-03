import { describe, expect, it } from "../../testing/node-test";

import {
  type DatasetOutputConfig,
  type DatasetPreparationRecipe,
  type DatasetPreparationSourceInput,
  type DatasetPreparationSummary,
  type DatasetPreparationWarning,
  type DatasetSplitConfig,
  KNOWN_RUNTIME_KINDS,
  type PrepareTrainingDatasetRequest,
  type PrepareTrainingDatasetResult,
  type PythonRuntimeCapabilitiesResult,
  PYTHON_RUNTIME_CAPABILITY_DATASET_PREPARATION_AUTO_INFERENCE_MODE,
  PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES,
  type PythonRuntimeHealthCheckResult,
  type PythonRuntimeHealthStatus,
  type PythonRuntimeOutputDescriptor,
  type PythonRuntimeTaskRequest,
  type PythonRuntimeTaskResult,
  type PythonRuntimeTaskStatus,
  type RuntimeTaskError,
  type RuntimeTaskStatus,
  type RuntimeTaskConcurrencyClass,
  type StartRuntimeTaskRequest,
  type StartRuntimeTaskResult,
  type CancelRuntimeTaskResult,
  type RuntimeTaskListRequest,
  type RuntimeTaskListResult,
  type RuntimeTaskRecord,
  type RuntimeTaskRetentionPolicy,
  TaskType,
  createRuntimeOperation,
  createRuntimeExecutionDiagnostic,
  createRuntimeExecutionError,
  createRuntimeExecutionFailureResult,
  createRuntimeExecutionProgressEvent,
  createRuntimeExecutionRequest,
  createRuntimeExecutionSuccessResult,
  createRuntimeTarget,
  isRuntimeDiagnosticEvent,
  mapRuntimeDiagnosticToStructuredLogEvent,
  normalizeRuntimeDiagnosticEvent,
  isKnownRuntimeKind,
  normalizeRuntimeOperation,
  resolveRuntimeKind,
} from ".";

describe("runtime contracts", () => {
  it("normalizes and validates runtime operation identity naming", () => {
    expect(createRuntimeOperation("assistant", "plan")).toBe("assistant.plan");
    expect(normalizeRuntimeOperation(" Runtime.Tool.Run ")).toBe("runtime.tool.run");
    expect(() => normalizeRuntimeOperation("tool_run")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
  });

  it("exposes known runtime kinds while allowing future adapter kinds", () => {
    expect(KNOWN_RUNTIME_KINDS).toEqual(["node", "python"]);
    expect(isKnownRuntimeKind("node")).toBe(true);
    expect(isKnownRuntimeKind("java")).toBe(false);
    expect(resolveRuntimeKind(undefined)).toBe("node");
    expect(resolveRuntimeKind(" PYTHON ")).toBe("python");
    expect(resolveRuntimeKind("java")).toBe("java");
  });

  it("creates runtime execution requests with target and correlation context", () => {
    const request = createRuntimeExecutionRequest(
      "assistant.plan",
      { prompt: "summarize" },
      {
        executionId: "exec-1",
        runtimeKind: "node",
        requestId: "req-1",
        correlationId: "corr-1",
        causationId: "cause-1",
        executionOptions: {
          timeoutMs: 1000,
          emitProgress: true,
          includeDiagnostics: true,
        },
        metadata: { source: "server-host" },
      },
    );

    expect(request).toEqual({
      executionId: "exec-1",
      operation: "assistant.plan",
      input: { prompt: "summarize" },
      target: {
        kind: "node",
        adapter: undefined,
        capability: undefined,
        metadata: undefined,
      },
      requestId: "req-1",
      correlationId: "corr-1",
      causationId: "cause-1",
      options: {
        timeoutMs: 1000,
        emitProgress: true,
        includeDiagnostics: true,
      },
      metadata: { source: "server-host" },
    });
  });

  it("creates runtime success and failure results from the shared result backbone", () => {
    const target = createRuntimeTarget("python", { adapter: "python-subprocess" });

    const success = createRuntimeExecutionSuccessResult(
      "tool.run",
      "exec-2",
      target,
      { stdout: "ok" },
      {
        completedAt: "2026-04-14T12:00:00.000Z",
        durationMs: 42,
        requestId: "req-2",
      },
    );

    expect(success).toEqual({
      ok: true,
      value: {
        output: { stdout: "ok" },
        completedAt: "2026-04-14T12:00:00.000Z",
        durationMs: 42,
        diagnostics: undefined,
      },
      requestId: "req-2",
      correlationId: undefined,
      operation: "tool.run",
      executionId: "exec-2",
      target: {
        kind: "python",
        adapter: "python-subprocess",
        capability: undefined,
        metadata: undefined,
      },
      metadata: undefined,
    });

    const error = createRuntimeExecutionError(
      "tool.run",
      "exec-2",
      target,
      "timeout",
      "Runtime exceeded timeout",
      {
        details: {
          phase: "execution",
          retryable: true,
          targetKind: "python",
        },
        requestId: "req-2",
      },
    );

    const failure = createRuntimeExecutionFailureResult(error, {
      correlationId: "corr-2",
    });

    expect(failure).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "Runtime exceeded timeout",
        details: {
          phase: "execution",
          retryable: true,
          targetKind: "python",
        },
        requestId: "req-2",
        correlationId: undefined,
        operation: "tool.run",
        executionId: "exec-2",
        target: {
          kind: "python",
          adapter: "python-subprocess",
          capability: undefined,
          metadata: undefined,
        },
      },
      requestId: "req-2",
      correlationId: "corr-2",
      operation: "tool.run",
      executionId: "exec-2",
      target: {
        kind: "python",
        adapter: "python-subprocess",
        capability: undefined,
        metadata: undefined,
      },
      metadata: undefined,
    });
  });

  it("creates progress events with structured diagnostics aligned to logging contracts", () => {
    const event = createRuntimeExecutionProgressEvent(
      "tool.run",
      "exec-3",
      createRuntimeTarget("node"),
      "dispatch",
      {
        sequence: 1,
        percent: 25,
        diagnostic: {
          timestamp: "2026-04-14T12:00:01.000Z",
          level: "info",
          verbosity: "normal",
          event: "runtime.dispatch.started",
          message: "Dispatch started",
          component: "runtime-adapter",
        },
      },
    );

    expect(event.type).toBe("progress");
    expect(event).toMatchObject({
      operation: "tool.run",
      executionId: "exec-3",
      stage: "dispatch",
      sequence: 1,
      percent: 25,
      diagnostic: {
        level: "info",
        verbosity: "normal",
        event: "runtime.dispatch.started",
      },
    });
  });

  it("normalizes runtime diagnostics as a runtime.* specialization of shared log vocabulary", () => {
    const diagnostic = createRuntimeExecutionDiagnostic({
      timestamp: "2026-04-14T12:00:01.000Z",
      level: "debug",
      verbosity: "verbose",
      event: " RUNTIME.Dispatch.Started ",
      message: "Dispatch started",
      component: "runtime-adapter",
      stage: "dispatch",
      executionId: "exec-4",
      outcome: "success",
      durationMs: 12,
    });

    expect(diagnostic.event).toBe("runtime.dispatch.started");
    expect(isRuntimeDiagnosticEvent(diagnostic.event)).toBe(true);
    expect(normalizeRuntimeDiagnosticEvent("runtime.execution.completed")).toBe(
      "runtime.execution.completed",
    );
    expect(() => normalizeRuntimeDiagnosticEvent("dispatch.started")).toThrow(
      "Runtime diagnostic events must use the runtime.* namespace",
    );
  });

  it("maps runtime diagnostics into the shared structured log envelope", () => {
    const diagnostic = createRuntimeExecutionDiagnostic({
      timestamp: "2026-04-14T12:00:02.000Z",
      level: "info",
      verbosity: "normal",
      event: "runtime.dispatch.completed",
      message: "Dispatch completed",
      component: "runtime-adapter",
      operation: "tool.run",
      outcome: "success",
      durationMs: 45,
      data: { stage: "dispatch" },
    });

    const logEvent = mapRuntimeDiagnosticToStructuredLogEvent(diagnostic, {
      host: "server",
      requestId: "req-3",
      correlationId: "corr-3",
      useCase: "run-tool",
    });

    expect(logEvent).toEqual({
      timestamp: "2026-04-14T12:00:02.000Z",
      level: "info",
      verbosity: "normal",
      event: "runtime.dispatch.completed",
      message: "Dispatch completed",
      component: "runtime-adapter",
      operation: "tool.run",
      useCase: "run-tool",
      host: "server",
      subsystem: undefined,
      outcome: "success",
      durationMs: 45,
      data: { stage: "dispatch" },
      error: undefined,
      requestId: "req-3",
      correlationId: "corr-3",
    });
  });
});

describe("python sidecar runtime contracts", () => {
  it("models health status and health checks with explicit lifecycle states", () => {
    const status: PythonRuntimeHealthStatus = {
      runtimeId: "python-sidecar-1",
      status: "degraded",
      version: "0.1.0",
      pythonVersion: "3.12.2",
      workerStartedAt: "2026-04-20T11:00:00.000Z",
      lastHeartbeatAt: "2026-04-20T11:00:30.000Z",
    };

    const healthCheck: PythonRuntimeHealthCheckResult = {
      healthy: false,
      status,
      error: {
        code: "heartbeat_stale",
        message: "Heartbeat is stale.",
        retryable: true,
        details: {
          staleByMs: 120000,
        },
      },
      message: "Python runtime heartbeat exceeded threshold.",
    };

    expect(healthCheck.status.status).toBe("degraded");
    expect(healthCheck.error?.code).toBe("heartbeat_stale");
    expect(healthCheck.error?.retryable).toBe(true);
  });

  it("models runtime capabilities as sidecar-advertised task types", () => {
    const capabilities: PythonRuntimeCapabilitiesResult = {
      runtimeId: "python-sidecar-1",
      capabilities: [
        "prepare-training-dataset",
        PYTHON_RUNTIME_CAPABILITY_DATASET_PREPARATION_AUTO_INFERENCE_MODE,
        "future-task-type",
      ],
    };

    expect(capabilities.runtimeId).toBe("python-sidecar-1");
    expect(capabilities.capabilities).toContain("prepare-training-dataset");
    expect(PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES).toEqual([
      "prepare-training-dataset",
      "dataset-preparation.auto-inference-mode",
    ]);
  });

  it("uses runtime output descriptors as canonical output handoff contracts", () => {
    const output: PythonRuntimeOutputDescriptor = {
      name: "dataset",
      role: "dataset",
      tempPath: "/tmp/runtime/dataset.jsonl",
      mediaType: "application/x-ndjson",
      sizeBytes: 1024,
      metadata: {
        partition: "dataset",
      },
    };

    expect(output).toMatchObject({
      name: "dataset",
      role: "dataset",
      tempPath: "/tmp/runtime/dataset.jsonl",
      mediaType: "application/x-ndjson",
    });
  });

  it("keeps generic python runtime task request/result envelopes stable and metadata-friendly", () => {
    const request: PythonRuntimeTaskRequest = {
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      payload: {
        sourceInputs: [{ artifactId: "artifact-1", localPath: "/tmp/a.jsonl", mediaType: "application/x-ndjson" }],
      },
      timeoutMs: 10000,
      metadata: {
        initiatedBy: "application",
      },
    };
    const result: PythonRuntimeTaskResult = {
      requestId: request.requestId,
      taskType: request.taskType,
      success: false,
      error: {
        code: "validation_failed",
        message: "Payload validation failed.",
        retryable: false,
      },
      metadata: {
        stage: "validation",
      },
    };

    expect(result.requestId).toBe(request.requestId);
    expect(result.taskType).toBe(request.taskType);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("validation_failed");
  });

  it("keeps dataset preparation contracts task-specific with recipe, split, output, summary, and warnings", () => {
    const sourceInputs: DatasetPreparationSourceInput[] = [
      { artifactId: "artifact-1", localPath: "/tmp/a.md", mediaType: "text/markdown", originalName: "a.md" },
      { artifactId: "artifact-2", localPath: "/tmp/b.pdf", mediaType: "application/pdf", originalName: "b.pdf" },
    ];
    const recipe: DatasetPreparationRecipe = {
      normalization: {
        targetFormat: "markdown",
        unsupportedDocumentPolicy: "skip",
        normalizationMode: "best-effort",
      },
      chunking: {
        strategy: "character",
        chunkSize: 800,
        chunkOverlap: 120,
        preserveDocumentBoundaries: true,
      },
      generation: {
        mode: "qa",
        model: {
          provider: "transformers",
          modelId: "Qwen/Qwen2.5-3B-Instruct",
          inferenceMode: "chat",
          device: "auto",
          torchDtype: "bfloat16",
        },
        promptTemplate: "Generate QA examples from this chunk.",
        maxExamplesPerChunk: 4,
        generationParams: {
          temperature: 0.2,
          topP: 0.9,
          maxNewTokens: 256,
        },
        failurePolicy: "skip",
      },
    };
    const split: DatasetSplitConfig = {
      trainRatio: 0.8,
      testRatio: 0.2,
      seed: 42,
      shuffle: true,
    };
    const output: DatasetOutputConfig = {
      format: "jsonl",
      naming: {
        baseName: "support-ticket-dataset",
      },
      destinations: {
        local: { enabled: true },
        huggingFace: {
          enabled: true,
          provider: "huggingface",
          repository: "acme/support-dataset",
          revision: "main",
          pathPrefix: "prepared",
        },
      },
    };

    const request: PrepareTrainingDatasetRequest = {
      sourceInputs,
      recipe,
      split,
      output,
    };

    const summary: DatasetPreparationSummary = {
      sourceDocumentCount: 2,
      normalizedDocumentCount: 2,
      skippedDocumentCount: 0,
      chunkCount: 14,
      generatedExampleCount: 56,
      datasetRowCount: 56,
      trainRowCount: 56,
      testRowCount: 0,
    };
    const warnings: DatasetPreparationWarning[] = [{
      code: "source_media_type_inferred",
      message: "Inferred media type from extension.",
      sourceArtifactId: "artifact-2",
    }];

    const result: PrepareTrainingDatasetResult = {
      outputs: [
        {
          name: "support-ticket-dataset",
          role: "dataset",
          tempPath: "/tmp/runtime/support-ticket-dataset.jsonl",
          mediaType: "application/x-ndjson",
        },
      ],
      summary,
      warnings,
    };

    expect(request.recipe.generation.mode).toBe("qa");
    expect(request.recipe.generation.model.inferenceMode).toBe("chat");
    expect(request.recipe.normalization.targetFormat).toBe("markdown");
    expect(request.recipe.chunking.strategy).toBe("character");
    expect(request.split.shuffle).toBe(true);
    expect(request.output.naming?.baseName).toBe("support-ticket-dataset");
    expect(request.output.destinations?.huggingFace?.repository).toBe("acme/support-dataset");
    expect(result.outputs.length).toBe(1);
    expect(result.outputs.map((output) => output.role)).toEqual(["dataset"]);
    expect(result.summary.datasetRowCount).toBe(56);
    expect(result.warnings?.[0]?.code).toBe("source_media_type_inferred");
  });

  it("restricts local model inference mode to explicit supported literals", () => {
    const autoModel: DatasetPreparationRecipe["generation"]["model"] = {
      provider: "transformers",
      modelId: "Qwen/Qwen3-1.7B",
      inferenceMode: "auto",
    };
    const text2textModel: DatasetPreparationRecipe["generation"]["model"] = {
      provider: "transformers",
      modelId: "google/flan-t5-base",
      inferenceMode: "text2text",
    };
    const causalModel: DatasetPreparationRecipe["generation"]["model"] = {
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-3B",
      inferenceMode: "causal",
    };
    const chatModel: DatasetPreparationRecipe["generation"]["model"] = {
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-3B-Instruct",
      inferenceMode: "chat",
    };

    expect([autoModel, text2textModel, causalModel, chatModel].map((model) => model.inferenceMode)).toEqual([
      "auto",
      "text2text",
      "causal",
      "chat",
    ]);

    const invalidModel: DatasetPreparationRecipe["generation"]["model"] = {
      provider: "transformers",
      modelId: "broken/model",
      // @ts-expect-error Inference mode is intentionally narrow and explicit.
      inferenceMode: "seq2seq",
    };
    expect(invalidModel).toBeDefined();
  });
});


describe("train-model runtime contracts", () => {
  it("defines python-friendly train-model request/result shapes", () => {
    const request: import(".").TrainModelTaskRequest = {
      baseModel: { modelRecordId: "base-1", modelId: "org/base" },
      datasets: [{ artifactId: "dataset-1", splitRole: "train", format: "jsonl" }],
      method: "lora",
      commonParameters: { numEpochs: 3, learningRate: 0.0002 },
      output: { outputModelName: "demo-adapter", outputDirectory: "/tmp/output" },
      runMetadata: { source: "desktop" },
    };

    const result: import(".").TrainModelTaskResult = {
      runId: "run-1",
      status: "failed",
      warnings: ["lora only"],
      error: { code: "unsupported_method", message: "qlora is not implemented" },
    };

    expect(request.method).toBe("lora");
    expect(result.error?.code).toBe("unsupported_method");
  });
});

describe("python runtime async task contracts", () => {
  it("defines start-task request/result and status/cancel result shapes", () => {
    const startRequest: import(".").StartPythonRuntimeTaskRequest = {
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      payload: { sourceArtifactId: "artifact-1" },
      metadata: { source: "desktop" },
      timeoutMs: 30_000,
    };
    const startResult: import(".").StartPythonRuntimeTaskResult = {
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      accepted: true,
      status: "queued",
    };
    const statusResult: import(".").PythonRuntimeTaskStatusResult = {
      requestId: "task-1",
      status: "running",
      progress: { completedSteps: 1 },
    };
    const cancelResult: import(".").CancelPythonRuntimeTaskResult = {
      requestId: "task-1",
      status: "cancelled",
      cancelled: true,
    };

    expect(startRequest.requestId).toBe("task-1");
    expect(startResult.accepted).toBe(true);
    expect(statusResult.status).toBe("running");
    expect(cancelResult.cancelled).toBe(true);
  });

  it("enforces required async contract fields at compile time", () => {
    // @ts-expect-error requestId is required.
    const invalidStartRequest: import(".").StartPythonRuntimeTaskRequest = { taskType: "x", payload: {} };
    // @ts-expect-error cancelled is required.
    const invalidCancelResult: import(".").CancelPythonRuntimeTaskResult = { requestId: "x", status: "unknown" };
    expect(invalidStartRequest).toBeDefined();
    expect(invalidCancelResult).toBeDefined();
  });
});

describe("runtime task registry contracts", () => {
  it("defines shared runtime task type and lifecycle status literals", () => {
    const taskTypes = Object.values(TaskType);
    expect(taskTypes).toEqual([
      "dataset-preparation",
      "model-training",
      "model-validation",
      "model-publishing",
      "image-generation",
    ]);

    const statuses: RuntimeTaskStatus[] = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "unknown",
    ];
    expect(statuses).toContain("succeeded");
    const pythonStatuses: PythonRuntimeTaskStatus[] = statuses;
    expect(pythonStatuses).toContain("queued");
  });

  it("defines runtime task concurrency classes and task record shape", () => {
    const concurrencyClass: RuntimeTaskConcurrencyClass = "cpu-heavy";

    const record: RuntimeTaskRecord = {
      requestId: "req-rt-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "running",
      concurrencyClass,
      progress: { message: "step", current: 1, total: 4, unit: "step", percent: 25 },
      error: { code: "transient", message: "retry later", retryable: true, stage: "dispatch" },
      metadata: { source: "desktop" },
      queuedAt: "2026-04-29T00:00:00.000Z",
      startedAt: "2026-04-29T00:00:05.000Z",
      updatedAt: "2026-04-29T00:00:10.000Z",
    };

    expect(record.concurrencyClass).toBe("cpu-heavy");
    expect(record.progress?.percent).toBe(25);
    expect((record.progress?.percent ?? -1) >= 0).toBe(true);
    expect((record.progress?.percent ?? 101) <= 100).toBe(true);
    expect(record.error?.code).toBe("transient");
  });

  it("defines task listing and retention policy contracts", () => {
    const listRequest: RuntimeTaskListRequest = {
      statuses: ["queued", "running"],
      taskTypes: [TaskType.DATASET_PREPARATION],
      includeCompleted: false,
      limit: 50,
    };

    const listResult: RuntimeTaskListResult = {
      tasks: [],
    };

    const genericError: RuntimeTaskError = { code: "runtime_failed", message: "failed" };

    const retention: RuntimeTaskRetentionPolicy = {
      completedTaskTtlMs: 600_000,
      maxCompletedTasks: 1_000,
      cleanupIntervalMs: 30_000,
    };

    expect(listRequest.limit).toBe(50);
    expect(Array.isArray(listResult.tasks)).toBe(true);
    expect(retention.maxCompletedTasks).toBe(1_000);
    expect(genericError.message).toBe("failed");
  });

  it("defines generic runtime task start and cancel contracts", () => {
    const startRequest: StartRuntimeTaskRequest = {
      requestId: "req-caller-1",
      taskType: TaskType.DATASET_PREPARATION,
      concurrencyClass: "cpu-heavy",
      payload: { sourceIds: ["a1"] },
      metadata: { caller: "test" },
    };

    const started: StartRuntimeTaskResult = { requestId: "req-start-1" };
    const cancelled: CancelRuntimeTaskResult = {
      requestId: started.requestId,
      status: "cancelled",
      cancelled: true,
    };

    const startRequestWithoutRequestId: StartRuntimeTaskRequest = {
      taskType: TaskType.DATASET_PREPARATION,
      payload: { sourceIds: ["a1"] },
    };

    expect(startRequest.requestId).toBe("req-caller-1");
    expect(startRequestWithoutRequestId.requestId).toBeUndefined();
    expect(startRequest.taskType).toBe(TaskType.DATASET_PREPARATION);
    expect(started.requestId).toBe("req-start-1");
    expect(cancelled.cancelled).toBe(true);
  });
});
