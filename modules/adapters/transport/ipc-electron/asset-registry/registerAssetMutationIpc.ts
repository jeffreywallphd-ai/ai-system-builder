import type {
  AssetMutationOperation,
  AssetMutationResult,
} from "../../../../contracts/asset";
import {
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL,
  createDesktopAssetMutationSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopAssetFinalizeGeneratedOutputRequest,
  type DesktopAssetFinalizeGeneratedOutputResponse,
  type DesktopAssetImportExternalRepositoryObjectRequest,
  type DesktopAssetImportExternalRepositoryObjectResponse,
  type DesktopAssetLocalizeExternalRepositoryObjectRequest,
  type DesktopAssetLocalizeExternalRepositoryObjectResponse,
  type DesktopAssetMutationResponse,
  type DesktopAssetRegisterResourceBackedViewRequest,
  type DesktopAssetRegisterResourceBackedViewResponse,
  type IpcChannel,
  type IpcChannelValue,
} from "../../../../contracts/ipc";
import {
  executeAssetMutationUseCase,
  mutationFailureContractCode,
  mutationFailureDetails,
  mutationFailureMessage,
  parseAssetMutationCommand,
  type AssetMutationUseCase,
} from "../../asset-registry/assetMutationTransport";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetMutationIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly registerResourceBackedViewAsAsset: AssetMutationUseCase<"asset.register-resource-backed-view">;
  readonly finalizeGeneratedOutputAsAsset: AssetMutationUseCase<"asset.finalize-generated-output">;
  readonly importExternalRepositoryObjectAsAsset: AssetMutationUseCase<"asset.import-external-repository-object">;
  readonly localizeExternalRepositoryObjectAsAsset: AssetMutationUseCase<"asset.localize-external-repository-object">;
}

export function createDesktopAssetRegisterResourceBackedViewIpcHandler(
  dependencies: Pick<RegisterAssetMutationIpcDependencies, "registerResourceBackedViewAsAsset">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetRegisterResourceBackedViewRequest,
  ): Promise<DesktopAssetRegisterResourceBackedViewResponse> => handleMutationIpc(
    request,
    DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
    DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL,
    dependencies.registerResourceBackedViewAsAsset,
  );
}

export function createDesktopAssetFinalizeGeneratedOutputIpcHandler(
  dependencies: Pick<RegisterAssetMutationIpcDependencies, "finalizeGeneratedOutputAsAsset">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetFinalizeGeneratedOutputRequest,
  ): Promise<DesktopAssetFinalizeGeneratedOutputResponse> => handleMutationIpc(
    request,
    DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
    DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL,
    dependencies.finalizeGeneratedOutputAsAsset,
  );
}

export function createDesktopAssetImportExternalRepositoryObjectIpcHandler(
  dependencies: Pick<RegisterAssetMutationIpcDependencies, "importExternalRepositoryObjectAsAsset">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetImportExternalRepositoryObjectRequest,
  ): Promise<DesktopAssetImportExternalRepositoryObjectResponse> => handleMutationIpc(
    request,
    DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
    DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
    dependencies.importExternalRepositoryObjectAsAsset,
  );
}

export function createDesktopAssetLocalizeExternalRepositoryObjectIpcHandler(
  dependencies: Pick<RegisterAssetMutationIpcDependencies, "localizeExternalRepositoryObjectAsAsset">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetLocalizeExternalRepositoryObjectRequest,
  ): Promise<DesktopAssetLocalizeExternalRepositoryObjectResponse> => handleMutationIpc(
    request,
    DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
    DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
    dependencies.localizeExternalRepositoryObjectAsAsset,
  );
}

export function registerAssetMutationIpc(dependencies: RegisterAssetMutationIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
    createDesktopAssetRegisterResourceBackedViewIpcHandler(dependencies),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
    createDesktopAssetFinalizeGeneratedOutputIpcHandler(dependencies),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    createDesktopAssetImportExternalRepositoryObjectIpcHandler(dependencies),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    createDesktopAssetLocalizeExternalRepositoryObjectIpcHandler(dependencies),
  );
}

async function handleMutationIpc<
  TOperation extends AssetMutationOperation,
  TChannel extends IpcChannelValue<TOperation, "response">,
>(
  request: { payload?: unknown; requestId?: string; correlationId?: string },
  operation: TOperation,
  responseChannel: IpcChannel<TOperation, "response", TChannel>,
  useCase: AssetMutationUseCase<TOperation>,
): Promise<DesktopAssetMutationResponse<TOperation, TChannel>> {
  const parsed = parseAssetMutationCommand(request.payload, operation, {
    requestId: request.requestId,
    correlationId: request.correlationId,
  });
  if (!parsed.ok) {
    return ipcMutationFailure(responseChannel, parsed.result, parsed.context);
  }

  const result = await executeAssetMutationUseCase(useCase, parsed.command);
  return writeMutationResult(responseChannel, result, parsed.context);
}

function writeMutationResult<
  TOperation extends AssetMutationOperation,
  TChannel extends IpcChannelValue<TOperation, "response">,
>(
  responseChannel: IpcChannel<TOperation, "response", TChannel>,
  result: AssetMutationResult,
  context: { requestId?: string; correlationId?: string },
): DesktopAssetMutationResponse<TOperation, TChannel> {
  if (result.ok) {
    return createDesktopAssetMutationSuccessResponse(responseChannel, result, context);
  }
  return ipcMutationFailure(responseChannel, result, context);
}

function ipcMutationFailure<
  TOperation extends AssetMutationOperation,
  TChannel extends IpcChannelValue<TOperation, "response">,
>(
  channel: IpcChannel<TOperation, "response", TChannel>,
  result: AssetMutationResult,
  context: { requestId?: string; correlationId?: string },
): DesktopAssetMutationResponse<TOperation, TChannel> {
  return createIpcFailureResponse(createIpcError(channel, mutationFailureContractCode(result.failure?.code), mutationFailureMessage(result), {
    ...context,
    details: mutationFailureDetails(result),
  }));
}
