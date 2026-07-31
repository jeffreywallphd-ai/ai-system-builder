import type { RuntimeReadinessPort } from "../../../../application/ports/runtime";
import {
  createApiRuntimeCapabilityStatusReadFailureResponse,
  createApiRuntimeCapabilityStatusReadSuccessResponse,
  createApiRuntimeReadinessReadFailureResponse,
  createApiRuntimeReadinessReadSuccessResponse,
} from "../../../../contracts/api";
import { normalizeRuntimeCapabilityId } from "../../../../contracts/runtime";

interface ExpressRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
}

interface ExpressResponseLike {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => void;
}

export interface ExpressRoutePort {
  get: (
    path: string,
    handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>,
  ) => void;
}

export interface RegisterRuntimeReadinessApiRoutesDependencies {
  app: ExpressRoutePort;
  runtimeReadiness: RuntimeReadinessPort;
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => {
  const value = headers?.[key];
  return Array.isArray(value) ? value[0] : value;
};

const contextFrom = (request: ExpressRequestLike) => ({
  requestId: getHeader(request.headers, "x-request-id"),
  correlationId: getHeader(request.headers, "x-correlation-id"),
});

export function registerRuntimeReadinessApiRoutes(
  dependencies: RegisterRuntimeReadinessApiRoutesDependencies,
): void {
  dependencies.app.get("/api/runtime/readiness", async (request, response) => {
    const context = contextFrom(request);
    try {
      const snapshot = await dependencies.runtimeReadiness.getReadinessSnapshot();
      response.status(200).json(createApiRuntimeReadinessReadSuccessResponse(snapshot, context));
    } catch {
      response.status(500).json(createApiRuntimeReadinessReadFailureResponse(
        "internal",
        "Unable to read runtime readiness.",
        context,
      ));
    }
  });

  dependencies.app.get("/api/runtime/capabilities/:capabilityId", async (request, response) => {
    const context = contextFrom(request);
    let capabilityId;
    try {
      capabilityId = normalizeRuntimeCapabilityId(request.params?.capabilityId ?? "");
    } catch {
      response.status(400).json(createApiRuntimeCapabilityStatusReadFailureResponse(
        "validation",
        "Unknown runtime capability id.",
        {
          ...context,
          details: { capabilityId: request.params?.capabilityId ?? "" },
        },
      ));
      return;
    }

    try {
      const status = await dependencies.runtimeReadiness.getCapabilityStatus(capabilityId);
      response.status(200).json(createApiRuntimeCapabilityStatusReadSuccessResponse(status, context));
    } catch {
      response.status(500).json(createApiRuntimeCapabilityStatusReadFailureResponse(
        "internal",
        "Unable to read runtime capability status.",
        context,
      ));
    }
  });
}
