import {
  type ContractErrorDetails,
} from "../shared";
import {
  createTransportFailureResponse,
  createTransportSuccessResponse,
  type TransportFailureResponse,
  type TransportSuccessResponse,
} from "../transport";
import type { ApiError } from "./api-error";
import type { ApiMetadata, ApiOperation } from "./api-operation";

export type ApiSuccessResponse<
  TPayload,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
> = TransportSuccessResponse<TPayload, TOperation, TMetadata>;

export type ApiFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
> = Omit<TransportFailureResponse<TDetails, TOperation, TMetadata>, "error"> & {
    error: ApiError<TDetails, TOperation, TMetadata>;
  };

export type ApiResponse<
  TPayload,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
> =
  | ApiSuccessResponse<TPayload, TOperation, TMetadata>
  | ApiFailureResponse<TDetails, TOperation, TMetadata>;

export function createApiSuccessResponse<
  TPayload,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
>(
  operation: TOperation,
  value: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): ApiSuccessResponse<TPayload, TOperation, TMetadata> {
  return createTransportSuccessResponse(operation, value, options);
}

export function createApiFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends ApiOperation = ApiOperation,
  TMetadata extends ApiMetadata = ApiMetadata,
>(
  error: ApiError<TDetails, TOperation, TMetadata>,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): ApiFailureResponse<TDetails, TOperation, TMetadata> {
  const response = createTransportFailureResponse(error, options);

  return {
    ...response,
    error,
  };
}
