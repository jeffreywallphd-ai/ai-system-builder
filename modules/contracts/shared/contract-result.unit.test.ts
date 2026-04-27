import { describe, expect, it } from "../../testing/node-test";

import { createContractError } from "./contract-error";
import {
  createFailureResult,
  createSuccessResult,
  isContractFailure,
  isContractSuccess,
} from "./contract-result";

describe("contract-result", () => {
  it("creates a success result with optional boundary context", () => {
    const result = createSuccessResult(
      { runId: "run-1" },
      { correlationId: "corr-1", requestId: "req-1" },
    );

    expect(result).toEqual({
      ok: true,
      value: { runId: "run-1" },
      correlationId: "corr-1",
      requestId: "req-1",
    });
    expect(isContractSuccess(result)).toBe(true);
    expect(isContractFailure(result)).toBe(false);
  });

  it("creates a failure result and preserves machine-usable error code", () => {
    const error = createContractError("timeout", "Task timed out", {
      details: { timeoutMs: 1000 },
      requestId: "req-2",
    });

    const result = createFailureResult(error, { correlationId: "corr-2" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "Task timed out",
        details: { timeoutMs: 1000 },
        correlationId: undefined,
        requestId: "req-2",
      },
      correlationId: "corr-2",
      requestId: "req-2",
    });
    expect(isContractSuccess(result)).toBe(false);
    expect(isContractFailure(result)).toBe(true);
  });

  it("supports failure result creation without context fields", () => {
    const error = createContractError("validation", "Input is invalid");
    const result = createFailureResult(error);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "Input is invalid",
        details: undefined,
        correlationId: undefined,
        requestId: undefined,
      },
      correlationId: undefined,
      requestId: undefined,
    });
  });
});
