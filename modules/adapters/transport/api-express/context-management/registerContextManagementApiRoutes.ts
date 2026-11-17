import type { Request } from "express";

import type { ApplicationRequestContext } from "../../../../application/ports";
import type {
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../../../../contracts/context-management";
import {
  normalizeContextManagementTransportCommand,
} from "../../../../contracts/context-management";
import {
  API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import type { ContractResult } from "../../../../contracts/shared";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

interface RequestLike {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export interface ContextManagementExpressPort {
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}

export interface ContextManagementCommandUseCasePort {
  executeCommand(
    command: ContextManagementTransportCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextManagementTransportValue>>;
}

export interface RegisterContextManagementApiRoutesDependencies {
  readonly app: ContextManagementExpressPort;
  readonly contextManagement: ContextManagementCommandUseCasePort;
}

const READ_ACTIONS = new Set<ContextManagementTransportCommand["action"]>([
  "source-inspect",
  "generation-start",
  "generation-read",
  "browser-list",
  "browser-detail",
  "browser-query",
  "browser-rebuild",
  "task-list",
]);
const WRITE_ACTIONS = new Set<ContextManagementTransportCommand["action"]>([
  "generation-save",
  "generation-discard",
  "generation-cancel",
  "browser-delete",
]);

class AuthenticationRequiredError extends Error {}

function requestContext(
  request: RequestLike,
  workspaceId: string,
): ApplicationRequestContext {
  const auth = getExpressAuthContext(request as Request);
  const organization = getExpressOrganizationContext(request as Request);
  if (auth?.authenticated !== true) throw new AuthenticationRequiredError();
  return {
    workspaceId: createWorkspaceId(workspaceId),
    principalId: auth.principal.principalId,
    ...(organization?.organizationId
      ? { organizationId: organization.organizationId }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("workspaceId is required.");
  }
  return value.trim();
}

function failureStatus(code: string): number {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "not-found") return 404;
  if (code === "conflict") return 409;
  if (code === "unavailable") return 503;
  return code === "validation" ? 400 : 500;
}

function registerOperationRoute(
  dependencies: RegisterContextManagementApiRoutesDependencies,
  path: string,
  allowed: ReadonlySet<ContextManagementTransportCommand["action"]>,
): void {
  dependencies.app.post(path, async (request, response) => {
    try {
      const body = record(request.body);
      const workspaceId = requiredString(body.workspaceId);
      const command = normalizeContextManagementTransportCommand(
        body.command as ContextManagementTransportCommand,
      );
      if (!allowed.has(command.action)) {
        throw new Error("Context action is not allowed on this route.");
      }
      const result = await dependencies.contextManagement.executeCommand(
        command,
        requestContext(request, workspaceId),
      );
      if (!result.ok) {
        response.status(failureStatus(result.error.code)).json(
          createApiFailureResponse(
            createApiError(
              API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
              result.error.code,
              result.error.message,
            ),
          ),
        );
        return;
      }
      response.status(200).json(
        createApiSuccessResponse(
          API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
          result.value,
        ),
      );
    } catch (error) {
      const authenticated =
        !(error instanceof AuthenticationRequiredError);
      response.status(authenticated ? 400 : 401).json(
        createApiFailureResponse(
          createApiError(
            API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
            authenticated ? "validation" : "unauthorized",
            authenticated
              ? "The Context Management request is invalid."
              : "Authentication is required.",
          ),
        ),
      );
    }
  });
}

export function registerContextManagementApiRoutes(
  dependencies: RegisterContextManagementApiRoutesDependencies,
): void {
  registerOperationRoute(
    dependencies,
    "/api/context-management/read",
    READ_ACTIONS,
  );
  registerOperationRoute(
    dependencies,
    "/api/context-management/write",
    WRITE_ACTIONS,
  );
}
