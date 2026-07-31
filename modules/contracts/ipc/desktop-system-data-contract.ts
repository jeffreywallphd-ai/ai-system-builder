import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";

export const DESKTOP_SYSTEM_DATA_OPERATIONS = {
  describe: createTransportOperation("system-data", "describe"),
  create: createTransportOperation("system-data", "create"),
  read: createTransportOperation("system-data", "read"),
  update: createTransportOperation("system-data", "update"),
  list: createTransportOperation("system-data", "list"),
  listAudit: createTransportOperation("system-data", "list-audit"),
} as const;

export const DESKTOP_SYSTEM_DATA_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_DATA_OPERATIONS).map(([key, operation]) => [key, {
    request: createIpcChannel(operation, "request"),
    response: createIpcChannel(operation, "response"),
  }]),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_DATA_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export const createDesktopSystemDataRequest = <T>(
  operation: keyof typeof DESKTOP_SYSTEM_DATA_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) => createIpcRequest(DESKTOP_SYSTEM_DATA_CHANNELS[operation].request, payload, context);
