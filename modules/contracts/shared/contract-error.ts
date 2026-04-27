import type { ContractErrorCode } from "./contract-error-code";

export type ContractErrorDetails = Readonly<Record<string, unknown>>;

export interface ContractBoundaryContext {
  correlationId?: string;
  requestId?: string;
}

export interface ContractError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> extends ContractBoundaryContext {
  code: ContractErrorCode;
  message: string;
  details?: TDetails;
}

export function createContractError<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  code: ContractErrorCode,
  message: string,
  options?: {
    details?: TDetails;
    correlationId?: string;
    requestId?: string;
  },
): ContractError<TDetails> {
  return {
    code,
    message,
    details: options?.details,
    correlationId: options?.correlationId,
    requestId: options?.requestId,
  };
}
