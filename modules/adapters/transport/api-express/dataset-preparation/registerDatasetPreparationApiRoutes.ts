import type { Request } from "express";

import type {
  PrepareTrainingDatasetFromArtifactsCommand,
  PrepareTrainingDatasetFromArtifactsUseCase,
  PrepareTrainingDatasetFromArtifactsValue,
} from "../../../../application/use-cases";
import {
  API_DATASET_PREPARATION_CANCEL_OPERATION,
  API_DATASET_PREPARATION_CAPACITY_READ_OPERATION,
  API_DATASET_PREPARATION_APPROVE_OPERATION,
  API_DATASET_PREPARATION_REVIEW_PAGE_OPERATION,
  API_DATASET_PREPARATION_READ_OPERATION,
  API_DATASET_PREPARATION_START_OPERATION,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiDatasetPreparationTaskReadValue,
} from "../../../../contracts/api";
import type {
  DatasetPreparationGenerationCapacitySnapshot,
  RuntimeTaskProgress,
  RuntimeTaskStatusRecord,
} from "../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

interface RequestLike {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export interface DatasetPreparationExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}

export interface RegisterDatasetPreparationApiRoutesDependencies {
  app: DatasetPreparationExpressPort;
  prepareTrainingDatasetUseCase: Pick<
    PrepareTrainingDatasetFromArtifactsUseCase,
    | "startPrepareTrainingDataset"
    | "readPrepareTrainingDataset"
    | "cancelPrepareTrainingDataset"
    | "approvePreparedTrainingDataset"
  > &
    Partial<
      Pick<
        PrepareTrainingDatasetFromArtifactsUseCase,
        "readPreparedDatasetQualityReviewPage"
      >
    >;
  readGenerationCapacity?: () => Promise<DatasetPreparationGenerationCapacitySnapshot>;
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(field + " is required.");
  }
  return value.trim();
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  return value as Record<string, unknown>;
};

const requestContext = (request: RequestLike, workspaceId: string) => {
  const auth = getExpressAuthContext(request as Request);
  const organization = getExpressOrganizationContext(request as Request);
  return {
    workspaceId: createWorkspaceId(workspaceId),
    principalId: auth?.principal.principalId,
    ...(organization?.organizationId
      ? { organizationId: organization.organizationId }
      : {}),
    requestId: header(request, "x-request-id"),
    correlationId: header(request, "x-correlation-id"),
  };
};

const header = (request: RequestLike, name: string): string | undefined => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

function requireAuthenticated(request: RequestLike): void {
  const auth = getExpressAuthContext(request as Request);
  if (auth?.authenticated !== true) {
    throw new AuthenticationRequiredError();
  }
}

class AuthenticationRequiredError extends Error {}

const mapProgress = (
  progress: RuntimeTaskProgress | undefined,
): { message?: string; processed?: number; total?: number } | undefined => {
  if (!progress) {
    return undefined;
  }
  const details =
    typeof progress.details === "object" && progress.details !== null
      ? (progress.details as Record<string, unknown>)
      : undefined;
  return {
    message: progress.message,
    processed:
      progress.current ??
      (typeof details?.processedChunkCount === "number"
        ? details.processedChunkCount
        : undefined),
    total:
      progress.total ??
      (typeof details?.totalChunkCount === "number"
        ? details.totalChunkCount
        : undefined),
  };
};

const mapTaskStatus = (
  value:
    | RuntimeTaskStatusRecord
    | {
        requestId: string;
        taskType: string;
        status: "succeeded" | "review-required";
        result: PrepareTrainingDatasetFromArtifactsValue;
      },
): ApiDatasetPreparationTaskReadValue => {
  if (
    (value.status === "succeeded" || value.status === "review-required") &&
    "result" in value
  ) {
    return {
      requestId: value.requestId,
      status: value.status,
      result: value.result,
    };
  }
  const statusRecord = value as RuntimeTaskStatusRecord;
  if (statusRecord.status === "failed") {
    return {
      requestId: statusRecord.requestId,
      status: "failed",
      error: {
        code: statusRecord.error?.code,
        message:
          statusRecord.error?.message ?? "Dataset preparation task failed.",
      },
    };
  }
  if (
    statusRecord.status === "cancelled" ||
    statusRecord.status === "unknown"
  ) {
    return {
      requestId: statusRecord.requestId,
      status: statusRecord.status,
      message: statusRecord.error?.message,
    };
  }
  return {
    requestId: statusRecord.requestId,
    status: statusRecord.status === "queued" ? "queued" : "running",
    progress: mapProgress(statusRecord.progress),
  };
};

const failureStatus = (code: string): number => {
  if (code === "not-found") return 404;
  if (code === "unavailable") return 503;
  if (code === "forbidden") return 403;
  if (code === "conflict") return 409;
  return code === "validation" ? 400 : 500;
};

export function registerDatasetPreparationApiRoutes(
  dependencies: RegisterDatasetPreparationApiRoutesDependencies,
): void {
  if (dependencies.readGenerationCapacity) {
    dependencies.app.get(
      "/api/dataset-preparation/generation-capacity",
      async (request, response) => {
        try {
          requireAuthenticated(request);
          requiredString(request.query?.workspaceId, "workspaceId");
          const capacity = await dependencies.readGenerationCapacity!();
          response
            .status(200)
            .json(
              createApiSuccessResponse(
                API_DATASET_PREPARATION_CAPACITY_READ_OPERATION,
                capacity,
              ),
            );
        } catch (error) {
          const authenticated = !(error instanceof AuthenticationRequiredError);
          response
            .status(authenticated ? 400 : 401)
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_CAPACITY_READ_OPERATION,
                  authenticated ? "validation" : "unauthorized",
                  authenticated
                    ? "The generation capacity request is invalid."
                    : "Authentication is required.",
                ),
              ),
            );
        }
      },
    );
  }

  dependencies.app.post(
    "/api/dataset-preparation/start",
    async (request, response) => {
      try {
        requireAuthenticated(request);
        const body = record(request.body);
        const workspaceId = requiredString(body.workspaceId, "workspaceId");
        const command = record(
          body.command,
        ) as unknown as PrepareTrainingDatasetFromArtifactsCommand;
        const context = requestContext(request, workspaceId);
        const result =
          await dependencies.prepareTrainingDatasetUseCase.startPrepareTrainingDataset(
            command,
            context,
          );
        if (!result.ok) {
          const status = failureStatus(result.error.code);
          response
            .status(status)
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_START_OPERATION,
                  result.error.code,
                  result.error.message,
                  { details: result.error.details },
                ),
              ),
            );
          return;
        }
        response
          .status(202)
          .json(
            createApiSuccessResponse(
              API_DATASET_PREPARATION_START_OPERATION,
              result.value,
            ),
          );
      } catch (error) {
        const authenticated = !(error instanceof AuthenticationRequiredError);
        response
          .status(authenticated ? 400 : 401)
          .json(
            createApiFailureResponse(
              createApiError(
                API_DATASET_PREPARATION_START_OPERATION,
                authenticated ? "validation" : "unauthorized",
                authenticated
                  ? "The dataset preparation request is invalid."
                  : "Authentication is required.",
              ),
            ),
          );
      }
    },
  );

  dependencies.app.get(
    "/api/dataset-preparation/tasks/:requestId/review-page",
    async (request, response) => {
      try {
        requireAuthenticated(request);
        const workspaceId = requiredString(
          request.query?.workspaceId,
          "workspaceId",
        );
        const requestId = requiredString(
          request.params?.requestId,
          "requestId",
        );
        const reportFingerprint = requiredString(
          request.query?.reportFingerprint,
          "reportFingerprint",
        );
        const lineId = requiredString(request.query?.lineId, "lineId");
        const page = Number(request.query?.page ?? 0);
        const readReviewPage =
          dependencies.prepareTrainingDatasetUseCase
            .readPreparedDatasetQualityReviewPage;
        if (!readReviewPage) {
          response
            .status(503)
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_REVIEW_PAGE_OPERATION,
                  "unavailable",
                  "Dataset preparation row review is unavailable.",
                ),
              ),
            );
          return;
        }
        const result = await readReviewPage.call(
          dependencies.prepareTrainingDatasetUseCase,
          { requestId, reportFingerprint, lineId: lineId as never, page },
          requestContext(request, workspaceId),
        );
        if (!result.ok) {
          response
            .status(failureStatus(result.error.code))
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_REVIEW_PAGE_OPERATION,
                  result.error.code,
                  result.error.message,
                ),
              ),
            );
          return;
        }
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_PREPARATION_REVIEW_PAGE_OPERATION,
              result.value,
            ),
          );
      } catch (error) {
        const authenticated = !(error instanceof AuthenticationRequiredError);
        response
          .status(authenticated ? 400 : 401)
          .json(
            createApiFailureResponse(
              createApiError(
                API_DATASET_PREPARATION_REVIEW_PAGE_OPERATION,
                authenticated ? "validation" : "unauthorized",
                authenticated
                  ? "The dataset review page request is invalid."
                  : "Authentication is required.",
              ),
            ),
          );
      }
    },
  );

  dependencies.app.get(
    "/api/dataset-preparation/tasks/:requestId",
    async (request, response) => {
      try {
        requireAuthenticated(request);
        const workspaceId = requiredString(
          request.query?.workspaceId,
          "workspaceId",
        );
        const requestId = requiredString(
          request.params?.requestId,
          "requestId",
        );
        const result =
          await dependencies.prepareTrainingDatasetUseCase.readPrepareTrainingDataset(
            requestId,
            requestContext(request, workspaceId),
          );
        if (!result.ok) {
          const status = failureStatus(result.error.code);
          response
            .status(status)
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_READ_OPERATION,
                  result.error.code,
                  result.error.message,
                ),
              ),
            );
          return;
        }
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_PREPARATION_READ_OPERATION,
              mapTaskStatus(result.value),
            ),
          );
      } catch (error) {
        const authenticated = !(error instanceof AuthenticationRequiredError);
        response
          .status(authenticated ? 400 : 401)
          .json(
            createApiFailureResponse(
              createApiError(
                API_DATASET_PREPARATION_READ_OPERATION,
                authenticated ? "validation" : "unauthorized",
                authenticated
                  ? "The dataset preparation task request is invalid."
                  : "Authentication is required.",
              ),
            ),
          );
      }
    },
  );

  dependencies.app.post(
    "/api/dataset-preparation/tasks/:requestId/approve",
    async (request, response) => {
      try {
        requireAuthenticated(request);
        const body = record(request.body);
        const workspaceId = requiredString(body.workspaceId, "workspaceId");
        const requestId = requiredString(
          request.params?.requestId,
          "requestId",
        );
        const reportFingerprint = requiredString(
          body.reportFingerprint,
          "reportFingerprint",
        );
        if (
          body.outputBaseName !== undefined &&
          typeof body.outputBaseName !== "string"
        ) {
          throw new Error("outputBaseName must be text.");
        }
        const result =
          await dependencies.prepareTrainingDatasetUseCase.approvePreparedTrainingDataset(
            {
              requestId,
              reportFingerprint,
              ...(body.outputBaseName !== undefined
                ? { outputBaseName: body.outputBaseName }
                : {}),
            },
            requestContext(request, workspaceId),
          );
        if (!result.ok) {
          response
            .status(failureStatus(result.error.code))
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_APPROVE_OPERATION,
                  result.error.code,
                  result.error.message,
                ),
              ),
            );
          return;
        }
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_PREPARATION_APPROVE_OPERATION,
              result.value,
            ),
          );
      } catch (error) {
        const authenticated = !(error instanceof AuthenticationRequiredError);
        response
          .status(authenticated ? 400 : 401)
          .json(
            createApiFailureResponse(
              createApiError(
                API_DATASET_PREPARATION_APPROVE_OPERATION,
                authenticated ? "validation" : "unauthorized",
                authenticated
                  ? "The dataset approval request is invalid."
                  : "Authentication is required.",
              ),
            ),
          );
      }
    },
  );

  dependencies.app.post(
    "/api/dataset-preparation/tasks/:requestId/cancel",
    async (request, response) => {
      try {
        requireAuthenticated(request);
        const body = record(request.body);
        const workspaceId = requiredString(body.workspaceId, "workspaceId");
        const requestId = requiredString(
          request.params?.requestId,
          "requestId",
        );
        const result =
          await dependencies.prepareTrainingDatasetUseCase.cancelPrepareTrainingDataset(
            requestId,
            requestContext(request, workspaceId),
          );
        if (!result.ok) {
          const status = failureStatus(result.error.code);
          response
            .status(status)
            .json(
              createApiFailureResponse(
                createApiError(
                  API_DATASET_PREPARATION_CANCEL_OPERATION,
                  result.error.code,
                  result.error.message,
                ),
              ),
            );
          return;
        }
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_PREPARATION_CANCEL_OPERATION,
              result.value,
            ),
          );
      } catch (error) {
        const authenticated = !(error instanceof AuthenticationRequiredError);
        response
          .status(authenticated ? 400 : 401)
          .json(
            createApiFailureResponse(
              createApiError(
                API_DATASET_PREPARATION_CANCEL_OPERATION,
                authenticated ? "validation" : "unauthorized",
                authenticated
                  ? "The dataset preparation cancellation request is invalid."
                  : "Authentication is required.",
              ),
            ),
          );
      }
    },
  );
}
