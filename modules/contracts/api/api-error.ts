import type { ContractErrorCode, ContractErrorDetails } from "../shared";
import {
  createTransportError,
  type TransportError,
} from "../transport";
import type { ApiMetadata, ApiOperation } from "./api-operation";

export type ApiFailureKind = "client" | "transient" | "server";

export interface ApiError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
> extends TransportError<TDetails, TOperation, TMetadata> {
  kind: ApiFailureKind;
}

export function resolveApiFailureKind(code: ContractErrorCode): ApiFailureKind {
  switch (code) {
    case "internal":
    case "unknown":
      return "server";
    case "timeout":
    case "unavailable":
    case "rate-limited":
      return "transient";
    default:
      return "client";
  }
}

export function createApiError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
>(
  operation: TOperation,
  code: ContractErrorCode,
  message: string,
  options?: {
    details?: TDetails;
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
    kind?: ApiFailureKind;
  },
): ApiError<TDetails, TOperation, TMetadata> {
  return {
    ...createTransportError(operation, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
      metadata: options?.metadata,
    }),
    kind: options?.kind ?? resolveApiFailureKind(code),
  };
}

