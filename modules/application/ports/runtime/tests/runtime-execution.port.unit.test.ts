import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";

import {
  createRuntimeExecutionError,
  createRuntimeExecutionProgressEvent,
  createRuntimeExecutionRequest,
  createRuntimeTarget,
  type RuntimeExecutionEvent,
  type RuntimeExecutionRequest,
  type RuntimeExecutionResult,
} from "../../../../contracts/runtime";

import type {
  RuntimeExecutionHandlers,
  RuntimeExecutionPort,
} from "../runtime-execution.port";

describe("RuntimeExecutionPort", () => {
  it("keeps a thin seam with execute request, optional handlers, and runtime result", () => {
    expectTypeOf<keyof RuntimeExecutionPort>().toEqualTypeOf<"execute">();

    expectTypeOf<Parameters<RuntimeExecutionPort["execute"]>[0]>().toExtend<
      RuntimeExecutionRequest
    >();
    expectTypeOf<Parameters<RuntimeExecutionPort["execute"]>[1]>().toEqualTypeOf<
      RuntimeExecutionHandlers<unknown> | undefined
    >();
    expectTypeOf<Awaited<ReturnType<RuntimeExecutionPort["execute"]>>>().toEqualTypeOf<
      RuntimeExecutionResult<unknown>
    >();
  });

  it("passes request and runtime events through execute without adding extra seam methods", async () => {
    const request = createRuntimeExecutionRequest("workspace.create", { name: "Alpha" }, {
      executionId: "exec-runtime-1",
      runtimeKind: "local",
      requestId: "req-runtime-1",
      correlationId: "corr-runtime-1",
      executionOptions: {
        emitProgress: true,
      },
    });

    const onEvent = testDouble.fn<(event: RuntimeExecutionEvent<string>) => void>();
    const handlers: RuntimeExecutionHandlers<string> = { onEvent };

    const executeCalls: RuntimeExecutionRequest[] = [];
    const execute: RuntimeExecutionPort["execute"] = async (incomingRequest, incomingHandlers) => {
      executeCalls.push(incomingRequest);

      incomingHandlers?.onEvent?.(
        createRuntimeExecutionProgressEvent(
          incomingRequest.operation,
          incomingRequest.executionId,
          incomingRequest.target,
          "invoking",
          {
            sequence: 1,
            requestId: incomingRequest.requestId,
            correlationId: incomingRequest.correlationId,
          },
        ),
      );

      return {
        ok: false,
        error: createRuntimeExecutionError(
          incomingRequest.operation,
          incomingRequest.executionId,
          incomingRequest.target,
          "internal",
          "Execution failed.",
          {
            requestId: incomingRequest.requestId,
            correlationId: incomingRequest.correlationId,
          },
        ),
        operation: incomingRequest.operation,
        executionId: incomingRequest.executionId,
        target: incomingRequest.target,
        requestId: incomingRequest.requestId,
        correlationId: incomingRequest.correlationId,
      };
    };

    const port: RuntimeExecutionPort = { execute };
    const result = await port.execute(request, handlers);

    expect(executeCalls).toEqual([request]);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "progress",
      operation: "workspace.create",
      executionId: "exec-runtime-1",
      stage: "invoking",
      sequence: 1,
      requestId: "req-runtime-1",
      correlationId: "corr-runtime-1",
    });

    expect(result.ok).toBe(false);
    expect(result.operation).toBe("workspace.create");
    expect(result.executionId).toBe("exec-runtime-1");
    expect(result.target).toEqual(createRuntimeTarget("local"));
  });
});
