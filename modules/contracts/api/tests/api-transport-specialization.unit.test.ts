import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_UPLOAD_OPERATION,
  createApiError,
  createApiFailureResponse,
  createApiRequest,
  createApiSuccessResponse,
  resolveApiFailureKind,
  type ApiResponse,
} from "..";
import {
  createTransportFailureResponse,
  createTransportRequest,
  createTransportSuccessResponse,
  type TransportResponse,
} from "../../transport";
import { ARTIFACT_UPLOAD_OPERATION } from "../../artifact-upload";

describe("api transport specialization contracts", () => {

  it("reuses shared artifact-upload operation identity from canonical transport contract family", () => {
    expect(API_ARTIFACT_UPLOAD_OPERATION).toBe(ARTIFACT_UPLOAD_OPERATION);
  });
  it("creates an api request compatible with the transport request envelope", () => {
    const apiRequest = createApiRequest(
      "workspace.create",
      { name: "alpha" },
      {
        requestId: "req-300",
        correlationId: "corr-300",
        metadata: { surface: "web-thin-client" },
      },
    );

    const transportRequest = createTransportRequest(
      "workspace.create",
      { name: "alpha" },
      {
        requestId: "req-300",
        correlationId: "corr-300",
        metadata: { surface: "web-thin-client" },
      },
    );

    expect(apiRequest).toEqual(transportRequest);
  });

  it("maps contract error codes into api-only failure kinds", () => {
    expect(resolveApiFailureKind("validation")).toBe("client");
    expect(resolveApiFailureKind("rate-limited")).toBe("transient");
    expect(resolveApiFailureKind("internal")).toBe("server");
  });

  it("creates an api error with transport fields plus api-specific failure kind", () => {
    const error = createApiError(
      "workspace.create",
      "timeout",
      "Operation timed out",
      {
        details: { timeoutMs: 2000 },
        requestId: "req-301",
        metadata: { surface: "api" },
      },
    );

    expect(error).toEqual({
      operation: "workspace.create",
      code: "timeout",
      message: "Operation timed out",
      details: { timeoutMs: 2000 },
      requestId: "req-301",
      correlationId: undefined,
      metadata: { surface: "api" },
      kind: "transient",
    });
  });

  it("creates an api success response by preserving transport success semantics", () => {
    const apiResponse = createApiSuccessResponse(
      "workspace.create",
      { workspaceId: "ws-7" },
      {
        requestId: "req-302",
        correlationId: "corr-302",
      },
    );

    const transportResponse = createTransportSuccessResponse(
      "workspace.create",
      { workspaceId: "ws-7" },
      {
        requestId: "req-302",
        correlationId: "corr-302",
      },
    );

    expect(apiResponse).toEqual(transportResponse);
    expect("status" in apiResponse).toBe(false);
    expect("headers" in apiResponse).toBe(false);
  });

  it("creates an api failure response from transport failure semantics and retains api kind", () => {
    const error = createApiError(
      "workspace.create",
      "unavailable",
      "Backend unavailable",
      {
        requestId: "req-303",
        metadata: { surface: "server-host" },
      },
    );

    const apiResponse = createApiFailureResponse(error, {
      correlationId: "corr-303",
    });
    const transportResponse = createTransportFailureResponse(error, {
      correlationId: "corr-303",
    });

    expect(apiResponse).toEqual({
      ...transportResponse,
      error: {
        ...transportResponse.error,
        kind: "transient",
      },
    });
  });

  it("keeps api response assignable to the shared transport response contract", () => {
    const apiResponse: ApiResponse<
      { workspaceId: string },
      { reason?: string },
      "workspace.create",
      { surface: string }
    > = createApiSuccessResponse("workspace.create", { workspaceId: "ws-9" }, {
      metadata: { surface: "server-host" },
    });

    const asTransportResponse: TransportResponse<
      { workspaceId: string },
      { reason?: string },
      "workspace.create",
      { surface: string }
    > = apiResponse;

    expect(asTransportResponse).toEqual(apiResponse);
  });
});
