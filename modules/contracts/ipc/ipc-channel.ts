import {
  isTransportOperation,
  normalizeTransportOperation,
} from "../transport";
import type { IpcOperation } from "./ipc-operation";

export const IPC_CHANNEL_NAMESPACE = "ipc";

export const IPC_CHANNEL_KINDS = ["request", "response", "event"] as const;

export type IpcChannelKind = (typeof IPC_CHANNEL_KINDS)[number];

export type IpcChannelValue<
  TOperation extends IpcOperation = IpcOperation,
  TKind extends IpcChannelKind = IpcChannelKind,
> = `${typeof IPC_CHANNEL_NAMESPACE}.${TOperation}.${TKind}`;

export interface IpcChannel<
  TOperation extends IpcOperation = IpcOperation,
  TKind extends IpcChannelKind = IpcChannelKind,
  TChannel extends IpcChannelValue<TOperation, TKind> = IpcChannelValue<
    TOperation,
    TKind
  >,
> {
  operation: TOperation;
  kind: TKind;
  value: TChannel;
}

function invalidIpcChannelMessage(value: string): string {
  return [
    "IPC channel must use format",
    `"${IPC_CHANNEL_NAMESPACE}.<operation>.<kind>"`,
    "where <operation> is a valid operation identity",
    `and <kind> is one of: ${IPC_CHANNEL_KINDS.join(", ")}.`,
    `Received "${value}".`,
  ].join(" ");
}

function isIpcChannelKind(value: string): value is IpcChannelKind {
  return (IPC_CHANNEL_KINDS as readonly string[]).includes(value);
}

export function createIpcChannelValue<
  TOperation extends IpcOperation = IpcOperation,
  TKind extends IpcChannelKind = IpcChannelKind,
>(operation: TOperation, kind: TKind): IpcChannelValue<TOperation, TKind> {
  const normalizedOperation = normalizeTransportOperation(operation);
  return `${IPC_CHANNEL_NAMESPACE}.${normalizedOperation}.${kind}` as IpcChannelValue<
    TOperation,
    TKind
  >;
}

export function parseIpcChannelValue(
  channelValue: string,
): IpcChannel<IpcOperation> {
  const normalizedValue = channelValue.trim().toLowerCase();
  const namespacePrefix = `${IPC_CHANNEL_NAMESPACE}.`;

  if (!normalizedValue.startsWith(namespacePrefix)) {
    throw new Error(invalidIpcChannelMessage(channelValue));
  }

  const kindSeparatorIndex = normalizedValue.lastIndexOf(".");

  if (kindSeparatorIndex <= namespacePrefix.length) {
    throw new Error(invalidIpcChannelMessage(channelValue));
  }

  const operationValue = normalizedValue.slice(
    namespacePrefix.length,
    kindSeparatorIndex,
  );
  const kindValue = normalizedValue.slice(kindSeparatorIndex + 1);

  if (!isTransportOperation(operationValue) || !isIpcChannelKind(kindValue)) {
    throw new Error(invalidIpcChannelMessage(channelValue));
  }

  const operation = operationValue as IpcOperation;
  const kind = kindValue as IpcChannelKind;

  return {
    operation,
    kind,
    value: normalizedValue as IpcChannelValue<IpcOperation>,
  };
}

export function isIpcChannelValueForOperation(
  operation: IpcOperation,
  channelValue: string,
  kind?: IpcChannelKind,
): boolean {
  try {
    const parsed = parseIpcChannelValue(channelValue);
    const normalizedOperation = normalizeTransportOperation(operation);

    if (parsed.operation !== normalizedOperation) {
      return false;
    }

    if (kind && parsed.kind !== kind) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function createIpcChannel<
  TOperation extends IpcOperation = IpcOperation,
  TKind extends IpcChannelKind = IpcChannelKind,
>(
  operation: TOperation,
  kind: TKind,
): IpcChannel<TOperation, TKind> {
  return {
    operation,
    kind,
    value: createIpcChannelValue<TOperation, TKind>(operation, kind),
  };
}
