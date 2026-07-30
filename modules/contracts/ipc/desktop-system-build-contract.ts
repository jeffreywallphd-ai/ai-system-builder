import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";

export const DESKTOP_SYSTEM_BUILD_OPERATIONS = {
  prepare: createTransportOperation("system-build", "prepare"),
  request: createTransportOperation("system-build", "request"), cancel: createTransportOperation("system-build", "cancel"),
  read: createTransportOperation("system-build", "read"), list: createTransportOperation("system-build", "list"),
  approve: createTransportOperation("system-build", "approve-release"), readRelease: createTransportOperation("system-build", "read-release"),
  listReleases: createTransportOperation("system-build", "list-releases"), compareReleases: createTransportOperation("system-build", "compare-releases"),
  publicationWorkspace: createTransportOperation("system-build", "publication-workspace"),
} as const;

export const DESKTOP_SYSTEM_BUILD_CHANNELS = Object.fromEntries(Object.entries(DESKTOP_SYSTEM_BUILD_OPERATIONS).map(([key, operation]) => [key, { request: createIpcChannel(operation, "request"), response: createIpcChannel(operation, "response") }])) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_BUILD_OPERATIONS]: { readonly request: ReturnType<typeof createIpcChannel>; readonly response: ReturnType<typeof createIpcChannel> };
};

export const createDesktopSystemBuildRequest = <T>(operation: keyof typeof DESKTOP_SYSTEM_BUILD_OPERATIONS, payload: T, context?: { requestId?: string; correlationId?: string }) => createIpcRequest(DESKTOP_SYSTEM_BUILD_CHANNELS[operation].request, payload, context);
