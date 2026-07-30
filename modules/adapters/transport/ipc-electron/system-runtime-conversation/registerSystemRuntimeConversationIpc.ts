import {
  DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
} from "../../../../contracts/ipc";
import {
  normalizeSubmitSystemRuntimeConversationTurnCommand,
  type SubmitSystemRuntimeConversationTurnCommand,
  type SystemRuntimeConversationResult,
  type SystemRuntimeConversationView,
} from "../../../../contracts/system-deployment";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface SystemRuntimeConversationSessionPort {
  read(): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
  submit(
    command: SubmitSystemRuntimeConversationTurnCommand,
  ): Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>;
}

export interface RegisterSystemRuntimeConversationIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly resolveSession: (
    event: unknown,
  ) => SystemRuntimeConversationSessionPort | undefined;
}

export function registerSystemRuntimeConversationIpc(
  dependencies: RegisterSystemRuntimeConversationIpcDependencies,
): void {
  register(dependencies, "read", async (session) => session.read());
  register(dependencies, "submit", async (session, payload) =>
    session.submit(normalizeSubmitSystemRuntimeConversationTurnCommand(payload)),
  );
}

function register(
  dependencies: RegisterSystemRuntimeConversationIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  run: (
    session: SystemRuntimeConversationSessionPort,
    payload: unknown,
  ) => Promise<SystemRuntimeConversationResult<SystemRuntimeConversationView>>,
): void {
  const channels = DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS[operation];
  dependencies.ipcMain.handle(
    channels.request.value,
    async (event, request: unknown) => {
      const envelope = optionalRecord(request);
      const context = {
        requestId: optionalText(envelope?.requestId),
        correlationId: optionalText(envelope?.correlationId),
      };
      const session = dependencies.resolveSession(event);
      if (!session) {
        return createIpcFailureResponse(
          createIpcError(
            channels.response as never,
            "forbidden",
            "This runtime window is not authorized.",
            context,
          ) as never,
          context,
        );
      }
      try {
        if (
          !envelope ||
          envelope.operation !== channels.request.operation ||
          envelope.channel !== channels.request.value
        ) {
          throw new Error("invalid envelope");
        }
        const payload = envelope.payload;
        if (
          operation === "read" &&
          (!optionalRecord(payload) || Object.keys(payload as object).length > 0)
        ) {
          throw new Error("invalid read request");
        }
        return createIpcSuccessResponse(
          channels.response as never,
          await run(session, payload),
          context,
        );
      } catch {
        return createIpcFailureResponse(
          createIpcError(
            channels.response as never,
            "validation",
            "The runtime conversation request is invalid.",
            context,
          ) as never,
          context,
        );
      }
    },
  );
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 160 ? value : undefined;
}
