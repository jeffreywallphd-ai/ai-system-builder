import type {
  CompareDatasetVersionsUseCase,
  ListDatasetVersionsUseCase,
  PublishDatasetVersionUseCase,
  ReadDatasetVersionReproductionUseCase,
} from "../../../../application/use-cases";
import {
  DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL,
  DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL,
  DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL,
  DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL,
  createDesktopDatasetVersionCompareSuccessResponse,
  createDesktopDatasetVersionListSuccessResponse,
  createDesktopDatasetVersionPublishSuccessResponse,
  createDesktopDatasetVersionReproduceSuccessResponse,
  type DesktopDatasetVersionCompareRequest,
  type DesktopDatasetVersionListRequest,
  type DesktopDatasetVersionPublishRequest,
  type DesktopDatasetVersionReproduceRequest,
  createIpcError,
  createIpcFailureResponse,
} from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterDatasetVersionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  listDatasetVersionsUseCase: Pick<ListDatasetVersionsUseCase, "execute">;
  compareDatasetVersionsUseCase: Pick<CompareDatasetVersionsUseCase, "execute">;
  readDatasetVersionReproductionUseCase: Pick<ReadDatasetVersionReproductionUseCase, "execute">;
  publishDatasetVersionUseCase: Pick<PublishDatasetVersionUseCase, "execute">;
}

const requestOptions = (request: any) => ({ requestId: request.requestId, correlationId: request.correlationId });
const failure = (channel: any, request: any, code: string, message: string): any => createIpcFailureResponse(createIpcError(channel, code as never, message, requestOptions(request)) as any);
const context = (request: any) => ({ ...requestOptions(request), workspaceId: createWorkspaceId(request.payload.boundary.workspaceId) });

export function registerDatasetVersionIpc(dependencies: RegisterDatasetVersionIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL.value, async (_event, request: DesktopDatasetVersionListRequest) => {
    try {
      const versions = await dependencies.listDatasetVersionsUseCase.execute({ workspaceId: createWorkspaceId(request.payload.boundary.workspaceId), ...(request.payload.datasetId ? { datasetId: request.payload.datasetId } : {}) }, context(request));
      return createDesktopDatasetVersionListSuccessResponse({ versions }, requestOptions(request));
    } catch { return failure(DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL, request, "validation", "Dataset version history could not be read."); }
  });
  dependencies.ipcMain.handle(DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL.value, async (_event, request: DesktopDatasetVersionCompareRequest) => {
    try {
      const comparison = await dependencies.compareDatasetVersionsUseCase.execute({ workspaceId: createWorkspaceId(request.payload.boundary.workspaceId), fromVersionId: request.payload.fromVersionId as never, toVersionId: request.payload.toVersionId as never }, context(request));
      if (!comparison) return failure(DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL, request, "not-found", "Dataset versions were not found.");
      return createDesktopDatasetVersionCompareSuccessResponse({ comparison }, requestOptions(request));
    } catch { return failure(DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL, request, "validation", "Dataset versions could not be compared."); }
  });
  dependencies.ipcMain.handle(DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL.value, async (_event, request: DesktopDatasetVersionReproduceRequest) => {
    try {
      const reproduction = await dependencies.readDatasetVersionReproductionUseCase.execute({ workspaceId: createWorkspaceId(request.payload.boundary.workspaceId), versionId: request.payload.versionId as never }, context(request));
      if (!reproduction) return failure(DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL, request, "not-found", "Dataset version was not found.");
      return createDesktopDatasetVersionReproduceSuccessResponse({ reproduction }, requestOptions(request));
    } catch { return failure(DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL, request, "validation", "The saved setup could not be read."); }
  });
  dependencies.ipcMain.handle(DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value, async (_event, request: DesktopDatasetVersionPublishRequest) => {
    try {
      const visibility = request.payload.visibility;
      const result = await dependencies.publishDatasetVersionUseCase.execute({
        workspaceId: request.payload.boundary.workspaceId,
        versionId: request.payload.versionId,
        repositoryId: request.payload.repositoryId,
        visibility,
        ...(request.payload.createRepository ? { createRepository: true } : {}),
        confirmation: { approved: true, visibility, ...(visibility === "public" && request.payload.publicAccessConfirmed ? { publicAccessConfirmed: true as const } : {}) },
      }, context(request));
      if (!result.ok) return failure(DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL, request, result.error.code, result.error.message);
      return createDesktopDatasetVersionPublishSuccessResponse(result.value, requestOptions(request));
    } catch { return failure(DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL, request, "validation", "The dataset publication request is invalid."); }
  });
}
