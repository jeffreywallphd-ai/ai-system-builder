import {
  createTransportRequest,
  type TransportRequest,
} from "../transport";
import type { IpcChannel, IpcChannelValue } from "./ipc-channel";
import type { IpcMetadata, IpcOperation } from "./ipc-operation";

export interface IpcRequest<
  TPayload = unknown,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "request"> = IpcChannelValue<
    TOperation,
    "request"
  >,
> extends TransportRequest<TPayload, TOperation, TMetadata> {
  channel: TChannel;
}

export function createIpcRequest<
  TPayload,
  TOperation extends IpcOperation = IpcOperation,
  TMetadata extends IpcMetadata = IpcMetadata,
  TChannel extends IpcChannelValue<TOperation, "request"> = IpcChannelValue<
    TOperation,
    "request"
  >,
>(
  channel: IpcChannel<TOperation, "request", TChannel>,
  payload: TPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): IpcRequest<TPayload, TOperation, TMetadata, TChannel> {
  return {
    ...createTransportRequest(channel.operation, payload, options),
    channel: channel.value,
  };
}
