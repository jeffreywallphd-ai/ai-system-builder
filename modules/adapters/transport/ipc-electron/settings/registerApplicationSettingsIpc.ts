import {
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL,
  createDesktopApplicationSettingsClearSuccessResponse,
  createDesktopApplicationSettingsListDefinitionsSuccessResponse,
  createDesktopApplicationSettingsReadSuccessResponse,
  createDesktopApplicationSettingsResolveModelDefaultSuccessResponse,
  createDesktopApplicationSettingsUpdateSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopApplicationSettingsClearRequest,
  type DesktopApplicationSettingsClearResponse,
  type DesktopApplicationSettingsListDefinitionsRequest,
  type DesktopApplicationSettingsListDefinitionsResponse,
  type DesktopApplicationSettingsReadRequest,
  type DesktopApplicationSettingsReadResponse,
  type DesktopApplicationSettingsResolveModelDefaultRequest,
  type DesktopApplicationSettingsResolveModelDefaultResponse,
  type DesktopApplicationSettingsUpdateRequest,
  type DesktopApplicationSettingsUpdateResponse,
  type IpcFailureResponse,
} from "../../../../contracts/ipc";
import type {
  ClearSettingUseCase,
  ListSettingsDefinitionsUseCase,
  ReadSettingsUseCase,
  ResolveModelDefaultUseCase,
  UpdateSettingUseCase,
} from "../../../../application/use-cases";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterApplicationSettingsIpcDependencies {
  ipcMain: IpcMainHandlePort;
  listSettingsDefinitionsUseCase: Pick<ListSettingsDefinitionsUseCase, "execute">;
  readSettingsUseCase: Pick<ReadSettingsUseCase, "execute">;
  updateSettingUseCase: Pick<UpdateSettingUseCase, "execute">;
  clearSettingUseCase: Pick<ClearSettingUseCase, "execute">;
  resolveModelDefaultUseCase: Pick<ResolveModelDefaultUseCase, "execute">;
}

type ApplicationSettingsFailureResponseChannel =
  | typeof DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL
  | typeof DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL
  | typeof DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL
  | typeof DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL
  | typeof DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL;

type ApplicationSettingsFailureResponse =
  IpcFailureResponse<
    Record<string, unknown>,
    ApplicationSettingsFailureResponseChannel["operation"],
    Record<string, never>,
    ApplicationSettingsFailureResponseChannel["value"]
  >;

type ApplicationSettingsRequestCorrelation = {
  requestId?: string;
  correlationId?: string;
};

function toFailureResponse(
  channel: ApplicationSettingsFailureResponseChannel,
  error: unknown,
  request: ApplicationSettingsRequestCorrelation,
): ApplicationSettingsFailureResponse {
  const message = error instanceof Error ? error.message : String(error);
  return createIpcFailureResponse(
    createIpcError<Record<string, unknown>, typeof channel.operation, Record<string, never>, typeof channel.value>(
      channel,
      "internal",
      message,
      {
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

export function createListApplicationSettingsDefinitionsIpcHandler(
  useCase: Pick<ListSettingsDefinitionsUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopApplicationSettingsListDefinitionsRequest,
  ): Promise<DesktopApplicationSettingsListDefinitionsResponse> => {
    try {
      const definitions = await useCase.execute(request.payload);

      return createDesktopApplicationSettingsListDefinitionsSuccessResponse(
        { definitions },
        { requestId: request.requestId, correlationId: request.correlationId },
      );
    } catch (error) {
      return toFailureResponse(DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createReadApplicationSettingsIpcHandler(useCase: Pick<ReadSettingsUseCase, "execute">) {
  return async (
    _event: unknown,
    request: DesktopApplicationSettingsReadRequest,
  ): Promise<DesktopApplicationSettingsReadResponse> => {
    try {
      const values = await useCase.execute(request.payload);
      return createDesktopApplicationSettingsReadSuccessResponse(
        { values },
        { requestId: request.requestId, correlationId: request.correlationId },
      );
    } catch (error) {
      return toFailureResponse(DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createUpdateApplicationSettingIpcHandler(useCase: Pick<UpdateSettingUseCase, "execute">) {
  return async (
    _event: unknown,
    request: DesktopApplicationSettingsUpdateRequest,
  ): Promise<DesktopApplicationSettingsUpdateResponse> => {
    try {
      const value = await useCase.execute(request.payload);
      return createDesktopApplicationSettingsUpdateSuccessResponse(
        { value },
        { requestId: request.requestId, correlationId: request.correlationId },
      );
    } catch (error) {
      return toFailureResponse(DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createClearApplicationSettingIpcHandler(useCase: Pick<ClearSettingUseCase, "execute">) {
  return async (
    _event: unknown,
    request: DesktopApplicationSettingsClearRequest,
  ): Promise<DesktopApplicationSettingsClearResponse> => {
    try {
      const value = await useCase.execute(request.payload);
      return createDesktopApplicationSettingsClearSuccessResponse(
        { value },
        { requestId: request.requestId, correlationId: request.correlationId },
      );
    } catch (error) {
      return toFailureResponse(DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createResolveModelDefaultIpcHandler(useCase: Pick<ResolveModelDefaultUseCase, "execute">) {
  return async (
    _event: unknown,
    request: DesktopApplicationSettingsResolveModelDefaultRequest,
  ): Promise<DesktopApplicationSettingsResolveModelDefaultResponse> => {
    try {
      const resolved = await useCase.execute(request.payload);
      return createDesktopApplicationSettingsResolveModelDefaultSuccessResponse(
        resolved,
        { requestId: request.requestId, correlationId: request.correlationId },
      );
    } catch (error) {
      return toFailureResponse(DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function registerApplicationSettingsIpc(dependencies: RegisterApplicationSettingsIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value,
    createListApplicationSettingsDefinitionsIpcHandler(dependencies.listSettingsDefinitionsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value,
    createReadApplicationSettingsIpcHandler(dependencies.readSettingsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value,
    createUpdateApplicationSettingIpcHandler(dependencies.updateSettingUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value,
    createClearApplicationSettingIpcHandler(dependencies.clearSettingUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value,
    createResolveModelDefaultIpcHandler(dependencies.resolveModelDefaultUseCase),
  );
}
