import type {
  CompareDatasetVersionsUseCase,
  ListDatasetVersionsUseCase,
  PublishDatasetVersionUseCase,
  ReadDatasetVersionReproductionUseCase,
  ListDatasetReviewTargetsUseCase,
  ReadDatasetReviewPageUseCase,
  RejectDatasetReviewRowUseCase,
  EditDatasetReviewRowUseCase,
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
  DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_TARGETS_RESPONSE_CHANNEL,
  DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_PAGE_RESPONSE_CHANNEL,
  DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_REJECT_RESPONSE_CHANNEL,
  DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_EDIT_RESPONSE_CHANNEL,
  createDesktopDatasetVersionCompareSuccessResponse,
  createDesktopDatasetVersionListSuccessResponse,
  createDesktopDatasetVersionPublishSuccessResponse,
  createDesktopDatasetVersionReproduceSuccessResponse,
  createDesktopDatasetReviewTargetsSuccessResponse,
  createDesktopDatasetReviewPageSuccessResponse,
  createDesktopDatasetReviewRejectSuccessResponse,
  createDesktopDatasetReviewEditSuccessResponse,
  type DesktopDatasetVersionCompareRequest,
  type DesktopDatasetVersionListRequest,
  type DesktopDatasetVersionPublishRequest,
  type DesktopDatasetVersionReproduceRequest,
  type DesktopDatasetReviewTargetsRequest,
  type DesktopDatasetReviewPageRequest,
  type DesktopDatasetReviewRejectRequest,
  type DesktopDatasetReviewEditRequest,
  createIpcError,
  createIpcFailureResponse,
} from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
import type { ApplicationRequestContext } from "../../../../application/ports";

export interface RegisterDatasetVersionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  listDatasetVersionsUseCase: Pick<ListDatasetVersionsUseCase, "execute">;
  compareDatasetVersionsUseCase: Pick<CompareDatasetVersionsUseCase, "execute">;
  readDatasetVersionReproductionUseCase: Pick<
    ReadDatasetVersionReproductionUseCase,
    "execute"
  >;
  publishDatasetVersionUseCase: Pick<PublishDatasetVersionUseCase, "execute">;
  listDatasetReviewTargetsUseCase: Pick<
    ListDatasetReviewTargetsUseCase,
    "execute"
  >;
  readDatasetReviewPageUseCase: Pick<ReadDatasetReviewPageUseCase, "execute">;
  rejectDatasetReviewRowUseCase: Pick<RejectDatasetReviewRowUseCase, "execute">;
  editDatasetReviewRowUseCase: Pick<EditDatasetReviewRowUseCase, "execute">;
  getAuthoritativeRequestContext?: () => Pick<
    ApplicationRequestContext,
    "organizationId" | "principalId"
  >;
}

const requestOptions = (request: any) => ({
  requestId: request.requestId,
  correlationId: request.correlationId,
});
const failure = (
  channel: any,
  request: any,
  code: string,
  message: string,
): any =>
  createIpcFailureResponse(
    createIpcError(
      channel,
      code as never,
      message,
      requestOptions(request),
    ) as any,
  );
const context = (
  request: any,
  dependencies: RegisterDatasetVersionIpcDependencies,
) => ({
  ...requestOptions(request),
  workspaceId: createWorkspaceId(request.payload.boundary.workspaceId),
  ...dependencies.getAuthoritativeRequestContext?.(),
});

export function registerDatasetVersionIpc(
  dependencies: RegisterDatasetVersionIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetReviewTargetsRequest) => {
      try {
        const workspaceId = createWorkspaceId(
          request.payload.boundary.workspaceId,
        );
        const groups =
          await dependencies.listDatasetReviewTargetsUseCase.execute(
            { workspaceId },
            context(request, dependencies),
          );
        return createDesktopDatasetReviewTargetsSuccessResponse(
          { groups },
          requestOptions(request),
        );
      } catch (error) {
        return failure(
          DESKTOP_DATASET_REVIEW_TARGETS_RESPONSE_CHANNEL,
          request,
          "validation",
          safeMessage(error, "Workspace datasets could not be listed."),
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetReviewPageRequest) => {
      try {
        const workspaceId = createWorkspaceId(
          request.payload.boundary.workspaceId,
        );
        const page = await dependencies.readDatasetReviewPageUseCase.execute(
          {
            workspaceId,
            artifactKey: request.payload.artifactKey,
            ...(request.payload.versionId
              ? { versionId: request.payload.versionId }
              : {}),
            page: request.payload.page,
            pageSize: request.payload.pageSize,
          },
          context(request, dependencies),
        );
        return createDesktopDatasetReviewPageSuccessResponse(
          { page },
          requestOptions(request),
        );
      } catch (error) {
        return failure(
          DESKTOP_DATASET_REVIEW_PAGE_RESPONSE_CHANNEL,
          request,
          "validation",
          safeMessage(error, "Dataset rows could not be read."),
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetReviewRejectRequest) => {
      try {
        const workspaceId = createWorkspaceId(
          request.payload.boundary.workspaceId,
        );
        const result = await dependencies.rejectDatasetReviewRowUseCase.execute(
          {
            workspaceId,
            artifactKey: request.payload.artifactKey,
            ...(request.payload.versionId
              ? { versionId: request.payload.versionId }
              : {}),
            rowIndex: request.payload.rowIndex,
            rowFingerprint: request.payload.rowFingerprint,
          },
          context(request, dependencies),
        );
        return createDesktopDatasetReviewRejectSuccessResponse(
          result,
          requestOptions(request),
        );
      } catch (error) {
        return failure(
          DESKTOP_DATASET_REVIEW_REJECT_RESPONSE_CHANNEL,
          request,
          "conflict",
          safeMessage(error, "The selected row could not be rejected."),
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetReviewEditRequest) => {
      try {
        const workspaceId = createWorkspaceId(
          request.payload.boundary.workspaceId,
        );
        const result = await dependencies.editDatasetReviewRowUseCase.execute(
          {
            workspaceId,
            artifactKey: request.payload.artifactKey,
            ...(request.payload.versionId
              ? { versionId: request.payload.versionId }
              : {}),
            rowIndex: request.payload.rowIndex,
            rowFingerprint: request.payload.rowFingerprint,
            values: request.payload.values,
          },
          context(request, dependencies),
        );
        return createDesktopDatasetReviewEditSuccessResponse(
          result,
          requestOptions(request),
        );
      } catch (error) {
        return failure(
          DESKTOP_DATASET_REVIEW_EDIT_RESPONSE_CHANNEL,
          request,
          "conflict",
          safeMessage(error, "The selected row could not be edited."),
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetVersionListRequest) => {
      try {
        const versions = await dependencies.listDatasetVersionsUseCase.execute(
          {
            workspaceId: createWorkspaceId(
              request.payload.boundary.workspaceId,
            ),
            ...(request.payload.datasetId
              ? { datasetId: request.payload.datasetId }
              : {}),
          },
          context(request, dependencies),
        );
        return createDesktopDatasetVersionListSuccessResponse(
          { versions },
          requestOptions(request),
        );
      } catch {
        return failure(
          DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL,
          request,
          "validation",
          "Dataset version history could not be read.",
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetVersionCompareRequest) => {
      try {
        const comparison =
          await dependencies.compareDatasetVersionsUseCase.execute(
            {
              workspaceId: createWorkspaceId(
                request.payload.boundary.workspaceId,
              ),
              fromVersionId: request.payload.fromVersionId as never,
              toVersionId: request.payload.toVersionId as never,
            },
            context(request, dependencies),
          );
        if (!comparison)
          return failure(
            DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL,
            request,
            "not-found",
            "Dataset versions were not found.",
          );
        return createDesktopDatasetVersionCompareSuccessResponse(
          { comparison },
          requestOptions(request),
        );
      } catch {
        return failure(
          DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL,
          request,
          "validation",
          "Dataset versions could not be compared.",
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetVersionReproduceRequest) => {
      try {
        const reproduction =
          await dependencies.readDatasetVersionReproductionUseCase.execute(
            {
              workspaceId: createWorkspaceId(
                request.payload.boundary.workspaceId,
              ),
              versionId: request.payload.versionId as never,
            },
            context(request, dependencies),
          );
        if (!reproduction)
          return failure(
            DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL,
            request,
            "not-found",
            "Dataset version was not found.",
          );
        return createDesktopDatasetVersionReproduceSuccessResponse(
          { reproduction },
          requestOptions(request),
        );
      } catch {
        return failure(
          DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL,
          request,
          "validation",
          "The saved setup could not be read.",
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value,
    async (_event, request: DesktopDatasetVersionPublishRequest) => {
      try {
        const visibility = request.payload.visibility;
        const result = await dependencies.publishDatasetVersionUseCase.execute(
          {
            workspaceId: request.payload.boundary.workspaceId,
            versionId: request.payload.versionId,
            repositoryId: request.payload.repositoryId,
            visibility,
            ...(request.payload.createRepository
              ? { createRepository: true }
              : {}),
            confirmation: {
              approved: true,
              visibility,
              ...(visibility === "public" &&
              request.payload.publicAccessConfirmed
                ? { publicAccessConfirmed: true as const }
                : {}),
            },
          },
          context(request, dependencies),
        );
        if (!result.ok)
          return failure(
            DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL,
            request,
            result.error.code,
            result.error.message,
          );
        return createDesktopDatasetVersionPublishSuccessResponse(
          result.value,
          requestOptions(request),
        );
      } catch {
        return failure(
          DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL,
          request,
          "validation",
          "The dataset publication request is invalid.",
        );
      }
    },
  );
}

function safeMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message
    .replace(/[A-Za-z]:\\[^\s,;]*/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|var|etc|opt)\/[^\s,;]*/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return message ? message.slice(0, 300) : fallback;
}
