import {
  type ContractError,
  type ContractErrorCode,
  type ContractErrorDetails,
  createContractError,
} from "../shared";
import type {
  TransportEnvelope,
  TransportMetadata,
  TransportOperation,
} from "./transport-operation";

export interface TransportError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> extends ContractError<TDetails>,
    TransportEnvelope<TOperation, TMetadata> {}

export function createTransportError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
>(
  operation: TOperation,
  code: ContractErrorCode,
  message: string,
  options?: {
    details?: TDetails;
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): TransportError<TDetails, TOperation, TMetadata> {
  const contractError = createContractError(code, message, {
    details: options?.details,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });

  return {
    ...contractError,
    operation,
    metadata: options?.metadata,
  };
}
