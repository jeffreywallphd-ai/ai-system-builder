import { describe, expect, it } from "../../testing/node-test";

import { createTransportError } from "./transport-error";
import {
  createTransportOperation,
  normalizeTransportOperation,
} from "./transport-operation";
import { createTransportRequest } from "./transport-request";
import {
  createTransportFailureResponse,
  createTransportSuccessResponse,
} from "./transport-response";

describe("transport contracts", () => {
  it("creates and normalizes operation identities with transport helpers", () => {
    expect(createTransportOperation("workspace", "create")).toBe("workspace.create");
    expect(normalizeTransportOperation(" Runtime.Tool.Run ")).toBe("runtime.tool.run");
  });

  it("rejects transport operation values that drift from the naming pattern", () => {
    expect(() => normalizeTransportOperation("workspace")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
    expect(() => normalizeTransportOperation("workspace/_create")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
  });

  it("creates a transport request with operation identity and boundary context", () => {
    const request = createTransportRequest(
      "workspace.create",
      { name: "alpha" },
      {
        requestId: "req-100",
        correlationId: "corr-200",
        metadata: { source: "desktop-ui" },
      },
    );

    expect(request).toEqual({
      operation: "workspace.create",
      payload: { name: "alpha" },
      requestId: "req-100",
      correlationId: "corr-200",
      metadata: { source: "desktop-ui" },
    });
  });

  it("creates a transport success response without transport-specific leakage", () => {
    const response = createTransportSuccessResponse(
      "workspace.create",
      { workspaceId: "ws-1" },
      {
        requestId: "req-101",
        correlationId: "corr-201",
      },
    );

    expect(response).toEqual({
      ok: true,
      value: { workspaceId: "ws-1" },
      requestId: "req-101",
      correlationId: "corr-201",
      operation: "workspace.create",
      metadata: undefined,
    });
  });

  it("creates a transport failure response from the shared error backbone", () => {
    const error = createTransportError(
      "workspace.create",
      "validation",
      "Workspace name is required",
      {
        details: { field: "name" },
        requestId: "req-102",
        metadata: { source: "api" },
      },
    );

    const response = createTransportFailureResponse(error, {
      correlationId: "corr-202",
    });

    expect(response).toEqual({
      ok: false,
      error: {
        operation: "workspace.create",
        code: "validation",
        message: "Workspace name is required",
        details: { field: "name" },
        requestId: "req-102",
        correlationId: undefined,
        metadata: { source: "api" },
      },
      operation: "workspace.create",
      requestId: "req-102",
      correlationId: "corr-202",
      metadata: { source: "api" },
    });
  });
});
