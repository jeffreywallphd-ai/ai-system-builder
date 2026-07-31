import {
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL,
  createDesktopFeatureLifecycleIdleDisposeSuccessResponse,
  createDesktopFeatureLifecycleStateReadSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopFeatureLifecycleIdleDisposeRequest,
  type DesktopFeatureLifecycleIdleDisposeResponse,
  type DesktopFeatureLifecycleStateEntry,
  type DesktopFeatureLifecycleStateReadRequest,
  type DesktopFeatureLifecycleStateReadResponse,
  type DesktopFeatureLifecycleIdleDisposeResult,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface FeatureLifecycleDiagnosticsPort {
  getFeatureLifecycleState: () => DesktopFeatureLifecycleStateEntry[];
  disposeIdleFeatures: () => Promise<DesktopFeatureLifecycleIdleDisposeResult[]>;
}

export interface RegisterFeatureLifecycleDiagnosticsIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly featureLifecycle: FeatureLifecycleDiagnosticsPort;
}

export function createFeatureLifecycleStateReadIpcHandler(
  dependencies: Pick<RegisterFeatureLifecycleDiagnosticsIpcDependencies, "featureLifecycle">,
) {
  return async (_event: unknown, request: DesktopFeatureLifecycleStateReadRequest): Promise<DesktopFeatureLifecycleStateReadResponse> => {
    try {
      const entries = dependencies.featureLifecycle.getFeatureLifecycleState();
      return createDesktopFeatureLifecycleStateReadSuccessResponse(entries, { requestId: request.requestId, correlationId: request.correlationId });
    } catch {
      return createIpcFailureResponse(createIpcError(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL, "internal", "Unable to read feature lifecycle state.", { requestId: request.requestId, correlationId: request.correlationId }));
    }
  };
}

export function createFeatureLifecycleIdleDisposeIpcHandler(
  dependencies: Pick<RegisterFeatureLifecycleDiagnosticsIpcDependencies, "featureLifecycle">,
) {
  return async (_event: unknown, request: DesktopFeatureLifecycleIdleDisposeRequest): Promise<DesktopFeatureLifecycleIdleDisposeResponse> => {
    try {
      const results = await dependencies.featureLifecycle.disposeIdleFeatures();
      return createDesktopFeatureLifecycleIdleDisposeSuccessResponse(results, { requestId: request.requestId, correlationId: request.correlationId });
    } catch {
      return createIpcFailureResponse(createIpcError(DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL, "internal", "Unable to dispose idle feature lifecycle entries.", { requestId: request.requestId, correlationId: request.correlationId }));
    }
  };
}

export function registerFeatureLifecycleDiagnosticsIpc(dependencies: RegisterFeatureLifecycleDiagnosticsIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL.value,
    createFeatureLifecycleStateReadIpcHandler({ featureLifecycle: dependencies.featureLifecycle }),
  );
  dependencies.ipcMain.handle(
    DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL.value,
    createFeatureLifecycleIdleDisposeIpcHandler({ featureLifecycle: dependencies.featureLifecycle }),
  );
}
