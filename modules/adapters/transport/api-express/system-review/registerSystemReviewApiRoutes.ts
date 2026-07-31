import type { Request } from "express";
import type { ReleaseBoundSystemReviewUseCases } from "../../../../application/use-cases/system-review";
import {
  API_SYSTEM_REVIEW_OPERATIONS,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import type {
  SystemReviewPrincipal,
  SystemReviewResult,
} from "../../../../contracts/system-review";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  getExpressAuthContext,
  requireExpressAuthenticatedPrincipalId,
} from "../security/expressAuthContext";

interface RequestLike {
  query?: Record<string, unknown>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}
export interface SystemReviewExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}
export interface RegisterSystemReviewApiRoutesDependencies {
  readonly app: SystemReviewExpressPort;
  readonly runtime: Pick<
    ReleaseBoundSystemReviewUseCases,
    "describe" | "browse" | "detail" | "preview" | "listAudit"
  >;
}

export function registerSystemReviewApiRoutes(
  dependencies: RegisterSystemReviewApiRoutesDependencies,
): void {
  dependencies.app.get("/api/systems/review", async (request, response) =>
    execute(response, "describe", () =>
      dependencies.runtime.describe(context(request)),
    ),
  );
  dependencies.app.get(
    "/api/systems/review/artifacts",
    async (request, response) =>
      execute(response, "browse", () =>
        dependencies.runtime.browse({
          ...context(request),
          ...(optional(request.query?.nameQuery)
            ? { nameQuery: optional(request.query?.nameQuery) }
            : {}),
          ...(request.query?.limit !== undefined
            ? { limit: positiveInteger(request.query.limit) }
            : {}),
        }),
      ),
  );
  dependencies.app.get(
    "/api/systems/review/artifact",
    async (request, response) =>
      execute(response, "detail", () =>
        dependencies.runtime.detail({
          ...context(request),
          artifactRef: required(request.query?.artifactRef),
        }),
      ),
  );
  dependencies.app.get(
    "/api/systems/review/preview",
    async (request, response) =>
      execute(response, "preview", () =>
        dependencies.runtime.preview({
          ...context(request),
          artifactRef: required(request.query?.artifactRef),
        }),
      ),
  );
  dependencies.app.get("/api/systems/review/audit", async (request, response) =>
    execute(response, "listAudit", () =>
      dependencies.runtime.listAudit({
        ...context(request),
        ...(request.query?.limit !== undefined
          ? { limit: positiveInteger(request.query.limit) }
          : {}),
      }),
    ),
  );
}

async function execute(
  response: ResponseLike,
  operation: keyof typeof API_SYSTEM_REVIEW_OPERATIONS,
  run: () => Promise<SystemReviewResult<unknown>>,
): Promise<void> {
  try {
    const result = await run();
    if (result.ok) {
      response
        .status(200)
        .json(
          createApiSuccessResponse(
            API_SYSTEM_REVIEW_OPERATIONS[operation],
            jsonSafe(result.value),
          ),
        );
      return;
    }
    const status = statusFor(result.error.code);
    const code =
      status === 403
        ? "forbidden"
        : status === 404
          ? "not-found"
          : status === 503
            ? "unavailable"
            : "validation";
    response
      .status(status)
      .json(
        createApiFailureResponse(
          createApiError(
            API_SYSTEM_REVIEW_OPERATIONS[operation],
            code,
            result.error.message,
          ),
        ),
      );
  } catch {
    response
      .status(400)
      .json(
        createApiFailureResponse(
          createApiError(
            API_SYSTEM_REVIEW_OPERATIONS[operation],
            "validation",
            "The system review request is invalid.",
          ),
        ),
      );
  }
}

function context(request: RequestLike) {
  return {
    workspaceId: createWorkspaceId(required(request.query?.workspaceId)),
    releaseId: normalizeSystemReleaseId(required(request.query?.releaseId)),
    principal: principal(request),
  };
}

function principal(request: RequestLike): SystemReviewPrincipal {
  const auth = getExpressAuthContext(request as Request);
  return {
    actorId: requireExpressAuthenticatedPrincipalId(request as Request),
    roles: auth?.principal.roles ?? [],
    authenticated: true,
  };
}

function statusFor(code: string): number {
  if (code.includes("forbidden")) return 403;
  if (code.includes("not-found")) return 404;
  if (code.includes("unavailable") || code.includes("audit")) return 503;
  return 400;
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        jsonSafe(item),
      ]),
    );
  }
  return value;
}

const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("A required value is missing.");
  return value.trim();
};
const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const positiveInteger = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("Expected a positive integer.");
  return parsed;
};
