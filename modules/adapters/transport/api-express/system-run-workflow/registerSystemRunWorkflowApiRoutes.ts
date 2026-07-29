import type { Request } from "express";
import type {
  SystemRunWorkflowRequestContext,
} from "../../../../application/ports/system-run-workflow";
import type { SystemRunWorkflowUseCases } from "../../../../application/use-cases/system-run-workflow";
import {
  API_SYSTEM_RUN_WORKFLOW_OPERATIONS,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import {
  normalizeSystemRunWorkflowSource,
  normalizeSystemRunWorkflowValues,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSource,
} from "../../../../contracts/system-run-workflow";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

interface RequestLike {
  body?: unknown;
  query?: Record<string, unknown>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}
export interface SystemRunWorkflowExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}

export interface RegisterSystemRunWorkflowApiRoutesDependencies {
  readonly app: SystemRunWorkflowExpressPort;
  readonly workflows: SystemRunWorkflowUseCases;
}

export function registerSystemRunWorkflowApiRoutes(
  d: RegisterSystemRunWorkflowApiRoutesDependencies,
): void {
  d.app.get("/api/systems/run-workflows", (request, response) =>
    execute(response, "listProfiles", () =>
      d.workflows.listProfiles.execute(
        {
          workspaceId: String(
            createWorkspaceId(required(request.query?.workspaceId)),
          ),
          ...(optional(request.query?.sourceKind)
            ? { sourceKind: sourceKind(request.query?.sourceKind) }
            : {}),
          ...(optional(request.query?.sourceId)
            ? { sourceId: optional(request.query?.sourceId)! }
            : {}),
        },
        principal(request),
      ),
    ),
  );
  d.app.post("/api/systems/run-workflows/prepare", (request, response) =>
    execute(response, "prepare", () => {
      const body = record(request.body);
      return d.workflows.prepare.execute(
        {
          workspaceId: String(
            createWorkspaceId(required(body.workspaceId)),
          ),
          profileId: required(body.profileId),
          source: normalizeSystemRunWorkflowSource(
            record(body.source) as unknown as SystemRunWorkflowSource,
          ),
        },
        principal(request),
      );
    }),
  );
  d.app.post("/api/systems/run-workflows/invoke", (request, response) =>
    execute(response, "invoke", () => {
      const body = record(request.body);
      return d.workflows.invoke.execute(
        {
          workspaceId: String(
            createWorkspaceId(required(body.workspaceId)),
          ),
          profileId: required(body.profileId),
          source: normalizeSystemRunWorkflowSource(
            record(body.source) as unknown as SystemRunWorkflowSource,
          ),
          actionId: required(body.actionId),
          operationId: required(body.operationId),
          ...(optional(body.expectedSnapshotRevision)
            ? {
                expectedSnapshotRevision: optional(
                  body.expectedSnapshotRevision,
                )!,
              }
            : {}),
          values: normalizeSystemRunWorkflowValues(record(body.values)),
        },
        principal(request),
      );
    }),
  );
}

async function execute(
  response: ResponseLike,
  operation: keyof typeof API_SYSTEM_RUN_WORKFLOW_OPERATIONS,
  run: () => Promise<SystemRunWorkflowResult<unknown>>,
): Promise<void> {
  try {
    const result = await run();
    if (result.ok) {
      response
        .status(200)
        .json(
          createApiSuccessResponse(
            API_SYSTEM_RUN_WORKFLOW_OPERATIONS[operation],
            result.value,
          ),
        );
      return;
    }
    const status = result.error.code.includes("unauthorized")
      ? 403
      : result.error.code.includes("not-found")
        ? 404
        : result.error.code.includes("conflict") ||
            result.error.code.includes("stale")
          ? 409
          : 400;
    response
      .status(status)
      .json(
        createApiFailureResponse(
          createApiError(
            API_SYSTEM_RUN_WORKFLOW_OPERATIONS[operation],
            status === 403
              ? "forbidden"
              : status === 404
                ? "not-found"
                : status === 409
                  ? "conflict"
                  : "validation",
            result.error.message,
            result.error.field
              ? { details: { field: result.error.field } }
              : undefined,
          ),
        ),
      );
  } catch {
    response
      .status(400)
      .json(
        createApiFailureResponse(
          createApiError(
            API_SYSTEM_RUN_WORKFLOW_OPERATIONS[operation],
            "validation",
            "The system run workflow request is invalid.",
          ),
        ),
      );
  }
}

function principal(request: RequestLike): SystemRunWorkflowRequestContext {
  const auth = getExpressAuthContext(request as Request);
  const organization = getExpressOrganizationContext(request as Request);
  return {
    actorId: auth?.principal.principalId ?? "anonymous",
    roles: auth?.principal.roles ?? [],
    authenticated: auth?.authenticated === true,
    ...(organization?.organizationId
      ? { organizationId: String(organization.organizationId) }
      : {}),
  };
}

const sourceKind = (
  value: unknown,
): "approved-release" | "reviewed-execution-plan" => {
  const parsed = required(value);
  if (
    parsed !== "approved-release" &&
    parsed !== "reviewed-execution-plan"
  )
    throw new Error("Source kind is invalid.");
  return parsed;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("A required value is missing.");
  return value.trim();
};
const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
