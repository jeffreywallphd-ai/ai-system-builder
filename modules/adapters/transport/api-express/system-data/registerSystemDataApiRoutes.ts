import type { Request } from "express";
import type { ReleaseBoundSystemDataUseCases } from "../../../../application/use-cases/system-data";
import { API_SYSTEM_DATA_OPERATIONS, createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import type { SystemDataPrincipal, SystemDataResult, SystemDataValues } from "../../../../contracts/system-data";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";

interface RequestLike { body?: unknown; query?: Record<string, unknown> }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): void }
export interface SystemDataExpressPort {
  get(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void;
  post(path: string, handler: (request: RequestLike, response: ResponseLike) => Promise<void>): void;
}
export interface RegisterSystemDataApiRoutesDependencies {
  readonly app: SystemDataExpressPort;
  readonly runtime: Pick<ReleaseBoundSystemDataUseCases, "describe" | "create" | "read" | "update" | "list" | "listAudit">;
}

export function registerSystemDataApiRoutes(dependencies: RegisterSystemDataApiRoutesDependencies): void {
  dependencies.app.get("/api/systems/data/form", async (request, response) =>
    execute(response, "describe", () => dependencies.runtime.describe(contextFromQuery(request))));
  dependencies.app.post("/api/systems/data/records/create", async (request, response) =>
    execute(response, "create", () => {
      const body = record(request.body);
      return dependencies.runtime.create({
        ...contextFromBody(request, body),
        recordId: required(body.recordId),
        values: values(body.values),
      });
    }));
  dependencies.app.get("/api/systems/data/record", async (request, response) =>
    execute(response, "read", () => dependencies.runtime.read({
      ...contextFromQuery(request),
      recordId: required(request.query?.recordId),
    })));
  dependencies.app.post("/api/systems/data/records/update", async (request, response) =>
    execute(response, "update", () => {
      const body = record(request.body);
      return dependencies.runtime.update({
        ...contextFromBody(request, body),
        recordId: required(body.recordId),
        expectedRevision: positiveInteger(body.expectedRevision),
        values: values(body.values),
      });
    }));
  dependencies.app.get("/api/systems/data/records", async (request, response) =>
    execute(response, "list", () => dependencies.runtime.list({
      ...contextFromQuery(request),
      ...(request.query?.limit !== undefined ? { limit: integer(request.query.limit) } : {}),
      ...(request.query?.offset !== undefined ? { offset: integer(request.query.offset) } : {}),
    })));
  dependencies.app.get("/api/systems/data/audit", async (request, response) =>
    execute(response, "listAudit", () => dependencies.runtime.listAudit({
      ...contextFromQuery(request),
      ...(request.query?.limit !== undefined ? { limit: integer(request.query.limit) } : {}),
    })));
}

function contextFromQuery(request: RequestLike) {
  return {
    workspaceId: createWorkspaceId(required(request.query?.workspaceId)),
    releaseId: normalizeSystemReleaseId(required(request.query?.releaseId)),
    entityType: safeEntity(required(request.query?.entityType)),
    principal: principal(request),
  };
}

function contextFromBody(request: RequestLike, body: Record<string, unknown>) {
  return {
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    releaseId: normalizeSystemReleaseId(required(body.releaseId)),
    entityType: safeEntity(required(body.entityType)),
    principal: principal(request),
  };
}

async function execute(
  response: ResponseLike,
  operation: keyof typeof API_SYSTEM_DATA_OPERATIONS,
  run: () => Promise<SystemDataResult<unknown>>,
): Promise<void> {
  try {
    const result = await run();
    if (result.ok) {
      response.status(200).json(createApiSuccessResponse(API_SYSTEM_DATA_OPERATIONS[operation], result.value));
      return;
    }
    const status = statusFor(result.error.code);
    response.status(status).json(createApiFailureResponse(createApiError(
      API_SYSTEM_DATA_OPERATIONS[operation],
      status === 403 ? "forbidden" : status === 404 ? "not-found" : status === 409 ? "conflict" : "validation",
      result.error.message,
      result.error.field ? { details: { field: result.error.field } } : undefined,
    )));
  } catch {
    response.status(400).json(createApiFailureResponse(createApiError(
      API_SYSTEM_DATA_OPERATIONS[operation],
      "validation",
      "The system data request is invalid.",
    )));
  }
}

function principal(request: RequestLike): SystemDataPrincipal {
  const auth = getExpressAuthContext(request as Request);
  return {
    actorId: auth?.principal.principalId ?? "anonymous",
    roles: auth?.principal.roles ?? [],
    authenticated: auth?.authenticated === true,
  };
}

function statusFor(code: string): number {
  if (code.includes("forbidden")) return 403;
  if (code.includes("not-found")) return 404;
  if (code.includes("conflict") || code.includes("release-unavailable")) return 409;
  return 400;
}

function values(value: unknown): SystemDataValues {
  const candidate = record(value);
  for (const item of Object.values(candidate)) {
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) throw new Error("Invalid value.");
  }
  return { ...candidate } as SystemDataValues;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("A required value is missing.");
  return value.trim();
};
const safeEntity = (value: string): string => {
  if (!/^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/.test(value) || value.includes("..")) throw new Error("Entity type is invalid.");
  return value;
};
const integer = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error("Expected an integer.");
  return parsed;
};
const positiveInteger = (value: unknown): number => {
  const parsed = integer(value);
  if (parsed < 1) throw new Error("Expected a positive integer.");
  return parsed;
};
