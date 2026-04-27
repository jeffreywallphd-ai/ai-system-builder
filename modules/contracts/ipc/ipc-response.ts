import {
  type ContractErrorDetails,
} from "../shared";
import {
  createTransportFailureResponse,
  createTransportSuccessResponse,
  type TransportFailureResponse,
  type TransportSuccessResponse,
} from "../transport";
import type { IpcChannel, IpcChannelValue } from "./ipc-channel";
import type { IpcError } from "./ipc-error";
import type { IpcMetadata, IpcOperation } from "./ipc-operation";

export type IpcSuccessResponse<
  TPayload,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<
    TOperation,
    "response"
  >,
> = TransportSuccessResponse<TPayload, TOperation, TMetadata> & {
  channel: TChannel;
};

export type IpcFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<
    TOperation,
    "response"
  >,
> = Omit<TransportFailureResponse<TDetails, TOperation, TMetadata>, "error"> & {
    channel: TChannel;
    error: IpcError<TDetails, TOperation, TMetadata, TChannel>;
  };

export type IpcResponse<
  TPayload,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<
    TOperation,
    "response"
  >,
> =
  | IpcSuccessResponse<TPayload, TOperation, TMetadata, TChannel>
  | IpcFailureResponse<TDetails, TOperation, TMetadata, TChannel>;

export function createIpcSuccessResponse<
  TPayload,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<
    TOperation,
    "response"
  >,
>(
  channel: IpcChannel<TOperation, "response", TChannel>,
  value: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): IpcSuccessResponse<TPayload, TOperation, TMetadata, TChannel> {
  const result = createTransportSuccessResponse(channel.operation, value, options);

  return {
    ...result,
    channel: channel.value,
  };
}

export function createIpcFailureResponse<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<
    TOperation,
    "response"
  >,
>(
  error: IpcError<TDetails, TOperation, TMetadata, TChannel>,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): IpcFailureResponse<TDetails, TOperation, TMetadata, TChannel> {
  const result = createTransportFailureResponse(error, options);

  return {
    ...result,
    channel: error.channel,
    error,
  };
}
