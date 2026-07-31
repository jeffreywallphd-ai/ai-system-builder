import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";

export const DESKTOP_SYSTEM_REVIEW_OPERATIONS = {
  describe: createTransportOperation("system-review", "describe"),
  browse: createTransportOperation("system-review", "browse"),
  detail: createTransportOperation("system-review", "detail"),
  preview: createTransportOperation("system-review", "preview"),
  listAudit: createTransportOperation("system-review", "list-audit"),
} as const;

export const DESKTOP_SYSTEM_REVIEW_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_REVIEW_OPERATIONS).map(([key, operation]) => [
    key,
    {
      request: createIpcChannel(operation, "request"),
      response: createIpcChannel(operation, "response"),
    },
  ]),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_REVIEW_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export const createDesktopSystemReviewRequest = <T>(
  operation: keyof typeof DESKTOP_SYSTEM_REVIEW_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) =>
  createIpcRequest(
    DESKTOP_SYSTEM_REVIEW_CHANNELS[operation].request,
    payload,
    context,
  );
