import {
  createTransportRequest,
  type TransportRequest,
} from "../transport";
import type { ApiMetadata, ApiOperation } from "./api-operation";

export interface ApiRequest<
  TPayload = unknown,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
> extends TransportRequest<TPayload, TOperation, TMetadata> {}

export function createApiRequest<
  TPayload,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
>(
  operation: TOperation,
  payload: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): ApiRequest<TPayload, TOperation, TMetadata> {
  return createTransportRequest(operation, payload, options);
}

