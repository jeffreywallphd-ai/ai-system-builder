import { describe, expect, it } from "../../testing/node-test";

import {
  KNOWN_RUNTIME_KINDS,
  type PrepareTemplatedDatasetRequest,
  type PrepareTemplatedDatasetResult,
  type PythonRuntimeCapabilitiesResult,
  type PythonRuntimeHealthCheckResult,
  type PythonRuntimeHealthStatus,
  type PythonRuntimeOutputDescriptor,
  type PythonRuntimeTaskRequest,
  type PythonRuntimeTaskResult,
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
        "prepare-templated-dataset",
        "future-task-type",
      ],
    };

    expect(capabilities.runtimeId).toBe("python-sidecar-1");
    expect(capabilities.capabilities).toContain("prepare-templated-dataset");
  });

  it("uses runtime output descriptors as canonical output handoff contracts", () => {
    const output: PythonRuntimeOutputDescriptor = {
      name: "dataset-train",
      role: "train",
      tempPath: "/tmp/runtime/train.jsonl",
      mediaType: "application/x-ndjson",
      sizeBytes: 1024,
      metadata: {
        partition: "train",
      },
    };

    expect(output).toMatchObject({
      name: "dataset-train",
      role: "train",
      tempPath: "/tmp/runtime/train.jsonl",
      mediaType: "application/x-ndjson",
    });
  });

  it("keeps generic python runtime task request/result envelopes stable and metadata-friendly", () => {
    const request: PythonRuntimeTaskRequest = {
      requestId: "req-python-1",
      taskType: "prepare-templated-dataset",
      payload: {
        sourceArtifactIds: ["artifact-1"],
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

  it("keeps dataset preparation contracts task-specific while using shared output descriptors", () => {
    const request: PrepareTemplatedDatasetRequest = {
      sourceArtifactIds: ["artifact-1", "artifact-2"],
      template: "Summarize: {{text}}",
      split: {
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: 42,
      },
      outputFormat: "jsonl",
      shuffle: true,
      validationPolicy: "strict",
      outputNaming: {
        baseName: "support-ticket-dataset",
      },
    };

    const result: PrepareTemplatedDatasetResult = {
      outputs: [
        {
          name: "support-ticket-dataset-train",
          role: "train",
          tempPath: "/tmp/runtime/support-ticket-dataset-train.jsonl",
          mediaType: "application/x-ndjson",
        },
        {
          name: "support-ticket-dataset-test",
          role: "test",
          tempPath: "/tmp/runtime/support-ticket-dataset-test.jsonl",
          mediaType: "application/x-ndjson",
        },
      ],
      trainRowCount: 800,
      testRowCount: 200,
      warnings: ["Some rows were skipped because required fields were missing."],
    };

    expect(request.validationPolicy).toBe("strict");
    expect(result.outputs.length).toBe(2);
    expect(result.outputs.map((output) => output.role)).toEqual(["train", "test"]);
    expect(result.trainRowCount + result.testRowCount).toBe(1000);
  });
});
