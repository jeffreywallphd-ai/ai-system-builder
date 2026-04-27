import type {
  TransportEnvelope,
  TransportMetadata,
  TransportOperation,
} from "./transport-operation";

export interface TransportRequest<
  TPayload = unknown,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> extends TransportEnvelope<TOperation, TMetadata> {
  payload: TPayload;
}

export function createTransportRequest<
  TPayload,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
>(
  operation: TOperation,
  payload: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): TransportRequest<TPayload, TOperation, TMetadata> {
  return {
    operation,
    payload,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
    metadata: options?.metadata,
  };
}
