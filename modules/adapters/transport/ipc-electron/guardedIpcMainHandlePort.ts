import { createIpcError, createIpcFailureResponse, type IpcChannel, type IpcOperation } from "../../../contracts/ipc";
import type { IpcMainHandleListener, IpcMainHandlePort, IpcSenderTrustPolicy } from "./ipcMainHandlePort";

/** Admission precedes even request metadata and deferred feature resolution. */
export function guardedIpcMainHandlePort(
  ipcMain: IpcMainHandlePort,
  senderTrust: IpcSenderTrustPolicy,
  descriptors: readonly { readonly request: IpcChannel<IpcOperation, "request">; readonly response: IpcChannel<IpcOperation, "response"> }[],
): IpcMainHandlePort {
  const responses = new Map<string, IpcChannel<IpcOperation, "response">>();
  for (const { request, response } of descriptors) {
    if (request.kind !== "request" || response.kind !== "response" ||
        request.operation !== response.operation || responses.has(request.value)) {
      throw new Error("Invalid fixed desktop IPC registration.");
    }
    responses.set(request.value, Object.freeze({ ...response }));
  }
  return {
    handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>): void {
      const response = responses.get(channel);
      if (!response) throw new Error("Unregistered desktop IPC operation.");
      ipcMain.handle<TRequest, TResponse>(channel, async (event, request) => {
        let trusted = false;
        try { trusted = senderTrust?.isTrustedSender(event) === true; } catch { /* fail closed */ }
        if (!trusted) {
          // All registered response contracts admit the common transport failure.
          return createIpcFailureResponse(createIpcError(response, "forbidden", "The desktop IPC sender is not trusted.")) as TResponse;
        }
        return listener(event, request);
      });
    },
  };
}
