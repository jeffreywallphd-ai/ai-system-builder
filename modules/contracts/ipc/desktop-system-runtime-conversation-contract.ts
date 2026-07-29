import type {
  SubmitSystemRuntimeConversationTurnCommand,
  SystemRuntimeConversationResult,
  SystemRuntimeConversationView,
} from "../system-deployment";
import type { IpcResponse } from "./ipc-response";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest } from "./ipc-request";
import { createTransportOperation } from "../transport";

export const DESKTOP_SYSTEM_RUNTIME_CONVERSATION_OPERATIONS = {
  read: createTransportOperation("system-runtime-conversation", "read"),
  submit: createTransportOperation("system-runtime-conversation", "submit"),
} as const;

export const DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS = Object.fromEntries(
  Object.entries(DESKTOP_SYSTEM_RUNTIME_CONVERSATION_OPERATIONS).map(
    ([key, operation]) => [
      key,
      {
        request: createIpcChannel(operation, "request"),
        response: createIpcChannel(operation, "response"),
      },
    ],
  ),
) as {
  readonly [K in keyof typeof DESKTOP_SYSTEM_RUNTIME_CONVERSATION_OPERATIONS]: {
    readonly request: ReturnType<typeof createIpcChannel>;
    readonly response: ReturnType<typeof createIpcChannel>;
  };
};

export type DesktopSystemRuntimeConversationResponse = IpcResponse<
  SystemRuntimeConversationResult<SystemRuntimeConversationView>
>;

export const createDesktopSystemRuntimeConversationReadRequest = () =>
  createIpcRequest(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.request,
    {},
  );

export const createDesktopSystemRuntimeConversationSubmitRequest = (
  command: SubmitSystemRuntimeConversationTurnCommand,
) =>
  createIpcRequest(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.submit.request,
    command,
  );
