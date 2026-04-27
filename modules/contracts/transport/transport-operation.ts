import {
  createOperationIdentity,
  isOperationIdentity,
  normalizeOperationIdentity,
  type ContractBoundaryContext,
  type OperationIdentity,
} from "../shared";

export type TransportOperation = OperationIdentity;

export type TransportMetadata = Readonly<Record<string, unknown>>;

export interface TransportEnvelope<
  TOperation extends TransportOperation = TransportOperation,
  TMetadata extends TransportMetadata = TransportMetadata,
> extends ContractBoundaryContext {
  operation: TOperation;
  metadata?: TMetadata;
}

export function isTransportOperation(value: string): value is TransportOperation {
  return isOperationIdentity(value);
}

export function normalizeTransportOperation(operation: string): TransportOperation {
  return normalizeOperationIdentity(operation);
}

export function createTransportOperation(
  firstSegment: string,
  secondSegment: string,
  ...remainingSegments: readonly string[]
): TransportOperation {
  return createOperationIdentity(firstSegment, secondSegment, ...remainingSegments);
}
