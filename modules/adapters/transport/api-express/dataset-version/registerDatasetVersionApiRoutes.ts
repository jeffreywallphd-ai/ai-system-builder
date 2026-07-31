import type { Request } from "express";
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
  API_DATASET_VERSION_COMPARE_OPERATION,
  API_DATASET_VERSION_LIST_OPERATION,
  API_DATASET_VERSION_PUBLISH_OPERATION,
  API_DATASET_VERSION_REPRODUCE_OPERATION,
  API_DATASET_REVIEW_TARGETS_OPERATION,
  API_DATASET_REVIEW_PAGE_OPERATION,
  API_DATASET_REVIEW_REJECT_OPERATION,
  API_DATASET_REVIEW_EDIT_OPERATION,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
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
export interface DatasetVersionExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}
export interface RegisterDatasetVersionApiRoutesDependencies {
  app: DatasetVersionExpressPort;
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
}

const required = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
  return value.trim();
};
const body = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Request body must be an object.");
  return value as Record<string, unknown>;
};
const header = (request: RequestLike, name: string): string | undefined => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};
const context = (request: RequestLike, workspaceId: string) => {
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
const authenticated = (request: RequestLike) =>
  getExpressAuthContext(request as Request)?.authenticated === true;
const status = (code: string) =>
  code === "not-found"
    ? 404
    : code === "forbidden"
      ? 403
      : code === "conflict"
        ? 409
        : code === "unavailable"
          ? 503
          : code === "validation"
            ? 400
            : 500;
const fail = (
  response: ResponseLike,
  operation: Parameters<typeof createApiError>[0],
  code: string,
  message: string,
  httpStatus = status(code),
) =>
  response
    .status(httpStatus)
    .json(
      createApiFailureResponse(
        createApiError(operation, code as never, message),
      ),
    );

export function registerDatasetVersionApiRoutes(
  dependencies: RegisterDatasetVersionApiRoutesDependencies,
): void {
  dependencies.app.get("/api/dataset-reviews", async (request, response) => {
    try {
      if (!authenticated(request))
        return fail(
          response,
          API_DATASET_REVIEW_TARGETS_OPERATION,
          "unauthorized",
          "Authentication is required.",
          401,
        );
      const workspaceId = required(request.query?.workspaceId, "workspaceId");
      const groups = await dependencies.listDatasetReviewTargetsUseCase.execute(
        { workspaceId: createWorkspaceId(workspaceId) },
        context(request, workspaceId),
      );
      response.status(200).json(
        createApiSuccessResponse(API_DATASET_REVIEW_TARGETS_OPERATION, {
          groups,
        }),
      );
    } catch (error) {
      fail(
        response,
        API_DATASET_REVIEW_TARGETS_OPERATION,
        "validation",
        safeMessage(error, "Workspace datasets could not be listed."),
        400,
      );
    }
  });

  dependencies.app.get(
    "/api/dataset-reviews/page",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_REVIEW_PAGE_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const workspaceId = required(request.query?.workspaceId, "workspaceId");
        const pageNumber = integer(request.query?.page, "page");
        const pageSize = integer(request.query?.pageSize, "pageSize");
        if (pageSize !== 10 && pageSize !== 25 && pageSize !== 50)
          throw new Error("pageSize is invalid.");
        const page = await dependencies.readDatasetReviewPageUseCase.execute(
          {
            workspaceId: createWorkspaceId(workspaceId),
            artifactKey: required(request.query?.artifactKey, "artifactKey"),
            ...(typeof request.query?.versionId === "string" &&
            request.query.versionId.trim()
              ? { versionId: request.query.versionId.trim() }
              : {}),
            page: pageNumber,
            pageSize,
          },
          context(request, workspaceId),
        );
        response.status(200).json(
          createApiSuccessResponse(API_DATASET_REVIEW_PAGE_OPERATION, {
            page,
          }),
        );
      } catch (error) {
        fail(
          response,
          API_DATASET_REVIEW_PAGE_OPERATION,
          "validation",
          safeMessage(error, "Dataset rows could not be read."),
          400,
        );
      }
    },
  );

  dependencies.app.post(
    "/api/dataset-reviews/rejections",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_REVIEW_REJECT_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const value = body(request.body);
        const workspaceId = required(value.workspaceId, "workspaceId");
        const result = await dependencies.rejectDatasetReviewRowUseCase.execute(
          {
            workspaceId: createWorkspaceId(workspaceId),
            artifactKey: required(value.artifactKey, "artifactKey"),
            ...(typeof value.versionId === "string" && value.versionId.trim()
              ? { versionId: value.versionId.trim() }
              : {}),
            rowIndex: integer(value.rowIndex, "rowIndex"),
            rowFingerprint: required(
              value.rowFingerprint,
              "rowFingerprint",
            ) as `sha256:${string}`,
          },
          context(request, workspaceId),
        );
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_REVIEW_REJECT_OPERATION,
              result,
            ),
          );
      } catch (error) {
        fail(
          response,
          API_DATASET_REVIEW_REJECT_OPERATION,
          "conflict",
          safeMessage(error, "The selected row could not be rejected."),
          409,
        );
      }
    },
  );
  dependencies.app.post(
    "/api/dataset-reviews/edits",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_REVIEW_EDIT_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const value = body(request.body);
        const workspaceId = required(value.workspaceId, "workspaceId");
        if (
          !value.values ||
          typeof value.values !== "object" ||
          Array.isArray(value.values)
        ) {
          throw new Error("values must be an object.");
        }
        const result = await dependencies.editDatasetReviewRowUseCase.execute(
          {
            workspaceId: createWorkspaceId(workspaceId),
            artifactKey: required(value.artifactKey, "artifactKey"),
            ...(typeof value.versionId === "string" && value.versionId.trim()
              ? { versionId: value.versionId.trim() }
              : {}),
            rowIndex: integer(value.rowIndex, "rowIndex"),
            rowFingerprint: required(
              value.rowFingerprint,
              "rowFingerprint",
            ) as `sha256:${string}`,
            values: value.values as Record<string, unknown>,
          },
          context(request, workspaceId),
        );
        response
          .status(200)
          .json(
            createApiSuccessResponse(API_DATASET_REVIEW_EDIT_OPERATION, result),
          );
      } catch (error) {
        fail(
          response,
          API_DATASET_REVIEW_EDIT_OPERATION,
          "conflict",
          safeMessage(error, "The selected row could not be edited."),
          409,
        );
      }
    },
  );
  dependencies.app.get("/api/dataset-versions", async (request, response) => {
    try {
      if (!authenticated(request))
        return fail(
          response,
          API_DATASET_VERSION_LIST_OPERATION,
          "unauthorized",
          "Authentication is required.",
          401,
        );
      const workspaceId = required(request.query?.workspaceId, "workspaceId");
      const datasetId =
        typeof request.query?.datasetId === "string" &&
        request.query.datasetId.trim()
          ? request.query.datasetId.trim()
          : undefined;
      const versions = await dependencies.listDatasetVersionsUseCase.execute(
        {
          workspaceId: createWorkspaceId(workspaceId),
          ...(datasetId ? { datasetId } : {}),
        },
        context(request, workspaceId),
      );
      response.status(200).json(
        createApiSuccessResponse(API_DATASET_VERSION_LIST_OPERATION, {
          versions,
        }),
      );
    } catch {
      fail(
        response,
        API_DATASET_VERSION_LIST_OPERATION,
        "validation",
        "The dataset version history request is invalid.",
        400,
      );
    }
  });

  dependencies.app.get(
    "/api/dataset-versions/compare",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_VERSION_COMPARE_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const workspaceId = required(request.query?.workspaceId, "workspaceId");
        const comparison =
          await dependencies.compareDatasetVersionsUseCase.execute(
            {
              workspaceId: createWorkspaceId(workspaceId),
              fromVersionId: required(
                request.query?.fromVersionId,
                "fromVersionId",
              ) as never,
              toVersionId: required(
                request.query?.toVersionId,
                "toVersionId",
              ) as never,
            },
            context(request, workspaceId),
          );
        if (!comparison)
          return fail(
            response,
            API_DATASET_VERSION_COMPARE_OPERATION,
            "not-found",
            "Dataset versions were not found.",
            404,
          );
        response.status(200).json(
          createApiSuccessResponse(API_DATASET_VERSION_COMPARE_OPERATION, {
            comparison,
          }),
        );
      } catch {
        fail(
          response,
          API_DATASET_VERSION_COMPARE_OPERATION,
          "validation",
          "The dataset version comparison request is invalid.",
          400,
        );
      }
    },
  );

  dependencies.app.get(
    "/api/dataset-versions/:versionId/reproduction",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_VERSION_REPRODUCE_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const workspaceId = required(request.query?.workspaceId, "workspaceId");
        const requestContext = context(request, workspaceId);
        const reproduction =
          await dependencies.readDatasetVersionReproductionUseCase.execute(
            {
              workspaceId: requestContext.workspaceId,
              versionId: required(
                request.params?.versionId,
                "versionId",
              ) as never,
            },
            requestContext,
          );
        if (!reproduction)
          return fail(
            response,
            API_DATASET_VERSION_REPRODUCE_OPERATION,
            "not-found",
            "Dataset version was not found.",
            404,
          );
        response.status(200).json(
          createApiSuccessResponse(API_DATASET_VERSION_REPRODUCE_OPERATION, {
            reproduction,
          }),
        );
      } catch {
        fail(
          response,
          API_DATASET_VERSION_REPRODUCE_OPERATION,
          "validation",
          "The saved setup could not be read.",
          400,
        );
      }
    },
  );

  dependencies.app.post(
    "/api/dataset-versions/:versionId/publish",
    async (request, response) => {
      try {
        if (!authenticated(request))
          return fail(
            response,
            API_DATASET_VERSION_PUBLISH_OPERATION,
            "unauthorized",
            "Authentication is required.",
            401,
          );
        const value = body(request.body);
        const workspaceId = required(value.workspaceId, "workspaceId");
        const visibility =
          value.visibility === "public"
            ? "public"
            : value.visibility === "private"
              ? "private"
              : undefined;
        if (!visibility) throw new Error("visibility is invalid.");
        const result = await dependencies.publishDatasetVersionUseCase.execute(
          {
            workspaceId,
            versionId: required(request.params?.versionId, "versionId"),
            repositoryId: required(value.repositoryId, "repositoryId"),
            visibility,
            ...(value.createRepository === true
              ? { createRepository: true }
              : {}),
            confirmation: {
              approved: true,
              visibility,
              ...(visibility === "public" &&
              value.publicAccessConfirmed === true
                ? { publicAccessConfirmed: true as const }
                : {}),
            },
          },
          context(request, workspaceId),
        );
        if (!result.ok)
          return fail(
            response,
            API_DATASET_VERSION_PUBLISH_OPERATION,
            result.error.code,
            result.error.message,
          );
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_DATASET_VERSION_PUBLISH_OPERATION,
              result.value,
            ),
          );
      } catch {
        fail(
          response,
          API_DATASET_VERSION_PUBLISH_OPERATION,
          "validation",
          "The dataset publication request is invalid.",
          400,
        );
      }
    },
  );
}

function integer(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${field} is invalid.`);
  return parsed;
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
