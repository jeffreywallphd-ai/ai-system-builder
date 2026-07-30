import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";

export const DESKTOP_SYSTEM_RUN_WORKFLOW_OPERATIONS = {
  listProfiles: createTransportOperation(
    "system-run-workflow",
    "list-profiles",
  ),
  prepare: createTransportOperation("system-run-workflow", "prepare"),
  invoke: createTransportOperation("system-run-workflow", "invoke"),
} as const;

export const DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_RUN_WORKFLOW_OPERATIONS).map(
    ([key, operation]) => [
      key,
      {
        request: createIpcChannel(operation, "request"),
        response: createIpcChannel(operation, "response"),
      },
    ],
  ),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_RUN_WORKFLOW_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export const createDesktopSystemRunWorkflowRequest = <T>(
  operation: keyof typeof DESKTOP_SYSTEM_RUN_WORKFLOW_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) =>
  createIpcRequest(
    DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS[operation].request,
    payload,
    context,
  );
