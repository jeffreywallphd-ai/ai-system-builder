import {
  DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  createDesktopSystemRuntimeConversationReadRequest,
  createDesktopSystemRuntimeConversationSubmitRequest,
} from "../../../../modules/contracts/ipc";
import {
  isSystemRuntimeConversationViewResult,
  normalizeSubmitSystemRuntimeConversationTurnCommand,
  type SubmitSystemRuntimeConversationTurnCommand,
  type SystemRuntimeConversationResult,
  type SystemRuntimeConversationView,
} from "../../../../modules/contracts/system-deployment";

export interface SystemRuntimeIpcRendererPort {
  invoke(channel: string, request: unknown): Promise<unknown>;
}

export interface SystemRuntimePreloadApi {
  read(): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
  submit(
    command: SubmitSystemRuntimeConversationTurnCommand,
  ): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
}

export function createSystemRuntimePreloadApi(dependencies: {
  readonly ipcRenderer: SystemRuntimeIpcRendererPort;
}): SystemRuntimePreloadApi {
  return {
    read: () =>
      invoke(
        dependencies.ipcRenderer,
        "read",
        createDesktopSystemRuntimeConversationReadRequest(),
      ),
    async submit(command) {
      let normalized: SubmitSystemRuntimeConversationTurnCommand;
      try {
        normalized = normalizeSubmitSystemRuntimeConversationTurnCommand(command);
      } catch {
        return failure(
          "invalid-request",
          "Enter a valid message before sending.",
        );
      }
      return invoke(
        dependencies.ipcRenderer,
        "submit",
        createDesktopSystemRuntimeConversationSubmitRequest(normalized),
      );
    },
  };
}

async function invoke(
  ipcRenderer: SystemRuntimeIpcRendererPort,
  operation: keyof typeof DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  request: unknown,
): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>> {
  const channels = DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS[operation];
  try {
    const response = await ipcRenderer.invoke(channels.request.value, request);
    if (
      !response ||
      typeof response !== "object" ||
      (response as { operation?: unknown }).operation !==
        channels.response.operation ||
      (response as { channel?: unknown }).channel !== channels.response.value ||
      (response as { ok?: unknown }).ok !== true ||
      !isSystemRuntimeConversationViewResult(
        (response as { value?: unknown }).value,
      )
    ) {
      return failure(
        "runtime-unavailable",
        "The published system connection is unavailable.",
      );
    }
    return (response as { value: SystemRuntimeConversationResult<SystemRuntimeConversationView> })
      .value;
  } catch {
    return failure(
      "runtime-unavailable",
      "The published system connection is unavailable.",
    );
  }
}

function failure(
  code: "invalid-request" | "runtime-unavailable",
  message: string,
): SystemRuntimeConversationResult<SystemRuntimeConversationView> {
  return { ok: false, error: { code, message } };
}
