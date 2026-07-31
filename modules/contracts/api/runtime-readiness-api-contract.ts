import {
  normalizeRuntimeCapabilityId,
  type RuntimeCapabilityId,
  type RuntimeCapabilityStatus,
  type RuntimeReadinessSnapshot,
} from "../runtime";
import { createTransportOperation } from "../transport";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_RUNTIME_READINESS_READ_OPERATION = createTransportOperation(
  "runtime",
  "readiness-read",
);
export const API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION = createTransportOperation(
  "runtime",
  "capability-status-read",
);

export type ApiRuntimeReadinessReadRequest = ApiRequest<
  Record<string, never>,
  typeof API_RUNTIME_READINESS_READ_OPERATION,
  Record<string, never>
>;

export interface ApiRuntimeCapabilityStatusReadRequestPayload {
  capabilityId: RuntimeCapabilityId;
}

export type ApiRuntimeCapabilityStatusReadRequest = ApiRequest<
  ApiRuntimeCapabilityStatusReadRequestPayload,
  typeof API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  Record<string, never>
>;

export type ApiRuntimeReadinessReadResponse = ApiResponse<
  RuntimeReadinessSnapshot,
  Record<string, unknown>,
  typeof API_RUNTIME_READINESS_READ_OPERATION,
  Record<string, never>
>;

export type ApiRuntimeCapabilityStatusReadResponse = ApiResponse<
  RuntimeCapabilityStatus,
  Record<string, unknown>,
  typeof API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  Record<string, never>
>;

export function createApiRuntimeReadinessReadRequest(options?: {
  requestId?: string;
  correlationId?: string;
}): ApiRuntimeReadinessReadRequest {
  return createApiRequest(
    API_RUNTIME_READINESS_READ_OPERATION,
    {},
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiRuntimeCapabilityStatusReadRequest(
  payload: { capabilityId: string },
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiRuntimeCapabilityStatusReadRequest {
  return createApiRequest(
    API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
    { capabilityId: normalizeRuntimeCapabilityId(payload.capabilityId) },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiRuntimeReadinessReadSuccessResponse(
  value: RuntimeReadinessSnapshot,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiRuntimeReadinessReadResponse {
  return createApiSuccessResponse(API_RUNTIME_READINESS_READ_OPERATION, value, options);
}

export function createApiRuntimeCapabilityStatusReadSuccessResponse(
  value: RuntimeCapabilityStatus,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiRuntimeCapabilityStatusReadResponse {
  return createApiSuccessResponse(API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, value, options);
}

export function createApiRuntimeReadinessReadFailureResponse(
  code: "validation" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiRuntimeReadinessReadResponse {
  return createApiFailureResponse(
    createApiError(API_RUNTIME_READINESS_READ_OPERATION, code, message, options),
    options,
  );
}

export function createApiRuntimeCapabilityStatusReadFailureResponse(
  code: "validation" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiRuntimeCapabilityStatusReadResponse {
  return createApiFailureResponse(
    createApiError(API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, code, message, options),
    options,
  );
}
