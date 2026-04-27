import {
  createOperationIdentity,
  isOperationIdentity,
  normalizeOperationIdentity,
  type OperationIdentity,
} from "../shared";

export type RuntimeOperation = OperationIdentity;

export function isRuntimeOperation(value: string): value is RuntimeOperation {
  return isOperationIdentity(value);
}

export function normalizeRuntimeOperation(operation: string): RuntimeOperation {
  return normalizeOperationIdentity(operation);
}

export function createRuntimeOperation(
  firstSegment: string,
  secondSegment: string,
  ...remainingSegments: readonly string[]
): RuntimeOperation {
  return createOperationIdentity(firstSegment, secondSegment, ...remainingSegments);
}
