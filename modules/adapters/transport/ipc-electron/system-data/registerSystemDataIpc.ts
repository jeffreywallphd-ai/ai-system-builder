import type { ReleaseBoundSystemDataUseCases } from "../../../../application/use-cases/system-data";
import { DESKTOP_SYSTEM_DATA_CHANNELS, createIpcError, createIpcFailureResponse, createIpcSuccessResponse } from "../../../../contracts/ipc";
import type { SystemDataPrincipal, SystemDataResult, SystemDataValues } from "../../../../contracts/system-data";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterSystemDataIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly runtime: Pick<ReleaseBoundSystemDataUseCases, "describe" | "create" | "read" | "update" | "list" | "listAudit">;
}

const LOCAL_PRINCIPAL: SystemDataPrincipal = {
  actorId: "local-user",
  roles: ["owner", "editor", "viewer", "developer"],
  authenticated: true,
};

export function registerSystemDataIpc(dependencies: RegisterSystemDataIpcDependencies): void {
  handle(dependencies, "describe", (payload) => dependencies.runtime.describe(context(payload)));
  handle(dependencies, "create", (payload) => dependencies.runtime.create({
    ...context(payload),
    recordId: required(payload.recordId),
    values: values(payload.values),
  }));
  handle(dependencies, "read", (payload) => dependencies.runtime.read({
    ...context(payload),
    recordId: required(payload.recordId),
  }));
  handle(dependencies, "update", (payload) => dependencies.runtime.update({
    ...context(payload),
    recordId: required(payload.recordId),
    expectedRevision: positiveInteger(payload.expectedRevision),
    values: values(payload.values),
  }));
  handle(dependencies, "list", (payload) => dependencies.runtime.list({
    ...context(payload),
    ...(payload.limit !== undefined ? { limit: integer(payload.limit) } : {}),
    ...(payload.offset !== undefined ? { offset: integer(payload.offset) } : {}),
  }));
  handle(dependencies, "listAudit", (payload) => dependencies.runtime.listAudit({
    ...context(payload),
    ...(payload.limit !== undefined ? { limit: integer(payload.limit) } : {}),
  }));
}

function handle(
  dependencies: RegisterSystemDataIpcDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_DATA_CHANNELS,
  run: (payload: Record<string, unknown>) => Promise<SystemDataResult<unknown>>,
): void {
  const channels = DESKTOP_SYSTEM_DATA_CHANNELS[operation];
  dependencies.ipcMain.handle(channels.request.value, async (_event, request: unknown) => {
    const envelope = request as { requestId?: string; correlationId?: string; payload?: unknown };
    const responseContext = { requestId: envelope?.requestId, correlationId: envelope?.correlationId };
    try {
      const result = await run(record(envelope?.payload));
      if (result.ok) return createIpcSuccessResponse(channels.response as never, result.value, responseContext);
      const kind = result.error.code.includes("forbidden")
        ? "forbidden"
        : result.error.code.includes("not-found")
          ? "not-found"
          : result.error.code.includes("conflict") || result.error.code.includes("release-unavailable")
            ? "conflict"
            : "validation";
      return createIpcFailureResponse(createIpcError(channels.response as never, kind, result.error.message, { ...responseContext, ...(result.error.field ? { details: { field: result.error.field } } : {}) }) as never, responseContext);
    } catch {
      return createIpcFailureResponse(createIpcError(channels.response as never, "validation", "The system data request is invalid.", responseContext) as never, responseContext);
    }
  });
}

function context(payload: Record<string, unknown>) {
  return {
    workspaceId: createWorkspaceId(required(payload.workspaceId)),
    releaseId: normalizeSystemReleaseId(required(payload.releaseId)),
    entityType: safeEntity(required(payload.entityType)),
    principal: LOCAL_PRINCIPAL,
  };
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
  if (!Number.isSafeInteger(value)) throw new Error("Expected an integer.");
  return value as number;
};
const positiveInteger = (value: unknown): number => {
  const parsed = integer(value);
  if (parsed < 1) throw new Error("Expected a positive integer.");
  return parsed;
};
