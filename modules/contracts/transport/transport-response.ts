import {
  type ContractErrorDetails,
  type ContractFailure,
  type ContractSuccess,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import type { TransportError } from "./transport-error";
import type {
  TransportEnvelope,
  TransportMetadata,
  TransportOperation,
} from "./transport-operation";

export type TransportSuccessResponse<
  TPayload,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> = TransportEnvelope<TOperation, TMetadata> & ContractSuccess<TPayload>;

export type TransportFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> = Omit<ContractFailure<TDetails>, "error"> &
  TransportEnvelope<TOperation, TMetadata> & {
    error: TransportError<TDetails, TOperation, TMetadata>;
  };

export type TransportResponse<
  TPayload,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> =
  | TransportSuccessResponse<TPayload, TOperation, TMetadata>
  | TransportFailureResponse<TDetails, TOperation, TMetadata>;

export function createTransportSuccessResponse<
  TPayload,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
>(
  operation: TOperation,
  value: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): TransportSuccessResponse<TPayload, TOperation, TMetadata> {
  const result = createSuccessResult(value, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });

  return {
    ...result,
    operation,
    metadata: options?.metadata,
  };
}

export function createTransportFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
>(
  error: TransportError<TDetails, TOperation, TMetadata>,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): TransportFailureResponse<TDetails, TOperation, TMetadata> {
  const result = createFailureResult(error, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });

  return {
    ...result,
    error,
    operation: error.operation,
    metadata: options?.metadata ?? error.metadata,
  };
}
