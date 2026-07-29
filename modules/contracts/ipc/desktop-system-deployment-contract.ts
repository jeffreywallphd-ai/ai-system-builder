import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";

export const DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS = {
  lifecycleRead: createTransportOperation("system-deployment", "lifecycle-read"),
  lifecycleInvoke: createTransportOperation("system-deployment", "lifecycle-invoke"),
  install: createTransportOperation("system-deployment", "install"),
  activate: createTransportOperation("system-deployment", "activate"),
  health: createTransportOperation("system-deployment", "health"),
  rollback: createTransportOperation("system-deployment", "rollback"),
  revoke: createTransportOperation("system-deployment", "revoke"),
  read: createTransportOperation("system-deployment", "read"),
  list: createTransportOperation("system-deployment", "list"),
  startRun: createTransportOperation("system-deployment", "start-run"),
  cancelRun: createTransportOperation("system-deployment", "cancel-run"),
  listRuns: createTransportOperation("system-deployment", "list-runs"),
  listAudit: createTransportOperation("system-deployment", "list-audit"),
} as const;

export const DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS).map(
    ([key, operation]) => [
      key,
      {
        request: createIpcChannel(operation, "request"),
        response: createIpcChannel(operation, "response"),
      },
    ],
  ),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export const createDesktopSystemDeploymentRequest = <T>(
  operation: keyof typeof DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS,
  payload: T,
  context?: { requestId?: string; correlationId?: string },
) =>
  createIpcRequest(
    DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS[operation].request,
    payload,
    context,
  );
